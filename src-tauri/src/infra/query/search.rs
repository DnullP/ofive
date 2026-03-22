//! # Markdown 搜索查询基础设施模块
//!
//! 提供 Markdown 文件快速切换搜索与 WikiLink 自动补全能力。
//! 该模块只依赖索引与路径评分逻辑，不直接依赖 Tauri `State`。

use crate::infra::query::query_index;
use crate::shared::vault_contracts::{VaultQuickSwitchItem, WikiLinkSuggestionItem};
use std::path::Path;

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
