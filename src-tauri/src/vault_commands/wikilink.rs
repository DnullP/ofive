//! # WikiLink 解析模块
//!
//! 负责 WikiLink / 图片嵌入目标 / Markdown 行内链接目标提取与 vault 内路径解析。

use crate::state::{get_vault_root, AppState};
use crate::vault_commands::fs_helpers::{
    collect_image_candidates_by_stem, collect_markdown_candidates_by_stem, is_markdown_file,
    is_supported_image_file, relative_path_from_vault_root, with_markdown_extension_candidates,
    with_supported_image_extension_candidates,
};
use crate::vault_commands::markdown_block_detector::{
    detect_excluded_byte_ranges, is_byte_offset_excluded,
};
use crate::vault_commands::query_index;
use crate::vault_commands::types::{
    ResolveMediaEmbedTargetResponse, ResolveWikiLinkTargetResponse,
};
use std::path::{Path, PathBuf};
use tauri::State;

/// 规范化 WikiLink 目标路径文本，去除包裹空格并统一分隔符。
fn normalize_wikilink_target(target: &str) -> String {
    target.trim().replace('\\', "/")
}

/// 从 WikiLink 原始目标中提取可解析路径部分。
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

/// 从图片嵌入语法原始目标中提取可解析路径部分。
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

/// 提取 Markdown 文本中的 WikiLink 目标集合。
///
/// 通过 `markdown_block_detector` 跳过 frontmatter / 代码块 / LaTeX 块
/// 内的 `[[...]]` 模式，避免代码示例中的伪链接污染索引。
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

        // 跳过排斥区域内的匹配（`[[` 起始位置在排斥范围内）
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

/// 规范化 Markdown 行内链接目标，返回可解析的路径部分。
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

/// 提取 Markdown 文本中的行内链接目标集合（忽略图片链接）。
///
/// 通过 `markdown_block_detector` 跳过 frontmatter / 代码块 / LaTeX 块
/// 内的 `[text](url)` 模式，避免代码示例中的伪链接污染索引。
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

        // 跳过排斥区域内的匹配
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

/// 计算两个目录间的路径树距离（边数）。
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

/// 将当前目录参数转换为 vault 内有效目录路径。
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

/// 在当前 vault 中解析 WikiLink 目标路径。
///
/// 解析策略：
/// 1. 绝对路径：直接命中 vault 内 Markdown 文件；
/// 2. 相对路径：支持 `./` / `../`（相对当前目录）与 vault 根目录相对路径；
/// 3. 仅文件名：在全 vault 检索同名 Markdown，按与当前目录的路径树距离选择最近项。
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
    } else {
        if normalized_target.starts_with("./") || normalized_target.starts_with("../") {
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

/// 在当前 vault 中解析图片嵌入目标路径。
///
/// 解析策略：
/// 1. 绝对路径：直接命中 vault 内图片文件；
/// 2. 相对路径：支持 `./` / `../`（相对当前目录）与 vault 根目录相对路径；
/// 3. 仅文件名/文件名（不含后缀）：在全 vault 检索同名图片，按与当前目录的路径树距离选择最近项。
pub fn resolve_media_embed_target_path_in_vault(
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
    } else {
        if normalized_target.starts_with("./") || normalized_target.starts_with("../") {
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

/// 解析 WikiLink 目标并返回 vault 内最近文件路径。
pub fn resolve_wikilink_target_in_root(
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

/// 解析图片嵌入目标并返回 vault 内最近图片路径。
pub fn resolve_media_embed_target_in_root(
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

/// 解析 WikiLink 目标并返回 vault 内最近文件路径。
pub fn resolve_wikilink_target(
    current_dir: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<Option<ResolveWikiLinkTargetResponse>, String> {
    let vault_root = get_vault_root(&state)?;
    resolve_wikilink_target_in_root(&vault_root, current_dir, target)
}

/// 解析图片嵌入目标并返回 vault 内最近图片路径。
pub fn resolve_media_embed_target(
    current_dir: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<Option<ResolveMediaEmbedTargetResponse>, String> {
    let vault_root = get_vault_root(&state)?;
    resolve_media_embed_target_in_root(&vault_root, current_dir, target)
}
