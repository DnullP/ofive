//! # WikiLink 查询基础设施模块
//!
//! 负责 WikiLink、图片嵌入目标、Markdown 行内链接目标提取与 vault 内路径解析。

use crate::infra::fs::fs_helpers::{
    collect_image_candidates_by_stem, collect_markdown_candidates_by_stem, is_markdown_file,
    is_supported_image_file, relative_path_from_vault_root, with_markdown_extension_candidates,
    with_supported_image_extension_candidates,
};
use crate::infra::query::markdown_block_detector::{
    detect_excluded_byte_ranges, is_byte_offset_excluded,
};
use crate::infra::query::query_index;
use crate::shared::vault_contracts::{
    ResolveMediaEmbedTargetResponse, ResolveWikiLinkTargetResponse,
};
use std::path::{Path, PathBuf};

fn normalize_wikilink_target(target: &str) -> String {
    target.trim().replace('\\', "/")
}

fn to_wikilink_resolve_target(raw_target: &str) -> Option<String> {
    let trimmed = raw_target.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_alias = trimmed.split('|').next().unwrap_or(trimmed).trim();
    let without_heading = without_alias
        .split('#')
        .next()
        .unwrap_or(without_alias)
        .trim();
    if without_heading.is_empty() {
        return None;
    }

    Some(normalize_wikilink_target(without_heading))
}

fn to_media_embed_resolve_target(raw_target: &str) -> Option<String> {
    let trimmed = raw_target.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_size_hint = trimmed.split('|').next().unwrap_or(trimmed).trim();
    let without_heading = without_size_hint
        .split('#')
        .next()
        .unwrap_or(without_size_hint)
        .trim();

    if without_heading.is_empty() {
        return None;
    }

    Some(normalize_wikilink_target(without_heading))
}

pub(crate) fn extract_wikilink_targets(content: &str) -> Vec<String> {
    let excluded = detect_excluded_byte_ranges(content);
    let mut targets = Vec::new();
    let mut cursor = 0usize;

    while cursor < content.len() {
        let Some(start_offset) = content[cursor..].find("[[") else {
            break;
        };
        let start_index = cursor + start_offset + 2;
        let Some(end_offset) = content[start_index..].find("]]") else {
            break;
        };
        let end_index = start_index + end_offset;

        let match_start = cursor + start_offset;
        if is_byte_offset_excluded(match_start, &excluded) {
            cursor = end_index + 2;
            continue;
        }

        let raw_target = &content[start_index..end_index];
        if let Some(target) = to_wikilink_resolve_target(raw_target) {
            targets.push(target);
        }
        cursor = end_index + 2;
    }

    targets
}

fn normalize_markdown_link_target(raw_target: &str) -> Option<String> {
    let mut target = raw_target.trim();
    if target.is_empty() {
        return None;
    }

    if target.starts_with('<') && target.ends_with('>') && target.len() > 2 {
        target = &target[1..target.len() - 1];
    }

    if target.starts_with("http://")
        || target.starts_with("https://")
        || target.starts_with("mailto:")
        || target.starts_with('#')
    {
        return None;
    }

    let target_no_query = target.split('?').next().unwrap_or(target);
    let target_no_fragment = target_no_query.split('#').next().unwrap_or(target_no_query);
    let normalized = target_no_fragment.trim().replace('\\', "/");
    if normalized.is_empty() {
        return None;
    }

    Some(normalized)
}

pub(crate) fn extract_markdown_inline_link_targets(content: &str) -> Vec<String> {
    let excluded = detect_excluded_byte_ranges(content);
    let bytes = content.as_bytes();
    let mut targets = Vec::new();
    let mut cursor = 0usize;

    while cursor < bytes.len() {
        if bytes[cursor] != b'[' {
            cursor += 1;
            continue;
        }

        if cursor > 0 && bytes[cursor - 1] == b'!' {
            cursor += 1;
            continue;
        }

        if is_byte_offset_excluded(cursor, &excluded) {
            cursor += 1;
            continue;
        }

        let Some(close_bracket) = content[cursor + 1..].find(']') else {
            break;
        };
        let close_bracket_index = cursor + 1 + close_bracket;

        if close_bracket_index + 1 >= bytes.len() || bytes[close_bracket_index + 1] != b'(' {
            cursor += 1;
            continue;
        }

        let link_start = close_bracket_index + 2;
        let Some(close_paren_offset) = content[link_start..].find(')') else {
            break;
        };
        let link_end = link_start + close_paren_offset;
        let raw_target = &content[link_start..link_end];
        let url_part = raw_target.split_whitespace().next().unwrap_or(raw_target);

        if let Some(target) = normalize_markdown_link_target(url_part) {
            targets.push(target);
        }

        cursor = link_end + 1;
    }

    targets
}

pub(crate) fn path_tree_distance(left_dir: &Path, right_dir: &Path) -> usize {
    let left_components = left_dir
        .components()
        .filter(|component| {
            !matches!(
                component,
                std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
                    | std::path::Component::CurDir
            )
        })
        .collect::<Vec<_>>();
    let right_components = right_dir
        .components()
        .filter(|component| {
            !matches!(
                component,
                std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
                    | std::path::Component::CurDir
            )
        })
        .collect::<Vec<_>>();

    let mut common_len = 0usize;
    while common_len < left_components.len()
        && common_len < right_components.len()
        && left_components[common_len] == right_components[common_len]
    {
        common_len += 1;
    }

    (left_components.len() - common_len) + (right_components.len() - common_len)
}

fn resolve_current_dir_for_wikilink(
    vault_root: &Path,
    current_dir: &str,
) -> Result<PathBuf, String> {
    if current_dir.trim().is_empty() {
        return Ok(vault_root.to_path_buf());
    }

    let normalized = current_dir.replace('\\', "/");
    let raw = PathBuf::from(&normalized);
    let candidate = if raw.is_absolute() {
        raw
    } else {
        vault_root.join(raw)
    };

    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("解析当前目录失败 {}: {error}", candidate.display()))?;

    if !canonical.starts_with(vault_root) {
        return Err("current_dir 必须位于当前 vault 目录内".to_string());
    }

    if !canonical.is_dir() {
        return Err("current_dir 必须是目录路径".to_string());
    }

    Ok(canonical)
}

pub fn resolve_wikilink_target_path_in_vault(
    vault_root: &Path,
    current_dir: &str,
    target: &str,
) -> Result<Option<PathBuf>, String> {
    resolve_wikilink_target_path_in_vault_internal(vault_root, current_dir, target, true)
}

pub(crate) fn resolve_wikilink_target_path_in_vault_without_index(
    vault_root: &Path,
    current_dir: &str,
    target: &str,
) -> Result<Option<PathBuf>, String> {
    resolve_wikilink_target_path_in_vault_internal(vault_root, current_dir, target, false)
}

fn resolve_wikilink_target_path_in_vault_internal(
    vault_root: &Path,
    current_dir: &str,
    target: &str,
    allow_index_lookup: bool,
) -> Result<Option<PathBuf>, String> {
    let canonical_vault_root = vault_root
        .canonicalize()
        .map_err(|error| format!("解析 vault 根目录失败 {}: {error}", vault_root.display()))?;

    let normalized_target = normalize_wikilink_target(target);
    if normalized_target.is_empty() {
        return Ok(None);
    }

    let current_dir_path = resolve_current_dir_for_wikilink(&canonical_vault_root, current_dir)?;
    let target_path = PathBuf::from(&normalized_target);

    let mut direct_candidates: Vec<PathBuf> = Vec::new();
    if target_path.is_absolute() {
        direct_candidates.extend(with_markdown_extension_candidates(&target_path));
    } else if normalized_target.starts_with("./") || normalized_target.starts_with("../") {
        direct_candidates.extend(with_markdown_extension_candidates(
            &current_dir_path.join(&target_path),
        ));
    } else if target_path.components().count() > 1 {
        direct_candidates.extend(with_markdown_extension_candidates(
            &canonical_vault_root.join(&target_path),
        ));
        direct_candidates.extend(with_markdown_extension_candidates(
            &current_dir_path.join(&target_path),
        ));
    }

    for candidate in direct_candidates {
        if candidate.is_file() && is_markdown_file(&candidate) {
            let canonical = candidate
                .canonicalize()
                .map_err(|error| format!("解析目标文件失败 {}: {error}", candidate.display()))?;
            if canonical.starts_with(&canonical_vault_root) {
                return Ok(Some(canonical));
            }
        }
    }

    if target_path.components().count() > 1 || normalized_target.contains('/') {
        return Ok(None);
    }

    let mut candidates = if allow_index_lookup {
        query_index::ensure_query_index_current(&canonical_vault_root)?;
        query_index::find_markdown_candidates_by_stem(&canonical_vault_root, &normalized_target)?
    } else {
        let mut scanned = Vec::new();
        collect_markdown_candidates_by_stem(
            &canonical_vault_root,
            &normalized_target,
            &mut scanned,
        )?;
        scanned
    };
    if candidates.is_empty() {
        return Ok(None);
    }

    candidates.sort_by(|left, right| {
        let left_parent = left.parent().unwrap_or(&canonical_vault_root);
        let right_parent = right.parent().unwrap_or(&canonical_vault_root);

        let left_distance = path_tree_distance(&current_dir_path, left_parent);
        let right_distance = path_tree_distance(&current_dir_path, right_parent);

        left_distance
            .cmp(&right_distance)
            .then_with(|| left.to_string_lossy().cmp(&right.to_string_lossy()))
    });

    Ok(candidates.into_iter().next())
}

pub(crate) fn resolve_media_embed_target_path_in_vault(
    vault_root: &Path,
    current_dir: &str,
    target: &str,
) -> Result<Option<PathBuf>, String> {
    let canonical_vault_root = vault_root
        .canonicalize()
        .map_err(|error| format!("解析 vault 根目录失败 {}: {error}", vault_root.display()))?;

    let Some(normalized_target) = to_media_embed_resolve_target(target) else {
        return Ok(None);
    };

    let current_dir_path = resolve_current_dir_for_wikilink(&canonical_vault_root, current_dir)?;
    let target_path = PathBuf::from(&normalized_target);

    let mut direct_candidates: Vec<PathBuf> = Vec::new();
    if target_path.is_absolute() {
        direct_candidates.extend(with_supported_image_extension_candidates(&target_path));
    } else if normalized_target.starts_with("./") || normalized_target.starts_with("../") {
        direct_candidates.extend(with_supported_image_extension_candidates(
            &current_dir_path.join(&target_path),
        ));
    } else {
        direct_candidates.extend(with_supported_image_extension_candidates(
            &current_dir_path.join(&target_path),
        ));
        direct_candidates.extend(with_supported_image_extension_candidates(
            &canonical_vault_root.join(&target_path),
        ));
    }

    for candidate in direct_candidates {
        if candidate.is_file() && is_supported_image_file(&candidate) {
            let canonical = candidate
                .canonicalize()
                .map_err(|error| format!("解析目标文件失败 {}: {error}", candidate.display()))?;
            if canonical.starts_with(&canonical_vault_root) {
                return Ok(Some(canonical));
            }
        }
    }

    if target_path.components().count() > 1 || normalized_target.contains('/') {
        return Ok(None);
    }

    let stem = target_path
        .file_stem()
        .and_then(|item| item.to_str())
        .map(|item| item.trim())
        .unwrap_or("");

    if stem.is_empty() {
        return Ok(None);
    }

    let mut candidates = Vec::new();
    collect_image_candidates_by_stem(&canonical_vault_root, stem, &mut candidates)?;
    if candidates.is_empty() {
        return Ok(None);
    }

    candidates.sort_by(|left, right| {
        let left_parent = left.parent().unwrap_or(&canonical_vault_root);
        let right_parent = right.parent().unwrap_or(&canonical_vault_root);

        let left_distance = path_tree_distance(&current_dir_path, left_parent);
        let right_distance = path_tree_distance(&current_dir_path, right_parent);

        left_distance
            .cmp(&right_distance)
            .then_with(|| left.to_string_lossy().cmp(&right.to_string_lossy()))
    });

    Ok(candidates.into_iter().next())
}

pub(crate) fn resolve_wikilink_target_in_root(
    vault_root: &Path,
    current_dir: String,
    target: String,
) -> Result<Option<ResolveWikiLinkTargetResponse>, String> {
    log::info!(
        "[vault] resolve_wikilink_target start: current_dir={} target={}",
        current_dir,
        target
    );

    let resolved = resolve_wikilink_target_path_in_vault(vault_root, &current_dir, &target)?;

    let response = if let Some(path) = resolved {
        let relative = relative_path_from_vault_root(vault_root, &path)?;

        log::info!(
            "[vault] resolve_wikilink_target success: target={} relative_path={}",
            target,
            relative
        );

        Some(ResolveWikiLinkTargetResponse {
            relative_path: relative,
            absolute_path: path.to_string_lossy().to_string(),
        })
    } else {
        log::info!(
            "[vault] resolve_wikilink_target success: target={} no matched file",
            target
        );
        None
    };

    Ok(response)
}

pub(crate) fn resolve_media_embed_target_in_root(
    vault_root: &Path,
    current_dir: String,
    target: String,
) -> Result<Option<ResolveMediaEmbedTargetResponse>, String> {
    log::info!(
        "[vault] resolve_media_embed_target start: current_dir={} target={}",
        current_dir,
        target
    );

    let resolved = resolve_media_embed_target_path_in_vault(vault_root, &current_dir, &target)?;

    let response = if let Some(path) = resolved {
        let relative = relative_path_from_vault_root(vault_root, &path)?;

        log::info!(
            "[vault] resolve_media_embed_target success: target={} relative_path={}",
            target,
            relative
        );

        Some(ResolveMediaEmbedTargetResponse {
            relative_path: relative,
            absolute_path: path.to_string_lossy().to_string(),
        })
    } else {
        log::info!(
            "[vault] resolve_media_embed_target success: target={} no matched file",
            target
        );
        None
    };

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::{
        extract_markdown_inline_link_targets, extract_wikilink_targets, path_tree_distance,
        resolve_media_embed_target_path_in_vault, resolve_wikilink_target_path_in_vault,
    };
    use crate::infra::query::query_index::ensure_query_index_current;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("ofive-wikilink-test-{unique}-{sequence}"));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    fn create_markdown_file(root: &Path, relative_path: &str) {
        let target = root.join(relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("应成功创建测试目录");
        }
        fs::write(&target, "# test\n").expect("应成功写入测试文件");
    }

    #[test]
    fn path_tree_distance_should_compute_expected_steps() {
        let left = Path::new("a/b/c");
        let right = Path::new("a/d/e");
        assert_eq!(path_tree_distance(left, right), 4);

        let same = Path::new("a/b");
        assert_eq!(path_tree_distance(same, same), 0);
    }

    #[test]
    fn resolve_wikilink_target_should_match_relative_path_from_vault_root() {
        let root = create_test_root();
        create_markdown_file(&root, "docs/guide.md");

        let result = resolve_wikilink_target_path_in_vault(&root, "docs", "docs/guide")
            .expect("解析应成功")
            .expect("应命中文件");

        assert!(result.ends_with(Path::new("docs/guide.md")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_wikilink_target_should_match_relative_path_from_current_dir() {
        let root = create_test_root();
        create_markdown_file(&root, "notes/topic/intro.md");

        let result = resolve_wikilink_target_path_in_vault(&root, "notes/topic", "./intro")
            .expect("解析应成功")
            .expect("应命中文件");

        assert!(result.ends_with(Path::new("notes/topic/intro.md")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_wikilink_target_should_match_absolute_path() {
        let root = create_test_root();
        create_markdown_file(&root, "refs/network/protocol.md");
        let absolute = root.join("refs/network/protocol.md");

        let result = resolve_wikilink_target_path_in_vault(
            &root,
            "refs",
            absolute.to_string_lossy().as_ref(),
        )
        .expect("解析应成功")
        .expect("应命中文件");

        assert_eq!(result, absolute.canonicalize().expect("应能 canonicalize"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_wikilink_target_should_pick_nearest_named_file() {
        let root = create_test_root();
        create_markdown_file(&root, "notes/topic/readme.md");
        create_markdown_file(&root, "archive/2024/readme.md");

        ensure_query_index_current(&root).expect("构建索引应成功");

        let result = resolve_wikilink_target_path_in_vault(&root, "notes/topic", "readme")
            .expect("解析应成功")
            .expect("应命中文件");

        assert!(result.ends_with(Path::new("notes/topic/readme.md")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_wikilink_target_should_match_case_insensitively() {
        let root = create_test_root();
        create_markdown_file(&root, "notes/topic/Information-Science.md");

        ensure_query_index_current(&root).expect("构建索引应成功");

        let result =
            resolve_wikilink_target_path_in_vault(&root, "notes/topic", "information-science")
                .expect("解析应成功")
                .expect("应命中文件");

        assert!(result.ends_with(Path::new("notes/topic/Information-Science.md")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_wikilink_target_should_return_none_when_target_missing() {
        let root = create_test_root();
        create_markdown_file(&root, "notes/exists.md");

        let result =
            resolve_wikilink_target_path_in_vault(&root, "notes", "not-found").expect("解析应成功");

        assert!(result.is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn extract_wikilink_targets_should_parse_alias_and_heading() {
        let content = "[[A/B|别名]] [[Topic#Section]] [[  Plain  ]]";
        let targets = extract_wikilink_targets(content);

        assert_eq!(targets, vec!["A/B", "Topic", "Plain"]);
    }

    #[test]
    fn extract_markdown_inline_link_targets_should_ignore_external_and_images() {
        let content = "[Doc](notes/guide.md) ![img](assets/a.png) [Web](https://example.com) [Relative](../topic/readme#part)";
        let targets = extract_markdown_inline_link_targets(content);

        assert_eq!(targets, vec!["notes/guide.md", "../topic/readme"]);
    }

    #[test]
    fn resolve_media_embed_target_should_match_relative_image_path() {
        let root = create_test_root();
        fs::create_dir_all(root.join("notes")).expect("应成功创建当前目录");
        let image_path = root.join("assets/images/logo.png");
        if let Some(parent) = image_path.parent() {
            fs::create_dir_all(parent).expect("应成功创建图片目录");
        }
        fs::write(&image_path, [1u8, 2u8, 3u8]).expect("应成功写入图片文件");

        let result =
            resolve_media_embed_target_path_in_vault(&root, "notes", "assets/images/logo.png")
                .expect("解析应成功")
                .expect("应命中图片文件");

        assert!(result.ends_with(Path::new("assets/images/logo.png")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_media_embed_target_should_pick_nearest_stem_match() {
        let root = create_test_root();
        let near_image = root.join("notes/topic/pasted-image-1.png");
        let far_image = root.join("archive/2025/pasted-image-1.jpg");

        if let Some(parent) = near_image.parent() {
            fs::create_dir_all(parent).expect("应成功创建近目录");
        }
        if let Some(parent) = far_image.parent() {
            fs::create_dir_all(parent).expect("应成功创建远目录");
        }

        fs::write(&near_image, [1u8]).expect("应成功写入近图片文件");
        fs::write(&far_image, [2u8]).expect("应成功写入远图片文件");

        let result =
            resolve_media_embed_target_path_in_vault(&root, "notes/topic", "pasted-image-1")
                .expect("解析应成功")
                .expect("应命中图片文件");

        assert!(result.ends_with(Path::new("notes/topic/pasted-image-1.png")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn extract_wikilink_targets_should_skip_code_block() {
        let content = "[[real]]\n```\n[[fake]]\n```\n[[also-real]]";
        let targets = extract_wikilink_targets(content);
        assert_eq!(targets, vec!["real", "also-real"]);
    }

    #[test]
    fn extract_wikilink_targets_should_skip_frontmatter() {
        let content = "---\ntags: [[not-a-link]]\n---\n[[actual-link]]";
        let targets = extract_wikilink_targets(content);
        assert_eq!(targets, vec!["actual-link"]);
    }

    #[test]
    fn extract_wikilink_targets_should_skip_latex_block() {
        let content = "[[before]]\n$$\n[[latex-fake]]\n$$\n[[after]]";
        let targets = extract_wikilink_targets(content);
        assert_eq!(targets, vec!["before", "after"]);
    }

    #[test]
    fn extract_wikilink_targets_should_skip_all_block_types() {
        let content = concat!(
            "---\ntitle: [[fm]]\n---\n",
            "[[real-1]]\n",
            "```\n[[code]]\n```\n",
            "[[real-2]]\n",
            "$$\n[[latex]]\n$$\n",
            "[[real-3]]"
        );
        let targets = extract_wikilink_targets(content);
        assert_eq!(targets, vec!["real-1", "real-2", "real-3"]);
    }

    #[test]
    fn extract_inline_link_targets_should_skip_code_block() {
        let content = "[real](real.md)\n```\n[fake](fake.md)\n```\n[also](also.md)";
        let targets = extract_markdown_inline_link_targets(content);
        assert_eq!(targets, vec!["real.md", "also.md"]);
    }

    #[test]
    fn extract_inline_link_targets_should_skip_frontmatter() {
        let content = "---\nref: [link](not-real.md)\n---\n[ok](ok.md)";
        let targets = extract_markdown_inline_link_targets(content);
        assert_eq!(targets, vec!["ok.md"]);
    }

    #[test]
    fn extract_inline_link_targets_should_skip_latex_block() {
        let content = "[a](a.md)\n$$\n[b](b.md)\n$$\n[c](c.md)";
        let targets = extract_markdown_inline_link_targets(content);
        assert_eq!(targets, vec!["a.md", "c.md"]);
    }
}
