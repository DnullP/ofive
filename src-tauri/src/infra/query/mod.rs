//! # 查询基础设施模块
//!
//! 提供与 vault 只读查询相关的底层实现，封装索引访问、Markdown
//! 文件读取与块级结构过滤等技术细节，不直接依赖 Tauri `State`。

pub(crate) mod backlinks;
pub(crate) mod frontmatter_query;
pub(crate) mod graph;
pub(crate) mod markdown_ast;
pub(crate) mod markdown_block_detector;
pub(crate) mod outline;
pub(crate) mod query_index;
pub(crate) mod search;
pub(crate) mod segment;
pub(crate) mod task_query;
pub(crate) mod wikilink;
