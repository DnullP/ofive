//! # Markdown 大纲提取模块
//!
//! 从已持久化的 Markdown 文件中提取标题（heading）列表，
//! 返回标题级别、文本和所在行号，供前端 Outline 面板渲染。
//!
//! ## 设计说明
//!
//! 本模块基于行扫描 + 正则匹配提取 ATX 标题，
//! 并通过 `markdown_block_detector` 跳过 frontmatter / 代码块 / LaTeX 块内的伪标题。
//! 与前端旧版 `parseMarkdownHeadings` 在语义上等价，但以后端持久化文件为准。
//!
//! ## 依赖
//!
//! - `markdown_block_detector`：块级结构排斥区间检测
//! - `fs_helpers`：路径解析
//! - `state`：AppState / vault root
//!
//! ## 导出
//!
//! - [`OutlineHeading`]：标题条目结构
//! - [`get_vault_markdown_outline_in_root`]：在指定 vault root 下提取大纲
//! - [`get_vault_markdown_outline`]：Tauri 命令包装

use crate::state::{get_vault_root, AppState};
use crate::vault_commands::fs_helpers::resolve_markdown_path;
use crate::vault_commands::markdown_block_detector::{
    detect_excluded_byte_ranges, is_byte_offset_excluded,
};
use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::State;

/// 大纲标题条目。
///
/// ## 字段
/// - `level`：标题级别（1–6）
/// - `text`：标题纯文本内容
/// - `line`：标题所在行号（1-based）
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OutlineHeading {
    /// 标题级别（1–6）。
    pub level: u8,
    /// 标题纯文本。
    pub text: String,
    /// 所在行号（1-based）。
    pub line: usize,
}

/// 大纲接口响应。
///
/// ## 字段
/// - `relative_path`：文件相对路径
/// - `headings`：标题列表
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineResponse {
    /// 文件相对路径。
    pub relative_path: String,
    /// 提取到的标题列表。
    pub headings: Vec<OutlineHeading>,
}

/// 从 Markdown 文本中提取标题列表。
///
/// # 参数
/// - `content`：Markdown 原文
///
/// # 返回
/// 标题列表（已跳过块级结构内的伪标题）
pub fn extract_headings(content: &str) -> Vec<OutlineHeading> {
    let excluded = detect_excluded_byte_ranges(content);
    let mut headings = Vec::new();
    let mut byte_offset: usize = 0;

    for (line_index, line) in content.split('\n').enumerate() {
        let line_number = line_index + 1;

        // 检查行首字节是否在排斥区间内
        if is_byte_offset_excluded(byte_offset, &excluded) {
            // +1 for '\n'
            byte_offset += line.len() + 1;
            continue;
        }

        // ATX 标题匹配：以 1–6 个 '#' 开头，后跟至少一个空白字符
        let trimmed = line.trim_end();
        if let Some(rest) = trimmed.strip_prefix('#') {
            // 计算连续 '#' 数量
            let hashes = 1 + rest.chars().take_while(|c| *c == '#').count();
            if hashes <= 6 {
                let after_hashes = &trimmed[hashes..];
                // '#' 后必须紧跟空白字符或行尾
                if after_hashes.is_empty() {
                    // 空标题（仅 ###），跳过
                } else if after_hashes.starts_with(' ') || after_hashes.starts_with('\t') {
                    let text = after_hashes.trim().to_string();
                    if !text.is_empty() {
                        headings.push(OutlineHeading {
                            level: hashes as u8,
                            text,
                            line: line_number,
                        });
                    }
                }
            }
        }

        // +1 for '\n'
        byte_offset += line.len() + 1;
    }

    headings
}

/// 在指定 vault root 下提取 Markdown 文件大纲。
///
/// # 参数
/// - `vault_root`：仓库根目录
/// - `relative_path`：目标文件相对路径
///
/// # 返回
/// 大纲响应（文件路径 + 标题列表）
///
/// # 错误
/// 文件不存在或读取失败时返回错误字符串
pub fn get_vault_markdown_outline_in_root(
    vault_root: &Path,
    relative_path: String,
) -> Result<OutlineResponse, String> {
    log::info!(
        "[vault-outline] get_vault_markdown_outline start: relative_path={}",
        relative_path
    );

    let file_path = resolve_markdown_path(vault_root, &relative_path)?;
    let content = fs::read_to_string(&file_path)
        .map_err(|error| format!("读取 Markdown 文件失败 {}: {error}", file_path.display()))?;
    let headings = extract_headings(&content);

    log::info!(
        "[vault-outline] get_vault_markdown_outline success: relative_path={} headings={}",
        relative_path,
        headings.len()
    );

    Ok(OutlineResponse {
        relative_path,
        headings,
    })
}

/// Tauri 命令包装：读取当前仓库笔记大纲。
pub fn get_vault_markdown_outline(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<OutlineResponse, String> {
    let vault_root = get_vault_root(&state)?;
    get_vault_markdown_outline_in_root(&vault_root, relative_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_headings() {
        let content = "# Title\n## Section\n### Sub\ntext\n#### Deep";
        let headings = extract_headings(content);
        assert_eq!(headings.len(), 4);
        assert_eq!(
            headings[0],
            OutlineHeading {
                level: 1,
                text: "Title".to_string(),
                line: 1
            }
        );
        assert_eq!(
            headings[1],
            OutlineHeading {
                level: 2,
                text: "Section".to_string(),
                line: 2
            }
        );
        assert_eq!(
            headings[2],
            OutlineHeading {
                level: 3,
                text: "Sub".to_string(),
                line: 3
            }
        );
        assert_eq!(
            headings[3],
            OutlineHeading {
                level: 4,
                text: "Deep".to_string(),
                line: 5
            }
        );
    }

    #[test]
    fn test_skip_code_block_headings() {
        let content = "# Real Title\n```\n# Fake Title\n```\n## Another Real";
        let headings = extract_headings(content);
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].text, "Real Title");
        assert_eq!(headings[1].text, "Another Real");
    }

    #[test]
    fn test_skip_frontmatter() {
        let content = "---\ntitle: test\n---\n# Heading After Frontmatter";
        let headings = extract_headings(content);
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].text, "Heading After Frontmatter");
        assert_eq!(headings[0].line, 4);
    }

    #[test]
    fn test_skip_latex_block() {
        let content = "# Before\n$$\n# In Latex\n$$\n# After";
        let headings = extract_headings(content);
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].text, "Before");
        assert_eq!(headings[1].text, "After");
    }

    #[test]
    fn test_empty_heading_skipped() {
        let content = "# \n## Real\n###\n";
        let headings = extract_headings(content);
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].text, "Real");
    }

    #[test]
    fn test_heading_level_limit() {
        let content = "####### Not a heading\n###### H6 Title";
        let headings = extract_headings(content);
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].level, 6);
        assert_eq!(headings[0].text, "H6 Title");
    }

    #[test]
    fn test_no_space_after_hash() {
        let content = "#NoSpace\n# With Space";
        let headings = extract_headings(content);
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].text, "With Space");
    }
}
