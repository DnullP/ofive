//! # Semantic Index 稳定契约模块
//!
//! 定义语义索引模块对外暴露的稳定输入输出结构，
//! 供 capability execution、未来诊断命令、受控 facade 与可插拔后端配置共享。

use serde::{Deserialize, Serialize};

/// 默认检索返回数量上限。
pub const DEFAULT_SEMANTIC_INDEX_SEARCH_RESULT_LIMIT: usize = 10;
/// 检索返回数量上限的最小值。
pub const MIN_SEMANTIC_INDEX_SEARCH_RESULT_LIMIT: usize = 1;
/// 检索返回数量上限的最大值。
pub const MAX_SEMANTIC_INDEX_SEARCH_RESULT_LIMIT: usize = 50;

fn default_semantic_index_search_result_limit() -> usize {
    DEFAULT_SEMANTIC_INDEX_SEARCH_RESULT_LIMIT
}

/// Embedding provider 类型。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EmbeddingProviderKind {
    /// 基于 fastembed-rs 的本地 embedding provider。
    FastEmbed,
}

impl Default for EmbeddingProviderKind {
    fn default() -> Self {
        Self::FastEmbed
    }
}

/// Vector store 类型。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum VectorStoreKind {
    /// 基于 sqlite-vec 的本地向量库。
    SqliteVec,
}

impl Default for VectorStoreKind {
    fn default() -> Self {
        Self::SqliteVec
    }
}

/// Chunking strategy 类型。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ChunkingStrategyKind {
    /// 先按标题、再按段落切块。
    HeadingParagraph,
    /// 将整篇文档视为一个单块。
    WholeDocument,
}

impl Default for ChunkingStrategyKind {
    fn default() -> Self {
        Self::HeadingParagraph
    }
}

/// Embedding provider 描述。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingProviderDescriptor {
    /// provider 类型。
    pub kind: EmbeddingProviderKind,
    /// 展示名称。
    pub display_name: String,
    /// provider 支持的模型 ID 列表。
    pub supported_model_ids: Vec<String>,
    /// 默认模型 ID。
    pub default_model_id: String,
}

/// Vector store 描述。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VectorStoreDescriptor {
    /// store 类型。
    pub kind: VectorStoreKind,
    /// 展示名称。
    pub display_name: String,
    /// 说明信息。
    pub description: String,
}

/// Chunking strategy 描述。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChunkingStrategyDescriptor {
    /// strategy 类型。
    pub kind: ChunkingStrategyKind,
    /// 展示名称。
    pub display_name: String,
    /// 说明信息。
    pub description: String,
}

/// 当前宿主内建可选后端目录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexBackendCatalog {
    /// 可用 embedding provider 列表。
    pub embedding_providers: Vec<EmbeddingProviderDescriptor>,
    /// 可用 vector store 列表。
    pub vector_stores: Vec<VectorStoreDescriptor>,
    /// 可用 chunking strategy 列表。
    pub chunking_strategies: Vec<ChunkingStrategyDescriptor>,
}

/// 语义索引模型安装状态。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SemanticIndexModelInstallStatus {
    /// 当前模型尚未安装到本地缓存。
    NotInstalled,
    /// 当前模型正在后台安装。
    Installing,
    /// 当前模型已安装，可被选择为活跃模型。
    Installed,
    /// 当前模型安装曾失败，需要用户重试。
    Failed,
}

/// 单个 embedding 模型的用户态描述。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexModelCatalogItem {
    /// 模型稳定 ID。
    pub model_id: String,
    /// 展示名称。
    pub display_name: String,
    /// 所属 provider。
    pub embedding_provider: EmbeddingProviderKind,
    /// 是否为 provider 默认模型。
    pub is_default: bool,
    /// 是否为当前设置选中的模型。
    pub is_selected: bool,
    /// 当前安装状态。
    pub install_status: SemanticIndexModelInstallStatus,
    /// 当前模型 embedding 维度，未知时为 `None`。
    pub dimensions: Option<usize>,
    /// 最近一次安装完成时间戳。
    pub installed_at_ms: Option<i64>,
    /// 最近一次安装错误摘要。
    pub last_error: Option<String>,
}

/// 当前用户可见的 embedding 模型目录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexModelCatalog {
    /// 当前设置是否已启用语义索引。
    pub enabled: bool,
    /// 当前 provider。
    pub embedding_provider: EmbeddingProviderKind,
    /// 当前选中的模型 ID。
    pub selected_model_id: String,
    /// 当前 provider 暴露给用户的模型列表。
    pub models: Vec<SemanticIndexModelCatalogItem>,
}

/// 语义索引模块的设置。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexSettings {
    /// 是否启用语义索引。
    pub enabled: bool,
    /// 当前 embedding provider 类型。
    #[serde(default)]
    pub embedding_provider: EmbeddingProviderKind,
    /// 当前 vector store 类型。
    #[serde(default)]
    pub vector_store: VectorStoreKind,
    /// 当前 chunking strategy 类型。
    #[serde(default)]
    pub chunking_strategy: ChunkingStrategyKind,
    /// 当前 embedding 模型 ID。
    pub model_id: String,
    /// 语义检索默认返回数量上限。
    #[serde(default = "default_semantic_index_search_result_limit")]
    pub search_result_limit: usize,
    /// 当前 chunk 策略版本。
    pub chunk_strategy_version: u32,
}

impl Default for SemanticIndexSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            embedding_provider: EmbeddingProviderKind::FastEmbed,
            vector_store: VectorStoreKind::SqliteVec,
            chunking_strategy: ChunkingStrategyKind::HeadingParagraph,
            model_id: "intfloat/multilingual-e5-small".to_string(),
            search_result_limit: DEFAULT_SEMANTIC_INDEX_SEARCH_RESULT_LIMIT,
            chunk_strategy_version: 1,
        }
    }
}

/// 语义索引模块运行状态。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexStatus {
    /// 当前状态标签。
    pub status: String,
    /// 当前设置是否启用语义索引。
    pub enabled: bool,
    /// 当前 embedding provider 类型。
    pub embedding_provider: EmbeddingProviderKind,
    /// 当前 vector store 类型。
    pub vector_store: VectorStoreKind,
    /// 当前 chunking strategy 类型。
    pub chunking_strategy: ChunkingStrategyKind,
    /// 当前模型 ID。
    pub model_id: String,
    /// 当前选中的模型是否已在本地准备完成。
    pub active_model_ready: bool,
    /// 当前索引的 schema 版本。
    pub schema_version: u32,
    /// 最近一次错误摘要。
    pub last_error: Option<String>,
    /// 后台索引队列摘要。
    pub queue_status: SemanticIndexQueueStatus,
}

/// 语义索引后台队列状态。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexQueueStatus {
    /// worker 当前状态：`idle` / `running` / `paused` / `error`。
    pub worker_status: String,
    /// 待处理文件数。
    pub pending_file_count: usize,
    /// 是否已有全量重建请求等待处理。
    pub has_pending_rebuild: bool,
    /// 最近一次文件变更入队时间。
    pub last_enqueued_at_ms: Option<i64>,
    /// 最近一次任务处理完成时间。
    pub last_processed_at_ms: Option<i64>,
    /// 当前全量同步任务的总文件数。
    pub total_file_count: usize,
    /// 当前全量同步任务中已成功处理的文件数。
    pub processed_file_count: usize,
    /// 当前全量同步任务中处理失败的文件数。
    pub failed_file_count: usize,
    /// 当前正在处理的文件路径。
    pub current_file_path: Option<String>,
    /// 最近一次全量同步错误摘要。
    pub last_error: Option<String>,
}

/// 单个已建立索引的 chunk 记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexedChunkRecord {
    /// chunk 唯一标识。
    pub chunk_id: String,
    /// 对应标题路径。
    pub heading_path: Option<String>,
    /// 起始行号。
    pub start_line: usize,
    /// 结束行号。
    pub end_line: usize,
    /// chunk 文本。
    pub text: String,
}

/// 单个已建立索引的 Markdown 文档记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexedDocumentRecord {
    /// Markdown 相对路径。
    pub relative_path: String,
    /// 内容哈希。
    pub content_hash: String,
    /// 当前文档使用的 chunking strategy。
    pub chunking_strategy: ChunkingStrategyKind,
    /// 当前文档使用的 chunk 策略版本。
    pub chunk_strategy_version: u32,
    /// 文档建立索引的时间戳。
    pub indexed_at_ms: i64,
    /// 文档对应的全部 chunk。
    pub chunks: Vec<SemanticIndexedChunkRecord>,
}

/// 模块私有索引快照。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexSnapshot {
    /// 快照 schema 版本。
    pub schema_version: u32,
    /// 已建立索引的文档列表。
    pub documents: Vec<SemanticIndexedDocumentRecord>,
}

impl Default for SemanticIndexSnapshot {
    fn default() -> Self {
        Self {
            schema_version: 1,
            documents: Vec::new(),
        }
    }
}

/// 单条语义检索结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResultItem {
    /// 命中的 Markdown 相对路径。
    pub relative_path: String,
    /// 命中的标题路径。
    pub heading_path: Option<String>,
    /// 命中 chunk 的起始行号。
    pub start_line: usize,
    /// 命中 chunk 的结束行号。
    pub end_line: usize,
    /// 命中的 chunk 文本。
    pub chunk_text: String,
    /// 与 query 的距离分数。
    pub distance: f32,
    /// chunk 最近一次建立索引的时间。
    pub indexed_at_ms: i64,
}

/// 语义检索响应。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResponse {
    /// 当前索引状态：`ready` / `building` / `disabled` / `empty`。
    pub status: String,
    /// 当前模型 ID。
    pub model_id: String,
    /// 检索结果列表。
    pub results: Vec<SemanticSearchResultItem>,
}

/// 语义检索输入。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchRequest {
    /// 检索 query。
    pub query: String,
    /// 返回结果上限。
    pub limit: Option<usize>,
    /// 可选相对路径前缀过滤。
    pub relative_path_prefix: Option<String>,
    /// 需要排除的路径列表。
    #[serde(default)]
    pub exclude_paths: Vec<String>,
    /// 可选分数阈值。
    pub score_threshold: Option<f32>,
}