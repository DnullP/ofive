//! # 命令注册模块
//!
//! 集中维护 Tauri `invoke` 命令清单，避免命令列表散落在宿主入口中。

macro_rules! app_commands {
    () => {
        tauri::generate_handler![
            crate::host::commands::ai_commands::get_ai_vendor_catalog,
            crate::host::commands::ai_commands::get_ai_vendor_models,
            crate::host::commands::ai_commands::get_ai_chat_settings,
            crate::host::commands::ai_commands::save_ai_chat_settings,
            crate::host::commands::ai_commands::get_ai_tool_catalog,
            crate::host::commands::ai_commands::get_ai_sidecar_health,
            crate::host::commands::ai_commands::start_ai_chat_stream,
            crate::host::commands::ai_commands::submit_ai_chat_confirmation,
            crate::host::commands::capability_commands::get_capability_catalog,
            crate::frontend_log::forward_frontend_log,
            crate::host::commands::vault_commands::set_current_vault,
            crate::host::commands::vault_commands::get_current_vault_tree,
            crate::host::commands::vault_commands::read_vault_markdown_file,
            crate::host::commands::vault_commands::read_vault_binary_file,
            crate::host::commands::vault_commands::create_vault_markdown_file,
            crate::host::commands::vault_commands::create_vault_directory,
            crate::host::commands::vault_commands::create_vault_binary_file,
            crate::host::commands::vault_commands::save_vault_markdown_file,
            crate::host::commands::vault_commands::rename_vault_markdown_file,
            crate::host::commands::vault_commands::move_vault_markdown_file_to_directory,
            crate::host::commands::vault_commands::rename_vault_directory,
            crate::host::commands::vault_commands::move_vault_directory_to_directory,
            crate::host::commands::vault_commands::delete_vault_directory,
            crate::host::commands::vault_commands::delete_vault_markdown_file,
            crate::host::commands::vault_commands::delete_vault_binary_file,
            crate::host::commands::vault_commands::copy_vault_entry,
            crate::host::commands::vault_commands::resolve_wikilink_target,
            crate::host::commands::vault_commands::resolve_media_embed_target,
            crate::host::commands::vault_commands::search_vault_markdown_files,
            crate::host::commands::vault_commands::get_current_vault_markdown_graph,
            crate::host::commands::vault_commands::get_vault_markdown_ast,
            crate::host::commands::vault_commands::segment_chinese_text,
            crate::host::commands::vault_commands::suggest_wikilink_targets,
            crate::host::commands::vault_commands::get_current_vault_config,
            crate::host::commands::vault_commands::save_current_vault_config,
            crate::host::commands::vault_commands::get_backlinks_for_file,
            crate::host::commands::vault_commands::get_vault_markdown_outline,
            crate::host::commands::vault_commands::query_vault_markdown_frontmatter
        ]
    };
}

pub(crate) use app_commands;
