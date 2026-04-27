//! # Chunking Strategy 抽象
//!
//! 定义语义索引模块的可插拔 chunking strategy 边界，并提供两个内建策略：
//! `heading-paragraph` 与 `whole-document`。

#![cfg_attr(not(test), allow(dead_code))]

use crate::shared::semantic_index_contracts::{ChunkingStrategyDescriptor, ChunkingStrategyKind};

/// 单个待建立 embedding 的 chunk 草稿。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SemanticChunkDraft {
    /// 文档相对路径。
    pub relative_path: String,
    /// 标题路径。
    pub heading_path: Option<String>,
    /// 起始行号。
    pub start_line: usize,
    /// 结束行号。
    pub end_line: usize,
    /// chunk 文本。
    pub text: String,
}

/// Chunking strategy 抽象。
pub(crate) trait ChunkingStrategy: Send + Sync {
    /// 返回 strategy 描述。
    fn descriptor(&self) -> ChunkingStrategyDescriptor;

    /// 将 Markdown 文本切分为 chunk 草稿。
    fn chunk_markdown(&self, relative_path: &str, content: &str) -> Vec<SemanticChunkDraft>;
}

/// 返回当前宿主支持的 chunking strategy 列表。
pub(crate) fn available_chunking_strategies() -> Vec<ChunkingStrategyDescriptor> {
    vec![
        HeadingParagraphChunkingStrategy.descriptor(),
        WholeDocumentChunkingStrategy.descriptor(),
    ]
}

/// 根据设置构建 chunking strategy。
pub(crate) fn build_chunking_strategy(
    kind: ChunkingStrategyKind,
) -> Result<Box<dyn ChunkingStrategy>, String> {
    match kind {
        ChunkingStrategyKind::HeadingParagraph => Ok(Box::new(HeadingParagraphChunkingStrategy)),
        ChunkingStrategyKind::WholeDocument => Ok(Box::new(WholeDocumentChunkingStrategy)),
    }
}

/// “按标题、再按段落”切块策略。
struct HeadingParagraphChunkingStrategy;

/// “整文档单块”切块策略。
struct WholeDocumentChunkingStrategy;

impl ChunkingStrategy for HeadingParagraphChunkingStrategy {
    fn descriptor(&self) -> ChunkingStrategyDescriptor {
        ChunkingStrategyDescriptor {
            kind: ChunkingStrategyKind::HeadingParagraph,
            display_name: "Heading + Paragraph".to_string(),
            description: "Split markdown by heading sections and paragraph boundaries while skipping frontmatter and fenced blocks.".to_string(),
        }
    }

    fn chunk_markdown(&self, relative_path: &str, content: &str) -> Vec<SemanticChunkDraft> {
        let lines = content.split('\n').collect::<Vec<_>>();
        let mut chunks = Vec::new();
        let mut heading_path: Vec<String> = Vec::new();
        let mut current_lines: Vec<String> = Vec::new();
        let mut current_start_line: Option<usize> = None;
        let mut in_frontmatter = false;
        let mut in_code_fence: Option<(char, usize)> = None;
        let mut in_latex_block = false;

        let flush_current_lines = |chunks: &mut Vec<SemanticChunkDraft>,
                                   current_lines: &mut Vec<String>,
                                   current_start_line: &mut Option<usize>,
                                   heading_path: &[String]| {
            let Some(start_line) = *current_start_line else {
                current_lines.clear();
                return;
            };

            let text = current_lines.join("\n").trim().to_string();
            if text.is_empty() {
                current_lines.clear();
                *current_start_line = None;
                return;
            }

            let end_line = start_line + current_lines.len().saturating_sub(1);
            chunks.push(SemanticChunkDraft {
                relative_path: relative_path.to_string(),
                heading_path: if heading_path.is_empty() {
                    None
                } else {
                    Some(heading_path.join(" / "))
                },
                start_line,
                end_line,
                text,
            });
            current_lines.clear();
            *current_start_line = None;
        };

        for (index, line) in lines.iter().enumerate() {
            let line_number = index + 1;
            let trimmed = line.trim_end();
            let trimmed_start = trimmed.trim_start();

            if index == 0 && trimmed == "---" {
                in_frontmatter = true;
                continue;
            }

            if in_frontmatter {
                if trimmed == "---" {
                    in_frontmatter = false;
                }
                continue;
            }

            if let Some((fence_char, fence_len)) = in_code_fence {
                if is_fence_close(trimmed_start, fence_char, fence_len) {
                    in_code_fence = None;
                }
                continue;
            }

            if in_latex_block {
                if trimmed == "$$" {
                    in_latex_block = false;
                }
                continue;
            }

            if let Some((fence_char, fence_len)) = parse_fence_open(trimmed_start) {
                flush_current_lines(
                    &mut chunks,
                    &mut current_lines,
                    &mut current_start_line,
                    &heading_path,
                );
                in_code_fence = Some((fence_char, fence_len));
                continue;
            }

            if trimmed == "$$" {
                flush_current_lines(
                    &mut chunks,
                    &mut current_lines,
                    &mut current_start_line,
                    &heading_path,
                );
                in_latex_block = true;
                continue;
            }

            if let Some((level, title)) = parse_markdown_heading(trimmed_start) {
                flush_current_lines(
                    &mut chunks,
                    &mut current_lines,
                    &mut current_start_line,
                    &heading_path,
                );
                heading_path.truncate(level.saturating_sub(1));
                heading_path.push(title.to_string());
                continue;
            }

            if trimmed.trim().is_empty() {
                flush_current_lines(
                    &mut chunks,
                    &mut current_lines,
                    &mut current_start_line,
                    &heading_path,
                );
                continue;
            }

            if current_start_line.is_none() {
                current_start_line = Some(line_number);
            }
            current_lines.push(trimmed.to_string());
        }

        flush_current_lines(
            &mut chunks,
            &mut current_lines,
            &mut current_start_line,
            &heading_path,
        );

        chunks
    }
}

impl ChunkingStrategy for WholeDocumentChunkingStrategy {
    fn descriptor(&self) -> ChunkingStrategyDescriptor {
        ChunkingStrategyDescriptor {
            kind: ChunkingStrategyKind::WholeDocument,
            display_name: "Whole Document".to_string(),
            description: "Treat the persisted markdown document as a single chunk.".to_string(),
        }
    }

    fn chunk_markdown(&self, relative_path: &str, content: &str) -> Vec<SemanticChunkDraft> {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let line_count = content.split('\n').count();
        vec![SemanticChunkDraft {
            relative_path: relative_path.to_string(),
            heading_path: None,
            start_line: 1,
            end_line: line_count,
            text: trimmed.to_string(),
        }]
    }
}

/// 尝试解析 Markdown 标题。
fn parse_markdown_heading(line: &str) -> Option<(usize, &str)> {
    let hashes = line
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if hashes == 0 || hashes > 6 {
        return None;
    }

    let rest = line.get(hashes..)?.trim_start();
    if rest.is_empty() || rest == line {
        return None;
    }

    Some((hashes, rest))
}

/// 尝试解析围栏代码块开始。
fn parse_fence_open(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_end();
    if trimmed.is_empty() {
        return None;
    }

    let first = trimmed.as_bytes()[0];
    if first != b'`' && first != b'~' {
        return None;
    }

    let fence_char = first as char;
    let fence_len = trimmed.bytes().take_while(|byte| *byte == first).count();
    if fence_len < 3 {
        return None;
    }

    Some((fence_char, fence_len))
}

/// 判断是否为围栏代码块结束行。
fn is_fence_close(line: &str, fence_char: char, fence_len: usize) -> bool {
    let trimmed = line.trim_end();
    if trimmed.is_empty() {
        return false;
    }

    let expected_byte = fence_char as u8;
    let close_len = trimmed
        .bytes()
        .take_while(|byte| *byte == expected_byte)
        .count();
    if close_len < fence_len {
        return false;
    }

    trimmed[close_len..].trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::{
        available_chunking_strategies, build_chunking_strategy, ChunkingStrategy,
        HeadingParagraphChunkingStrategy,
    };
    use crate::shared::semantic_index_contracts::ChunkingStrategyKind;

    #[test]
    fn available_chunking_strategies_should_expose_two_builtin_options() {
        let descriptors = available_chunking_strategies();

        assert_eq!(descriptors.len(), 2);
        assert_eq!(descriptors[0].kind, ChunkingStrategyKind::HeadingParagraph);
        assert_eq!(descriptors[1].kind, ChunkingStrategyKind::WholeDocument);
    }

    #[test]
    fn whole_document_strategy_should_return_one_chunk() {
        let strategy = build_chunking_strategy(ChunkingStrategyKind::WholeDocument)
            .expect("whole-document strategy should build");
        let chunks = strategy.chunk_markdown("Notes/A.md", "# Title\n\nParagraph");

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks[0].end_line, 3);
    }

    #[test]
    fn heading_paragraph_strategy_should_split_by_heading_and_paragraph() {
        let strategy = HeadingParagraphChunkingStrategy;
        let chunks = strategy.chunk_markdown(
            "Notes/A.md",
            "# Intro\n\nfirst paragraph\n\n## Details\nsecond paragraph\nthird line",
        );

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].heading_path, Some("Intro".to_string()));
        assert_eq!(chunks[0].text, "first paragraph");
        assert_eq!(chunks[1].heading_path, Some("Intro / Details".to_string()));
        assert_eq!(chunks[1].text, "second paragraph\nthird line");
    }

    #[test]
    fn heading_paragraph_strategy_should_skip_frontmatter_and_fenced_blocks() {
        let strategy = HeadingParagraphChunkingStrategy;
        let chunks = strategy.chunk_markdown(
            "Notes/A.md",
            "---\ntitle: Test\n---\n# Intro\n\nparagraph\n\n```rust\nlet x = 1;\n```\n\n$$\na+b\n$$\n\nfinal paragraph",
        );

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].text, "paragraph");
        assert_eq!(chunks[1].text, "final paragraph");
    }
}
