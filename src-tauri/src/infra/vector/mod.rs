//! # 向量基础设施抽象模块
//!
//! 为语义索引模块提供可插拔的 embedding provider、vector store 与
//! chunking strategy 抽象，避免业务层直接绑定到单一底层实现。

mod chunking;
mod embedding_provider;
mod vector_store;

pub(crate) use chunking::{available_chunking_strategies, build_chunking_strategy};
pub(crate) use embedding_provider::{
    available_embedding_providers, build_embedding_provider, semantic_index_embedding_cache_dir,
};
pub(crate) use vector_store::{
    available_vector_stores, build_vector_store, ensure_sqlite_vec_runtime,
    semantic_index_vector_store_path, SemanticIndexDocumentWrite,
};
