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
