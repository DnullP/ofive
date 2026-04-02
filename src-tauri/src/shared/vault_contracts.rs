//! # Vault 稳定契约模块
//!
//! 定义 vault 相关命令、查询与 root helper 共享的输入输出结构体。

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultConfig {
    pub schema_version: u32,
    pub entries: Map<String, Value>,
}

impl Default for VaultConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            entries: Map::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub relative_path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetVaultResponse {
    pub vault_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultTreeResponse {
    pub vault_path: String,
    pub entries: Vec<VaultEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadMarkdownResponse {
    pub relative_path: String,
    pub content: String,
    pub numbered_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultIndexedMarkdownFile {
    pub relative_path: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadBinaryFileResponse {
    pub relative_path: String,
    pub mime_type: String,
    pub base64_content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteMarkdownResponse {
    pub relative_path: String,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteBinaryFileResponse {
    pub relative_path: String,
    pub created: bool,
}

/// Markdown 增量修改结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyMarkdownPatchResponse {
    pub relative_path: String,
    pub applied_block_count: usize,
}

/// Canvas 节点种类。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VaultCanvasNodeKind {
    Text,
    File,
    Group,
}

/// Canvas 连线连接侧。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VaultCanvasEdgeSide {
    Top,
    Right,
    Bottom,
    Left,
}

/// Canvas 文档元信息。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultCanvasDocumentMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(flatten)]
    pub extra_fields: BTreeMap<String, Value>,
}

/// Canvas 节点稳定契约。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultCanvasNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: VaultCanvasNodeKind,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(flatten)]
    pub extra_fields: BTreeMap<String, Value>,
}

/// Canvas 边稳定契约。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultCanvasEdge {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_side: Option<VaultCanvasEdgeSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_side: Option<VaultCanvasEdgeSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(flatten)]
    pub extra_fields: BTreeMap<String, Value>,
}

/// Canvas 文档稳定契约。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultCanvasDocument {
    #[serde(default)]
    pub nodes: Vec<VaultCanvasNode>,
    #[serde(default)]
    pub edges: Vec<VaultCanvasEdge>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<VaultCanvasDocumentMetadata>,
    #[serde(flatten)]
    pub extra_fields: BTreeMap<String, Value>,
}

/// 结构化读取 Canvas 文件的响应。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadCanvasDocumentResponse {
    pub relative_path: String,
    pub document: VaultCanvasDocument,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChineseSegmentToken {
    pub word: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWikiLinkTargetResponse {
    pub relative_path: String,
    pub absolute_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveMediaEmbedTargetResponse {
    pub relative_path: String,
    pub absolute_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMarkdownGraphNode {
    pub path: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMarkdownGraphEdge {
    pub source_path: String,
    pub target_path: String,
    pub weight: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMarkdownGraphResponse {
    pub nodes: Vec<VaultMarkdownGraphNode>,
    pub edges: Vec<VaultMarkdownGraphEdge>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyEntryResponse {
    pub relative_path: String,
    pub source_relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultQuickSwitchItem {
    pub relative_path: String,
    pub title: String,
    pub score: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VaultSearchScope {
    All,
    Content,
    FileName,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSearchMatchItem {
    pub relative_path: String,
    pub title: String,
    pub score: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet_line: Option<usize>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub matched_file_name: bool,
    pub matched_content: bool,
    pub matched_tag: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiLinkSuggestionItem {
    pub relative_path: String,
    pub title: String,
    pub score: usize,
    pub reference_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkItem {
    pub source_path: String,
    pub title: String,
    pub weight: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownAstNode {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub attributes: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<MarkdownAstNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadMarkdownAstResponse {
    pub relative_path: String,
    pub ast: MarkdownAstNode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterQueryMatchItem {
    pub relative_path: String,
    pub title: String,
    pub matched_field_name: String,
    pub matched_field_values: Vec<String>,
    pub frontmatter: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterQueryResponse {
    pub field_name: String,
    pub matches: Vec<FrontmatterQueryMatchItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OutlineHeading {
    pub level: u8,
    pub text: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineResponse {
    pub relative_path: String,
    pub headings: Vec<OutlineHeading>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultTaskItem {
    pub relative_path: String,
    pub title: String,
    pub line: usize,
    pub raw_line: String,
    pub checked: bool,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
}
