//! # Markdown 大纲查询基础设施模块
//!
//! 从已持久化的 Markdown 文件中提取标题列表，返回标题级别、文本和
//! 所在行号，供上层应用服务和宿主命令复用。

use crate::infra::fs::fs_helpers::resolve_markdown_path;
use crate::infra::query::markdown_block_detector::{
    detect_excluded_byte_ranges, is_byte_offset_excluded,
};
use crate::shared::vault_contracts::{OutlineHeading, OutlineResponse};
use std::fs;
use std::path::Path;

/// 从 Markdown 文本中提取标题列表。
///
/// # 参数
/// - `content`：Markdown 原文
///
/// # 返回
/// - 标题列表，已跳过 frontmatter、代码块和 LaTeX 块中的伪标题
pub(crate) fn extract_headings(content: &str) -> Vec<OutlineHeading> {
    let excluded = detect_excluded_byte_ranges(content);
    let mut headings = Vec::new();
    let mut byte_offset: usize = 0;

    for (line_index, line) in content.split('\n').enumerate() {
        let line_number = line_index + 1;

        if is_byte_offset_excluded(byte_offset, &excluded) {
            byte_offset += line.len() + 1;
            continue;
        }

        let trimmed = line.trim_end();
        if let Some(rest) = trimmed.strip_prefix('#') {
            let hashes = 1 + rest
                .chars()
                .take_while(|character| *character == '#')
                .count();
            if hashes <= 6 {
                let after_hashes = &trimmed[hashes..];
                if after_hashes.is_empty() {
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

        byte_offset += line.len() + 1;
    }

    headings
}

/// 在指定 vault 根目录下提取 Markdown 文件大纲。
///
/// # 参数
/// - `vault_root`：仓库根目录
/// - `relative_path`：目标文件相对路径
///
/// # 返回
/// - 大纲响应，包含文件相对路径与标题列表
///
/// # 错误
/// - 文件不存在或读取失败时返回错误字符串
pub(crate) fn get_vault_markdown_outline_in_root(
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
