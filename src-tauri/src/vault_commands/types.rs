//! # 仓库命令返回类型模块
//!
//! 定义 `vault_commands` 各命令对外暴露的响应结构体。

use serde::Serialize;

/// `VaultEntry` 表示仓库目录树中的单个节点。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    /// 相对路径（相对于 vault 根目录）。
    pub relative_path: String,
    /// 是否为目录。
    pub is_dir: bool,
}

/// 对外返回的 vault 设置结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetVaultResponse {
    /// 当前生效的 vault 绝对路径。
    pub vault_path: String,
}

/// 对外返回的仓库目录树结构。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultTreeResponse {
    /// 当前仓库路径。
    pub vault_path: String,
    /// 扁平化目录树节点。
    pub entries: Vec<VaultEntry>,
}

/// 对外返回的 Markdown 文件读取结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadMarkdownResponse {
    /// 文件相对路径。
    pub relative_path: String,
    /// 文件内容。
    pub content: String,
}

/// 对外返回的二进制文件读取结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadBinaryFileResponse {
    /// 文件相对路径。
    pub relative_path: String,
    /// MIME 类型。
    pub mime_type: String,
    /// Base64 编码后的二进制内容。
    pub base64_content: String,
}

/// 对外返回的写入类文件操作结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteMarkdownResponse {
    /// 文件相对路径。
    pub relative_path: String,
    /// 是否实际创建了新文件。
    pub created: bool,
}

/// 对外返回的二进制文件写入结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteBinaryFileResponse {
    /// 写入后文件的相对路径。
    pub relative_path: String,
    /// 是否实际创建了新文件。
    pub created: bool,
}

/// 对外返回的中文分词 token 结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChineseSegmentToken {
    /// 分词文本。
    pub word: String,
    /// token 起始偏移（UTF-16 code unit）。
    pub start: usize,
    /// token 结束偏移（UTF-16 code unit）。
    pub end: usize,
}

/// 对外返回的 WikiLink 目标解析结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWikiLinkTargetResponse {
    /// 命中文件的相对路径（相对于 vault 根目录）。
    pub relative_path: String,
    /// 命中文件的绝对路径。
    pub absolute_path: String,
}

/// 对外返回的图片嵌入目标解析结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveMediaEmbedTargetResponse {
    /// 命中文件的相对路径（相对于 vault 根目录）。
    pub relative_path: String,
    /// 命中文件的绝对路径。
    pub absolute_path: String,
}

/// 对外返回的 Markdown 图谱节点。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMarkdownGraphNode {
    /// 节点路径（相对 vault 根目录）。
    pub path: String,
    /// 节点标题（默认取文件名，不含扩展名）。
    pub title: String,
}

/// 对外返回的 Markdown 图谱边。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMarkdownGraphEdge {
    /// 边起点路径（相对 vault 根目录）。
    pub source_path: String,
    /// 边终点路径（相对 vault 根目录）。
    pub target_path: String,
    /// 边权重（同一源->目标出现次数）。
    pub weight: usize,
}

/// 对外返回的 Markdown 图谱数据。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMarkdownGraphResponse {
    /// 图谱节点集合。
    pub nodes: Vec<VaultMarkdownGraphNode>,
    /// 图谱边集合。
    pub edges: Vec<VaultMarkdownGraphEdge>,
}

/// 对外返回的条目复制操作结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyEntryResponse {
    /// 复制后新文件/目录的相对路径。
    pub relative_path: String,
    /// 原始文件/目录的相对路径。
    pub source_relative_path: String,
}

/// 对外返回的快速切换搜索结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultQuickSwitchItem {
    /// 命中的文件相对路径（相对于 vault 根目录）。
    pub relative_path: String,
    /// 展示标题（默认取文件名，不含扩展名）。
    pub title: String,
    /// 匹配评分（越高越相关）。
    pub score: usize,
}

/// WikiLink 补全建议项。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiLinkSuggestionItem {
    /// 文件相对路径（相对于 vault 根目录）。
    pub relative_path: String,
    /// 展示标题（文件名，不含扩展名）。
    pub title: String,
    /// 综合评分（越高越相关）。
    pub score: usize,
    /// 被引用次数（入链权重和）。
    pub reference_count: usize,
}

/// 反向链接条目：表示一个指向目标文件的源文件。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkItem {
    /// 引用源文件的相对路径（相对于 vault 根目录）。
    pub source_path: String,
    /// 引用源文件的标题（文件名去除扩展名）。
    pub title: String,
    /// 引用权重（同一源文件对目标的引用次数）。
    pub weight: usize,
}
