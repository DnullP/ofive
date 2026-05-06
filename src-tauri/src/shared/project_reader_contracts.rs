//! # Project Reader Contracts
//!
//! 外部项目只读阅读器的前后端稳定数据契约。

use serde::{Deserialize, Serialize};

/// 已导入的外部项目记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReaderProject {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

/// 已导入项目列表响应。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReaderProjectListResponse {
    pub projects: Vec<ProjectReaderProject>,
}

/// 外部项目文件树中的一个索引项。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReaderTreeEntry {
    pub relative_path: String,
    pub is_dir: bool,
    pub size_bytes: Option<i64>,
    pub modified_at_unix_ms: Option<i64>,
    pub language: Option<String>,
}

/// 外部项目文件树响应。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReaderTreeResponse {
    pub project_id: String,
    pub root_path: String,
    pub entries: Vec<ProjectReaderTreeEntry>,
}

/// 外部项目只读文件内容响应。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReaderFileResponse {
    pub project_id: String,
    pub relative_path: String,
    pub content: String,
    pub language: Option<String>,
    pub size_bytes: i64,
    pub modified_at_unix_ms: Option<i64>,
}

/// 外部项目符号命中位置。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReaderSymbolLocation {
    pub project_id: String,
    pub relative_path: String,
    pub line_number: usize,
    pub column_number: usize,
    pub end_line_number: usize,
    pub end_column_number: usize,
    pub symbol_name: String,
    pub kind: String,
    pub preview: String,
}

/// 外部项目符号解析的调用上下文。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReaderSymbolResolveContext {
    pub current_file_path: Option<String>,
    pub current_line_number: Option<usize>,
    pub current_column_number: Option<usize>,
    pub current_line_text: Option<String>,
    pub current_file_content: Option<String>,
}

/// 外部项目源码片段被当前 vault 笔记引用的位置。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReaderCodeReference {
    pub source_path: String,
    pub title: String,
    pub source_line_number: usize,
    pub source_column_number: usize,
    pub link_text: String,
    pub target: ProjectReaderLinkTarget,
}

/// 外部项目源码 WikiLink 目标。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReaderLinkTarget {
    pub project_name: String,
    pub relative_path: String,
    pub line_number: Option<usize>,
    pub column_number: Option<usize>,
    pub end_line_number: Option<usize>,
    pub end_column_number: Option<usize>,
}

/// 外部项目源码引用查询响应。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReaderCodeReferenceResponse {
    pub project_id: String,
    pub references: Vec<ProjectReaderCodeReference>,
}

/// 外部项目符号解析响应。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReaderSymbolResolveResponse {
    pub project_id: String,
    pub symbol: String,
    pub locations: Vec<ProjectReaderSymbolLocation>,
}
