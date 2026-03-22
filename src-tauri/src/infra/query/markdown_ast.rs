//! # Markdown AST 查询基础设施模块
//!
//! 提供纯后端 Markdown AST 解析能力，不直接依赖 Tauri `State`。

use crate::infra::fs::fs_helpers::resolve_markdown_path;
use crate::shared::vault_contracts::{MarkdownAstNode, ReadMarkdownAstResponse};
use pulldown_cmark::{CodeBlockKind, CowStr, Event, HeadingLevel, LinkType, Options, Parser, Tag};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

fn new_ast_node(kind: &str) -> MarkdownAstNode {
    MarkdownAstNode {
        kind: kind.to_string(),
        value: None,
        attributes: BTreeMap::new(),
        children: Vec::new(),
    }
}

fn new_leaf_node(kind: &str, value: String) -> MarkdownAstNode {
    MarkdownAstNode {
        kind: kind.to_string(),
        value: Some(value),
        attributes: BTreeMap::new(),
        children: Vec::new(),
    }
}

fn link_type_name(link_type: LinkType) -> &'static str {
    match link_type {
        LinkType::Inline => "inline",
        LinkType::Reference => "reference",
        LinkType::ReferenceUnknown => "reference-unknown",
        LinkType::Collapsed => "collapsed",
        LinkType::CollapsedUnknown => "collapsed-unknown",
        LinkType::Shortcut => "shortcut",
        LinkType::ShortcutUnknown => "shortcut-unknown",
        LinkType::Autolink => "autolink",
        LinkType::Email => "email",
    }
}

fn heading_level_number(level: HeadingLevel) -> &'static str {
    match level {
        HeadingLevel::H1 => "1",
        HeadingLevel::H2 => "2",
        HeadingLevel::H3 => "3",
        HeadingLevel::H4 => "4",
        HeadingLevel::H5 => "5",
        HeadingLevel::H6 => "6",
    }
}

fn insert_attr_if_non_empty(
    attrs: &mut BTreeMap<String, String>,
    key: &str,
    value: impl Into<String>,
) {
    let value = value.into();
    if !value.is_empty() {
        attrs.insert(key.to_string(), value);
    }
}

fn cow_to_string(value: CowStr<'_>) -> String {
    value.into_string()
}

fn ast_node_from_tag(tag: Tag<'_>) -> MarkdownAstNode {
    match tag {
        Tag::Paragraph => new_ast_node("paragraph"),
        Tag::Heading(level, id, classes) => {
            let mut node = new_ast_node("heading");
            node.attributes
                .insert("level".to_string(), heading_level_number(level).to_string());
            if let Some(id) = id {
                insert_attr_if_non_empty(&mut node.attributes, "id", id.to_string());
            }
            if !classes.is_empty() {
                node.attributes
                    .insert("classes".to_string(), classes.join(" "));
            }
            node
        }
        Tag::BlockQuote => new_ast_node("blockquote"),
        Tag::CodeBlock(kind) => {
            let mut node = new_ast_node("codeBlock");
            match kind {
                CodeBlockKind::Indented => {
                    node.attributes
                        .insert("codeBlockKind".to_string(), "indented".to_string());
                }
                CodeBlockKind::Fenced(language) => {
                    node.attributes
                        .insert("codeBlockKind".to_string(), "fenced".to_string());
                    insert_attr_if_non_empty(
                        &mut node.attributes,
                        "language",
                        cow_to_string(language),
                    );
                }
            }
            node
        }
        Tag::List(start) => {
            let mut node = new_ast_node("list");
            match start {
                Some(value) => {
                    node.attributes
                        .insert("ordered".to_string(), "true".to_string());
                    node.attributes
                        .insert("start".to_string(), value.to_string());
                }
                None => {
                    node.attributes
                        .insert("ordered".to_string(), "false".to_string());
                }
            }
            node
        }
        Tag::Item => new_ast_node("listItem"),
        Tag::FootnoteDefinition(name) => {
            let mut node = new_ast_node("footnoteDefinition");
            insert_attr_if_non_empty(&mut node.attributes, "name", cow_to_string(name));
            node
        }
        Tag::Table(alignments) => {
            let mut node = new_ast_node("table");
            let alignments_text = alignments
                .into_iter()
                .map(|alignment| match alignment {
                    pulldown_cmark::Alignment::None => "none",
                    pulldown_cmark::Alignment::Left => "left",
                    pulldown_cmark::Alignment::Center => "center",
                    pulldown_cmark::Alignment::Right => "right",
                })
                .collect::<Vec<_>>()
                .join(",");
            insert_attr_if_non_empty(&mut node.attributes, "alignments", alignments_text);
            node
        }
        Tag::TableHead => new_ast_node("tableHead"),
        Tag::TableRow => new_ast_node("tableRow"),
        Tag::TableCell => new_ast_node("tableCell"),
        Tag::Emphasis => new_ast_node("emphasis"),
        Tag::Strong => new_ast_node("strong"),
        Tag::Strikethrough => new_ast_node("strikethrough"),
        Tag::Link(link_type, destination, title) => {
            let mut node = new_ast_node("link");
            node.attributes.insert(
                "linkType".to_string(),
                link_type_name(link_type).to_string(),
            );
            insert_attr_if_non_empty(
                &mut node.attributes,
                "destination",
                cow_to_string(destination),
            );
            insert_attr_if_non_empty(&mut node.attributes, "title", cow_to_string(title));
            node
        }
        Tag::Image(link_type, destination, title) => {
            let mut node = new_ast_node("image");
            node.attributes.insert(
                "linkType".to_string(),
                link_type_name(link_type).to_string(),
            );
            insert_attr_if_non_empty(
                &mut node.attributes,
                "destination",
                cow_to_string(destination),
            );
            insert_attr_if_non_empty(&mut node.attributes, "title", cow_to_string(title));
            node
        }
    }
}

/// 将 Markdown 文本解析为可序列化 AST。
pub(crate) fn parse_markdown_to_ast(content: &str) -> Result<MarkdownAstNode, String> {
    let parser = Parser::new_ext(content, Options::all());
    let mut stack = vec![new_ast_node("document")];

    for event in parser {
        match event {
            Event::Start(tag) => stack.push(ast_node_from_tag(tag)),
            Event::End(_) => {
                if stack.len() <= 1 {
                    return Err("Markdown AST 构建失败：遇到多余的结束标签".to_string());
                }

                let node = stack
                    .pop()
                    .ok_or_else(|| "Markdown AST 构建失败：节点栈为空".to_string())?;
                let parent = stack
                    .last_mut()
                    .ok_or_else(|| "Markdown AST 构建失败：缺少父节点容器".to_string())?;
                parent.children.push(node);
            }
            Event::Text(text) => stack
                .last_mut()
                .expect("document root should exist")
                .children
                .push(new_leaf_node("text", cow_to_string(text))),
            Event::Code(code) => stack
                .last_mut()
                .expect("document root should exist")
                .children
                .push(new_leaf_node("code", cow_to_string(code))),
            Event::Html(html) => stack
                .last_mut()
                .expect("document root should exist")
                .children
                .push(new_leaf_node("html", cow_to_string(html))),
            Event::FootnoteReference(name) => {
                let mut node = new_ast_node("footnoteReference");
                insert_attr_if_non_empty(&mut node.attributes, "name", cow_to_string(name));
                stack
                    .last_mut()
                    .expect("document root should exist")
                    .children
                    .push(node);
            }
            Event::SoftBreak => stack
                .last_mut()
                .expect("document root should exist")
                .children
                .push(new_ast_node("softBreak")),
            Event::HardBreak => stack
                .last_mut()
                .expect("document root should exist")
                .children
                .push(new_ast_node("hardBreak")),
            Event::Rule => stack
                .last_mut()
                .expect("document root should exist")
                .children
                .push(new_ast_node("rule")),
            Event::TaskListMarker(checked) => {
                let mut node = new_ast_node("taskListMarker");
                node.attributes
                    .insert("checked".to_string(), checked.to_string());
                stack
                    .last_mut()
                    .expect("document root should exist")
                    .children
                    .push(node);
            }
        }
    }

    if stack.len() != 1 {
        return Err("Markdown AST 构建失败：存在未闭合标签".to_string());
    }

    stack
        .pop()
        .ok_or_else(|| "Markdown AST 构建失败：根节点缺失".to_string())
}

/// 在指定仓库根目录下读取 Markdown AST。
pub(crate) fn get_vault_markdown_ast_in_root(
    vault_root: &Path,
    relative_path: String,
) -> Result<ReadMarkdownAstResponse, String> {
    log::info!(
        "[vault-ast] get_vault_markdown_ast start: relative_path={}",
        relative_path
    );

    let file_path = resolve_markdown_path(vault_root, &relative_path)?;
    let content = fs::read_to_string(&file_path)
        .map_err(|error| format!("读取 Markdown 文件失败 {}: {error}", file_path.display()))?;
    let ast = parse_markdown_to_ast(&content)?;

    log::info!(
        "[vault-ast] get_vault_markdown_ast success: relative_path={} children={}",
        relative_path,
        ast.children.len()
    );

    Ok(ReadMarkdownAstResponse { relative_path, ast })
}

#[cfg(test)]
mod tests {
    use super::{get_vault_markdown_ast_in_root, parse_markdown_to_ast};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root =
            std::env::temp_dir().join(format!("ofive-markdown-ast-test-{unique}-{sequence}"));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    #[test]
    fn parse_markdown_to_ast_should_build_nested_tree() {
        let ast = parse_markdown_to_ast("# Title\n\nA [link](./topic.md) and `code`.\n")
            .expect("解析 Markdown AST 应成功");

        assert_eq!(ast.kind, "document");
        assert_eq!(ast.children.len(), 2);
        assert_eq!(ast.children[0].kind, "heading");
        assert_eq!(
            ast.children[0].attributes.get("level"),
            Some(&"1".to_string())
        );
        assert_eq!(ast.children[0].children[0].value.as_deref(), Some("Title"));

        let paragraph = &ast.children[1];
        assert_eq!(paragraph.kind, "paragraph");
        assert!(paragraph.children.iter().any(|node| {
            node.kind == "link"
                && node.attributes.get("destination") == Some(&"./topic.md".to_string())
        }));
        assert!(paragraph
            .children
            .iter()
            .any(|node| { node.kind == "code" && node.value.as_deref() == Some("code") }));
    }

    #[test]
    fn parse_markdown_to_ast_should_capture_list_and_code_block_attributes() {
        let ast = parse_markdown_to_ast("1. item\n\n```rust\nfn main() {}\n```\n")
            .expect("解析 Markdown AST 应成功");

        assert_eq!(ast.children[0].kind, "list");
        assert_eq!(
            ast.children[0].attributes.get("ordered"),
            Some(&"true".to_string())
        );
        assert_eq!(
            ast.children[0].attributes.get("start"),
            Some(&"1".to_string())
        );

        assert_eq!(ast.children[1].kind, "codeBlock");
        assert_eq!(
            ast.children[1].attributes.get("codeBlockKind"),
            Some(&"fenced".to_string())
        );
        assert_eq!(
            ast.children[1].attributes.get("language"),
            Some(&"rust".to_string())
        );
    }

    #[test]
    fn get_vault_markdown_ast_in_root_should_read_file_and_return_ast() {
        let root = create_test_root();
        let file_path = root.join("notes/guide.md");
        fs::create_dir_all(file_path.parent().expect("应存在父目录")).expect("应成功创建笔记目录");
        fs::write(&file_path, "# Guide\n\nParagraph").expect("应成功写入 Markdown 文件");

        let response = get_vault_markdown_ast_in_root(&root, "notes/guide.md".to_string())
            .expect("读取 Markdown AST 应成功");

        assert_eq!(response.relative_path, "notes/guide.md");
        assert_eq!(response.ast.kind, "document");
        assert_eq!(response.ast.children[0].kind, "heading");
    }
}