//! # Test Support Facade
//!
//! 为集成测试与基准测试提供稳定的后端辅助出口，避免它们继续直接依赖
//! crate 根上的大批量 `pub use` 聚合。
//!
//! 使用示例：
//! ```rust,ignore
//! use ofive_lib::test_support::{
//!     create_vault_markdown_file_in_root,
//!     get_current_vault_tree_in_root,
//! };
//! ```

pub use crate::app::vault::query_app_service::get_backlinks_for_file_in_root;
pub use crate::app::vault::query_app_service::get_current_vault_markdown_graph_in_root;
pub use crate::app::vault::query_app_service::get_vault_markdown_ast_in_root;
pub use crate::app::vault::query_app_service::get_vault_markdown_outline_in_root;
pub use crate::app::vault::query_app_service::parse_markdown_to_ast;
pub use crate::app::vault::query_app_service::query_vault_markdown_frontmatter_in_root;
pub use crate::app::vault::query_app_service::query_vault_tasks_in_root;
pub use crate::app::vault::query_app_service::resolve_media_embed_target_in_root;
pub use crate::app::vault::query_app_service::resolve_wikilink_target_in_root;
pub use crate::app::vault::query_app_service::search_vault_markdown_files_in_root;
pub use crate::app::vault::query_app_service::search_vault_markdown_in_root;
pub use crate::app::vault::query_app_service::suggest_wikilink_targets_in_root;
pub use crate::app::vault::vault_app_service::copy_vault_entry_in_root;
pub use crate::app::vault::vault_app_service::create_vault_binary_file_in_root;
pub use crate::app::vault::vault_app_service::create_vault_directory_in_root;
pub use crate::app::vault::vault_app_service::create_vault_markdown_file_in_root;
pub use crate::app::vault::vault_app_service::delete_vault_binary_file_in_root;
pub use crate::app::vault::vault_app_service::delete_vault_directory_in_root;
pub use crate::app::vault::vault_app_service::delete_vault_markdown_file_in_root;
pub use crate::app::vault::vault_app_service::get_current_vault_config_in_root;
pub use crate::app::vault::vault_app_service::get_current_vault_tree_in_root;
pub use crate::app::vault::vault_app_service::move_vault_directory_to_directory_in_root;
pub use crate::app::vault::vault_app_service::move_vault_markdown_file_to_directory_in_root;
pub use crate::app::vault::vault_app_service::read_vault_binary_file_in_root;
pub use crate::app::vault::vault_app_service::read_vault_markdown_file_in_root;
pub use crate::app::vault::vault_app_service::rename_vault_directory_in_root;
pub use crate::app::vault::vault_app_service::rename_vault_markdown_file_in_root;
pub use crate::app::vault::vault_app_service::save_current_vault_config_in_root;
pub use crate::app::vault::vault_app_service::save_vault_markdown_file_in_root;
pub use crate::app::vault::vault_app_service::set_current_vault_precheck;
pub use crate::host::commands::frontend_log_commands::forward_frontend_log;
pub use crate::host::commands::vault_commands::segment_chinese_text;
pub use crate::infra::logging::init as init_logging;
pub use crate::infra::query::query_index::ensure_query_index_current;
pub use crate::infra::query::query_index::list_markdown_files;
pub use crate::infra::query::query_index::load_markdown_graph;
pub use crate::infra::query::wikilink::resolve_wikilink_target_path_in_vault;
pub use crate::shared::vault_contracts::VaultConfig;
pub use crate::shared::vault_contracts::VaultSearchScope;
pub use crate::shared::vault_contracts::VaultTaskItem;
