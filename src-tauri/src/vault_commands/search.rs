//! # 快速切换搜索模块
//!
//! 提供 Markdown 文件检索与评分排序能力。

use crate::state::{get_vault_root, AppState};
use crate::vault_commands::query_index;
use crate::vault_commands::types::VaultQuickSwitchItem;
use crate::vault_commands::types::WikiLinkSuggestionItem;
use std::path::Path;
use tauri::State;

/// 以子序列方式计算 query 在目标字符串中的模糊匹配得分。
///
/// 返回值越大表示匹配越紧凑；未命中返回 `None`。
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
///
/// 匹配策略：
/// 1. 文件名精确/前缀/包含优先；
/// 2. 路径包含次优；
/// 3. 子序列模糊匹配兜底。
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

/// 在当前 vault 中检索 Markdown 文件（用于快速切换）。
///
/// - `query` 为空时返回按路径排序的前 `limit` 条；
/// - `query` 非空时按匹配分数排序返回。
pub fn search_vault_markdown_files_in_root(
    vault_root: &Path,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<VaultQuickSwitchItem>, String> {
    let effective_limit = limit.unwrap_or(80).clamp(1, 200);
    println!(
        "[vault-search] search_vault_markdown_files start: query={} limit={}",
        query, effective_limit
    );

    let indexed_files = query_index::list_markdown_files(vault_root)?;
    let mut markdown_paths = indexed_files
        .iter()
        .map(|item| item.relative_path.clone())
        .collect::<Vec<_>>();

    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        markdown_paths.sort();
        let mut sorted_files = indexed_files;
        sorted_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let results = sorted_files
            .into_iter()
            .take(effective_limit)
            .map(|item| {
                VaultQuickSwitchItem {
                    relative_path: item.relative_path,
                    title: item.title,
                    score: 0,
                }
            })
            .collect::<Vec<_>>();

        println!(
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

    println!(
        "[vault-search] search_vault_markdown_files success: query={} results={}",
        trimmed_query,
        scored.len()
    );

    Ok(scored)
}

/// 在当前 vault 中检索 Markdown 文件（用于快速切换）。
pub fn search_vault_markdown_files(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<VaultQuickSwitchItem>, String> {
    let root = get_vault_root(&state)?;
    search_vault_markdown_files_in_root(&root, query, limit)
}

/// 为 WikiLink 自动补全提供建议列表。
///
/// 排序维度（综合评分）：
/// 1. 关键字契合度（与 quickSwitch 相同的模糊匹配算法）；
/// 2. 笔记热度（被引用次数 / 入链权重和）。
///
/// 综合分计算：`keyword_score * 1000 + reference_count`，
/// 保证关键字匹配度为主排序维度，热度为次排序维度。
///
/// # 参数
/// - `vault_root` vault 根目录。
/// - `query` 搜索关键字（可为空，空则按热度排序）。
/// - `limit` 最大返回条数。
///
/// # 返回
/// 综合排序后的建议列表。
pub fn suggest_wikilink_targets_in_root(
    vault_root: &Path,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<WikiLinkSuggestionItem>, String> {
    let effective_limit = limit.unwrap_or(20).clamp(1, 100);
    println!(
        "[vault-search] suggest_wikilink_targets start: query='{}' limit={}",
        query, effective_limit
    );

    let files_with_counts =
        query_index::list_markdown_files_with_inbound_count(vault_root)?;

    let trimmed_query = query.trim();

    let mut scored: Vec<WikiLinkSuggestionItem> = if trimmed_query.is_empty() {
        // 空查询：按热度排序
        files_with_counts
            .into_iter()
            .map(|(relative_path, ref_count)| {
                let title = Path::new(&relative_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
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
        // 有查询：关键字匹配 + 热度加成
        files_with_counts
            .into_iter()
            .filter_map(|(relative_path, ref_count)| {
                let keyword_score =
                    score_quick_switch_match(&relative_path, trimmed_query)?;
                let title = Path::new(&relative_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&relative_path)
                    .to_string();
                // 关键字分 * 1000 + 入链数，保证关键字为主排序维度
                let combined = keyword_score
                    .saturating_mul(1000)
                    .saturating_add(ref_count);
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
            .then_with(|| {
                right
                    .reference_count
                    .cmp(&left.reference_count)
            })
            .then_with(|| {
                left.relative_path
                    .len()
                    .cmp(&right.relative_path.len())
            })
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    if scored.len() > effective_limit {
        scored.truncate(effective_limit);
    }

    println!(
        "[vault-search] suggest_wikilink_targets success: query='{}' results={}",
        trimmed_query,
        scored.len()
    );

    Ok(scored)
}

/// WikiLink 自动补全建议（Tauri 命令包装）。
pub fn suggest_wikilink_targets(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<WikiLinkSuggestionItem>, String> {
    let root = get_vault_root(&state)?;
    suggest_wikilink_targets_in_root(&root, query, limit)
}
