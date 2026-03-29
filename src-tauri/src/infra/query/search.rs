//! # Markdown 搜索查询基础设施模块
//!
//! 提供 Markdown 文件快速切换搜索、全文搜索与 WikiLink 自动补全能力。
//! 该模块只依赖索引、文件系统与路径评分逻辑，不直接依赖 Tauri `State`。

use crate::infra::query::markdown_block_detector::{
    detect_excluded_byte_ranges, is_byte_offset_excluded,
};
use crate::infra::query::query_index;
use crate::shared::vault_contracts::{
    VaultQuickSwitchItem, VaultSearchMatchItem, VaultSearchScope, WikiLinkSuggestionItem,
};
use serde_yaml::Value as YamlValue;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

/// 以子序列方式计算 query 在目标字符串中的模糊匹配得分。
fn fuzzy_subsequence_score(target: &str, query: &str) -> Option<usize> {
    if query.is_empty() {
        return Some(0);
    }

    let mut query_chars = query.chars();
    let mut current_query_char = query_chars.next()?;
    let mut first_match_index = None;
    let mut matched_count = 0usize;

    for (index, character) in target.chars().enumerate() {
        if character == current_query_char {
            if first_match_index.is_none() {
                first_match_index = Some(index);
            }
            matched_count += 1;

            if let Some(next_char) = query_chars.next() {
                current_query_char = next_char;
            } else {
                let first = first_match_index.unwrap_or(index);
                let span = index.saturating_sub(first) + 1;
                let compact_bonus = matched_count.saturating_mul(8).saturating_sub(span);
                return Some(compact_bonus + 4);
            }
        }
    }

    None
}

/// 计算单条路径在快速切换中的匹配分数。
fn score_quick_switch_match(relative_path: &str, query: &str) -> Option<usize> {
    let normalized_path = relative_path.replace('\\', "/").to_lowercase();
    let file_name = Path::new(relative_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(relative_path)
        .to_lowercase();

    let trimmed_query = query.trim().to_lowercase();
    if trimmed_query.is_empty() {
        return Some(1);
    }

    let mut total_score = 0usize;
    for query_token in trimmed_query.split_whitespace() {
        if query_token.is_empty() {
            continue;
        }

        if file_name == query_token {
            total_score += 120;
            continue;
        }

        if file_name.starts_with(query_token) {
            total_score += 90;
            continue;
        }

        if file_name.contains(query_token) {
            total_score += 70;
            continue;
        }

        if normalized_path.contains(query_token) {
            total_score += 50;
            continue;
        }

        if let Some(fuzzy_score) = fuzzy_subsequence_score(&file_name, query_token) {
            total_score += 30 + fuzzy_score;
            continue;
        }

        if let Some(fuzzy_score) = fuzzy_subsequence_score(&normalized_path, query_token) {
            total_score += 20 + fuzzy_score;
            continue;
        }

        return None;
    }

    Some(total_score)
}

/// 规范化标签值，统一移除 `#` 前缀并转为小写。
fn normalize_tag_value(raw: &str) -> Option<String> {
    let normalized = raw.trim().trim_start_matches('#').trim();
    if normalized.is_empty() {
        return None;
    }

    Some(normalized.to_lowercase())
}

/// 提取 Markdown 文档开头的 frontmatter YAML 文本。
fn extract_frontmatter_yaml(content: &str) -> Option<String> {
    let ranges = detect_excluded_byte_ranges(content);
    let first_range = ranges.first()?;
    if first_range.from != 0 || first_range.to >= content.len() {
        return None;
    }

    let block = &content[first_range.from..=first_range.to];
    let mut lines: Vec<&str> = block.lines().collect();
    if lines.len() < 2 {
        return None;
    }

    let first_line = lines.first()?.trim_end();
    let last_line = lines.last()?.trim_end();
    if first_line != "---" || last_line != "---" {
        return None;
    }

    lines.remove(0);
    let _ = lines.pop();
    Some(lines.join("\n"))
}

/// 将 frontmatter 中的标量或数组递归展开为字符串列表。
fn collect_yaml_scalar_values(value: &YamlValue) -> Vec<String> {
    match value {
        YamlValue::Null => Vec::new(),
        YamlValue::Bool(inner) => vec![inner.to_string()],
        YamlValue::Number(inner) => vec![inner.to_string()],
        YamlValue::String(inner) => vec![inner.trim().to_string()],
        YamlValue::Sequence(items) => items.iter().flat_map(collect_yaml_scalar_values).collect(),
        YamlValue::Tagged(tagged) => collect_yaml_scalar_values(&tagged.value),
        YamlValue::Mapping(_) => Vec::new(),
    }
}

/// 从 frontmatter 中提取 tags 字段。
fn extract_frontmatter_tags(content: &str) -> Vec<String> {
    let Some(frontmatter_yaml) = extract_frontmatter_yaml(content) else {
        return Vec::new();
    };

    let Ok(parsed_yaml) = serde_yaml::from_str::<YamlValue>(&frontmatter_yaml) else {
        return Vec::new();
    };

    let YamlValue::Mapping(mapping) = parsed_yaml else {
        return Vec::new();
    };

    let Some(tags_value) = mapping.get(YamlValue::String("tags".to_string())) else {
        return Vec::new();
    };

    collect_yaml_scalar_values(tags_value)
        .into_iter()
        .filter_map(|value| normalize_tag_value(&value))
        .collect()
}

/// 判断字符是否可作为标签边界。
fn is_tag_boundary(character: Option<char>) -> bool {
    match character {
        None => true,
        Some(value) => !value.is_alphanumeric() && !matches!(value, '_' | '-' | '/'),
    }
}

/// 判断字符是否可出现在标签内部。
fn is_tag_character(character: char) -> bool {
    if character.is_whitespace() {
        return false;
    }

    if character.is_alphanumeric() || matches!(character, '_' | '-' | '/') {
        return true;
    }

    !matches!(
        character,
        '#' | '['
            | ']'
            | '('
            | ')'
            | '{'
            | '}'
            | '<'
            | '>'
            | '"'
            | '\''
            | ','
            | '.'
            | '!'
            | '?'
            | ';'
            | ':'
            | '`'
    )
}

/// 从正文中提取 inline hashtag，自动跳过 frontmatter / 代码块 / LaTeX 块。
fn extract_inline_tags(content: &str) -> Vec<String> {
    let ranges = detect_excluded_byte_ranges(content);
    let characters: Vec<(usize, char)> = content.char_indices().collect();
    let mut tags = Vec::new();
    let mut index = 0usize;

    while index < characters.len() {
        let (byte_offset, character) = characters[index];
        if character != '#' || is_byte_offset_excluded(byte_offset, &ranges) {
            index += 1;
            continue;
        }

        let previous = if index == 0 {
            None
        } else {
            Some(characters[index - 1].1)
        };
        if !is_tag_boundary(previous) {
            index += 1;
            continue;
        }

        let mut cursor = index + 1;
        let mut raw_tag = String::new();
        while cursor < characters.len() {
            let (candidate_offset, candidate) = characters[cursor];
            if is_byte_offset_excluded(candidate_offset, &ranges) || !is_tag_character(candidate) {
                break;
            }
            raw_tag.push(candidate);
            cursor += 1;
        }

        if let Some(normalized) = normalize_tag_value(&raw_tag) {
            tags.push(normalized);
        }

        index = cursor.max(index + 1);
    }

    tags
}

/// 提取并去重 Markdown 文件中的所有标签。
fn extract_search_tags(content: &str) -> Vec<String> {
    let mut tags = BTreeSet::new();
    for tag in extract_frontmatter_tags(content) {
        tags.insert(tag);
    }
    for tag in extract_inline_tags(content) {
        tags.insert(tag);
    }
    tags.into_iter().collect()
}

/// 收集可参与全文搜索的文本行，自动跳过块级排斥区域。
fn collect_searchable_lines(content: &str) -> Vec<(usize, String)> {
    let ranges = detect_excluded_byte_ranges(content);
    let lines: Vec<&str> = content.split('\n').collect();
    let mut byte_offset = 0usize;
    let mut output = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        let line_start = byte_offset;
        byte_offset += line.len();
        if index < lines.len().saturating_sub(1) {
            byte_offset += 1;
        }

        if is_byte_offset_excluded(line_start, &ranges) {
            continue;
        }

        output.push((index + 1, line.to_string()));
    }

    output
}

/// 将行文本裁剪为适合展示的摘要片段。
fn clip_snippet(line: &str) -> String {
    let collapsed = line.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut snippet = collapsed.chars().take(140).collect::<String>();
    if collapsed.chars().count() > 140 {
        snippet.push('…');
    }
    snippet
}

/// 计算全文搜索分数并返回最佳摘要行。
fn score_content_match(content: &str, query: &str) -> Option<(usize, Option<(usize, String)>)> {
    let tokens = query
        .trim()
        .to_lowercase()
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return None;
    }

    let searchable_lines = collect_searchable_lines(content);
    let normalized_lines = searchable_lines
        .iter()
        .map(|(_, line)| line.to_lowercase())
        .collect::<Vec<_>>();

    let mut total_score = 0usize;
    for token in &tokens {
        let mut matched = false;
        for line in &normalized_lines {
            if line.contains(token) {
                matched = true;
                total_score += 36 + token.len();
                break;
            }
        }
        if !matched {
            return None;
        }
    }

    let mut best_snippet: Option<(usize, String, usize)> = None;
    for ((line_number, original_line), normalized_line) in
        searchable_lines.iter().zip(normalized_lines.iter())
    {
        let matched_token_count = tokens
            .iter()
            .filter(|token| normalized_line.contains(token.as_str()))
            .count();
        if matched_token_count == 0 {
            continue;
        }

        let snippet = clip_snippet(original_line);
        if snippet.is_empty() {
            continue;
        }

        match &best_snippet {
            Some((best_line, _, best_count))
                if *best_count > matched_token_count
                    || (*best_count == matched_token_count && *best_line <= *line_number) => {}
            _ => {
                best_snippet = Some((*line_number, snippet, matched_token_count));
            }
        }
    }

    if let Some((_, _, matched_token_count)) = &best_snippet {
        total_score += matched_token_count.saturating_mul(24);
    }

    Some((
        total_score,
        best_snippet.map(|(line_number, snippet, _)| (line_number, snippet)),
    ))
}

/// 在指定仓库根目录下检索 Markdown 文件。
pub(crate) fn search_vault_markdown_files_in_root(
    vault_root: &Path,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<VaultQuickSwitchItem>, String> {
    let effective_limit = limit.unwrap_or(80).clamp(1, 200);
    log::info!(
        "[vault-search] search_vault_markdown_files start: query={} limit={}",
        query,
        effective_limit
    );

    query_index::ensure_query_index_current(vault_root)?;

    let indexed_files = query_index::list_markdown_files(vault_root)?;
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        let mut sorted_files = indexed_files;
        sorted_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let results = sorted_files
            .into_iter()
            .take(effective_limit)
            .map(|item| VaultQuickSwitchItem {
                relative_path: item.relative_path,
                title: item.title,
                score: 0,
            })
            .collect::<Vec<_>>();

        log::info!(
            "[vault-search] search_vault_markdown_files success: query-empty results={}",
            results.len()
        );
        return Ok(results);
    }

    let mut scored = indexed_files
        .into_iter()
        .filter_map(|item| {
            let score = score_quick_switch_match(&item.relative_path, trimmed_query)?;
            Some(VaultQuickSwitchItem {
                relative_path: item.relative_path,
                title: item.title,
                score,
            })
        })
        .collect::<Vec<_>>();

    scored.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.relative_path.len().cmp(&right.relative_path.len()))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    if scored.len() > effective_limit {
        scored.truncate(effective_limit);
    }

    log::info!(
        "[vault-search] search_vault_markdown_files success: query={} results={}",
        trimmed_query,
        scored.len()
    );

    Ok(scored)
}

/// 在指定仓库根目录下检索 Canvas 文件。
pub(crate) fn search_vault_canvas_files_in_root(
    vault_root: &Path,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<VaultQuickSwitchItem>, String> {
    let effective_limit = limit.unwrap_or(80).clamp(1, 200);
    let trimmed_query = query.trim();

    log::info!(
        "[vault-search] search_vault_canvas_files start: query={} limit={}",
        trimmed_query,
        effective_limit
    );

    let mut relative_paths = collect_canvas_relative_paths(vault_root, vault_root)?;
    relative_paths.sort();

    if trimmed_query.is_empty() {
        let results = relative_paths
            .into_iter()
            .take(effective_limit)
            .map(|relative_path| VaultQuickSwitchItem {
                title: derive_canvas_title(&relative_path),
                relative_path,
                score: 0,
            })
            .collect::<Vec<_>>();

        log::info!(
            "[vault-search] search_vault_canvas_files success: query-empty results={}",
            results.len()
        );
        return Ok(results);
    }

    let mut scored = relative_paths
        .into_iter()
        .filter_map(|relative_path| {
            let score = score_quick_switch_match(&relative_path, trimmed_query)?;
            Some(VaultQuickSwitchItem {
                title: derive_canvas_title(&relative_path),
                relative_path,
                score,
            })
        })
        .collect::<Vec<_>>();

    scored.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.relative_path.len().cmp(&right.relative_path.len()))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    if scored.len() > effective_limit {
        scored.truncate(effective_limit);
    }

    log::info!(
        "[vault-search] search_vault_canvas_files success: query={} results={}",
        trimmed_query,
        scored.len()
    );

    Ok(scored)
}

/// 递归收集仓库内的 `.canvas` 相对路径。
fn collect_canvas_relative_paths(
    vault_root: &Path,
    current_dir: &Path,
) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    let entries = fs::read_dir(current_dir)
        .map_err(|error| format!("读取目录失败 {}: {error}", current_dir.display()))?;

    let mut child_paths = entries
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .collect::<Vec<PathBuf>>();
    child_paths.sort();

    for child_path in child_paths {
        let file_name = child_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();

        if file_name == ".ofive" {
            continue;
        }

        if child_path.is_dir() {
            paths.extend(collect_canvas_relative_paths(vault_root, &child_path)?);
            continue;
        }

        let is_canvas = child_path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("canvas"));
        if !is_canvas {
            continue;
        }

        let relative_path = child_path
            .strip_prefix(vault_root)
            .map_err(|error| format!("计算 Canvas 相对路径失败 {}: {error}", child_path.display()))?
            .to_string_lossy()
            .replace('\\', "/");
        paths.push(relative_path);
    }

    Ok(paths)
}

/// 从 Canvas 相对路径推导展示标题。
fn derive_canvas_title(relative_path: &str) -> String {
    Path::new(relative_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(relative_path)
        .to_string()
}

/// 在指定仓库根目录下搜索 Markdown 文件名、全文内容与标签。
pub(crate) fn search_vault_markdown_in_root(
    vault_root: &Path,
    query: String,
    tag: Option<String>,
    scope: VaultSearchScope,
    limit: Option<usize>,
) -> Result<Vec<VaultSearchMatchItem>, String> {
    let effective_limit = limit.unwrap_or(80).clamp(1, 200);
    let trimmed_query = query.trim().to_lowercase();
    let normalized_tag = tag.as_deref().and_then(normalize_tag_value);

    log::info!(
        "[vault-search] search_vault_markdown start: query='{}' tag={:?} scope={:?} limit={}",
        trimmed_query,
        normalized_tag,
        scope,
        effective_limit
    );

    if trimmed_query.is_empty() && normalized_tag.is_none() {
        log::info!("[vault-search] search_vault_markdown skipped: empty filters");
        return Ok(Vec::new());
    }

    query_index::ensure_query_index_current(vault_root)?;
    let indexed_files = query_index::list_markdown_files(vault_root)?;
    let query_is_empty = trimmed_query.is_empty();
    let needs_content_scan =
        !matches!(scope, VaultSearchScope::FileName) || normalized_tag.is_some();

    let mut results = Vec::new();

    for item in indexed_files {
        let matched_file_name = if matches!(scope, VaultSearchScope::Content) || query_is_empty {
            false
        } else {
            score_quick_switch_match(&item.relative_path, &trimmed_query).is_some()
        };

        let mut matched_content = false;
        let mut snippet = None;
        let mut snippet_line = None;
        let mut tags = Vec::new();
        let mut matched_tag = normalized_tag.is_none();
        let mut score = 0usize;

        if matched_file_name {
            score += score_quick_switch_match(&item.relative_path, &trimmed_query).unwrap_or(0);
        }

        if needs_content_scan {
            let absolute_path = vault_root.join(&item.relative_path);
            let content = fs::read_to_string(&absolute_path).map_err(|error| {
                format!(
                    "读取 Markdown 文件失败 {}: {error}",
                    absolute_path.display()
                )
            })?;

            tags = extract_search_tags(&content);
            if let Some(expected_tag) = &normalized_tag {
                matched_tag = tags.iter().any(|candidate| candidate == expected_tag);
            }

            if !query_is_empty && !matches!(scope, VaultSearchScope::FileName) {
                if let Some((content_score, matched_snippet)) =
                    score_content_match(&content, &trimmed_query)
                {
                    matched_content = true;
                    score += content_score;
                    if let Some((line_number, summary)) = matched_snippet {
                        snippet_line = Some(line_number);
                        snippet = Some(summary);
                    }
                }
            }
        }

        if !matched_tag {
            continue;
        }

        let matched_scope = match scope {
            VaultSearchScope::All => query_is_empty || matched_file_name || matched_content,
            VaultSearchScope::Content => query_is_empty || matched_content,
            VaultSearchScope::FileName => query_is_empty || matched_file_name,
        };
        if !matched_scope {
            continue;
        }

        if normalized_tag.is_some() {
            score += 12;
        }

        results.push(VaultSearchMatchItem {
            relative_path: item.relative_path,
            title: item.title,
            score,
            snippet,
            snippet_line,
            tags,
            matched_file_name,
            matched_content,
            matched_tag: normalized_tag.is_some(),
        });
    }

    results.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.relative_path.len().cmp(&right.relative_path.len()))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    if results.len() > effective_limit {
        results.truncate(effective_limit);
    }

    log::info!(
        "[vault-search] search_vault_markdown success: query='{}' tag={:?} results={}",
        trimmed_query,
        normalized_tag,
        results.len()
    );

    Ok(results)
}

/// 在指定仓库根目录下提供 WikiLink 自动补全建议。
pub(crate) fn suggest_wikilink_targets_in_root(
    vault_root: &Path,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<WikiLinkSuggestionItem>, String> {
    let effective_limit = limit.unwrap_or(20).clamp(1, 100);
    log::info!(
        "[vault-search] suggest_wikilink_targets start: query='{}' limit={}",
        query,
        effective_limit
    );

    query_index::ensure_query_index_current(vault_root)?;

    let files_with_counts = query_index::list_markdown_files_with_inbound_count(vault_root)?;
    let trimmed_query = query.trim();

    let mut scored: Vec<WikiLinkSuggestionItem> = if trimmed_query.is_empty() {
        files_with_counts
            .into_iter()
            .map(|(relative_path, ref_count)| {
                let title = Path::new(&relative_path)
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .unwrap_or(&relative_path)
                    .to_string();
                WikiLinkSuggestionItem {
                    relative_path,
                    title,
                    score: ref_count,
                    reference_count: ref_count,
                }
            })
            .collect()
    } else {
        files_with_counts
            .into_iter()
            .filter_map(|(relative_path, ref_count)| {
                let keyword_score = score_quick_switch_match(&relative_path, trimmed_query)?;
                let title = Path::new(&relative_path)
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .unwrap_or(&relative_path)
                    .to_string();
                let combined = keyword_score.saturating_mul(1000).saturating_add(ref_count);
                Some(WikiLinkSuggestionItem {
                    relative_path,
                    title,
                    score: combined,
                    reference_count: ref_count,
                })
            })
            .collect()
    };

    scored.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| right.reference_count.cmp(&left.reference_count))
            .then_with(|| left.relative_path.len().cmp(&right.relative_path.len()))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    if scored.len() > effective_limit {
        scored.truncate(effective_limit);
    }

    log::info!(
        "[vault-search] suggest_wikilink_targets success: query='{}' results={}",
        trimmed_query,
        scored.len()
    );

    Ok(scored)
}

#[cfg(test)]
mod tests {
    use super::{extract_search_tags, search_vault_markdown_in_root};
    use crate::shared::vault_contracts::VaultSearchScope;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root =
            std::env::temp_dir().join(format!("ofive-vault-search-test-{}-{}", unique, sequence));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建索引目录");
        root
    }

    fn write_markdown(root: &Path, relative_path: &str, content: &str) {
        let target = root.join(relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("应成功创建父目录");
        }
        fs::write(target, content).expect("应成功写入 Markdown 文件");
    }

    #[test]
    fn extract_search_tags_should_merge_frontmatter_and_inline_tags() {
        let content = "---\ntags:\n  - Project\n---\n#project/roadmap\n#weekly";
        let tags = extract_search_tags(content);

        assert_eq!(tags, vec!["project", "project/roadmap", "weekly"]);
    }

    #[test]
    fn search_vault_markdown_should_match_content_and_skip_code_block_tags() {
        let root = create_test_root();
        write_markdown(
            &root,
            "notes/topic.md",
            "---\ntags: [project]\n---\n# Topic\n\nAlpha beta roadmap\n\n```md\n#fake-tag\nroadmap hidden\n```\n",
        );
        write_markdown(&root, "notes/other.md", "# Other\n\nGamma delta\n#weekly\n");

        let results = search_vault_markdown_in_root(
            &root,
            "roadmap".to_string(),
            Some("project".to_string()),
            VaultSearchScope::All,
            Some(20),
        )
        .expect("全文搜索应成功");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "notes/topic.md");
        assert!(results[0].matched_content);
        assert!(results[0].matched_tag);
        assert_eq!(results[0].snippet_line, Some(6));
        assert_eq!(results[0].tags, vec!["project"]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn search_vault_markdown_should_support_file_name_scope() {
        let root = create_test_root();
        write_markdown(&root, "notes/topic-roadmap.md", "# Topic\n");
        write_markdown(&root, "notes/roadmap-detail.md", "# Detail\n");

        let results = search_vault_markdown_in_root(
            &root,
            "topic".to_string(),
            None,
            VaultSearchScope::FileName,
            Some(20),
        )
        .expect("文件名搜索应成功");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "notes/topic-roadmap.md");
        assert!(results[0].matched_file_name);
        assert!(!results[0].matched_content);

        let _ = fs::remove_dir_all(root);
    }
}
