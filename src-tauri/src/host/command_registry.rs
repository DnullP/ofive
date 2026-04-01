//! # 命令注册模块
//!
//! 集中维护 Tauri `invoke` 命令清单，避免命令列表散落在宿主入口中。

use std::collections::HashSet;

use crate::module_contribution::BackendModuleContribution;

macro_rules! define_app_commands {
    ($(($command_id:expr, $handler:path)),* $(,)?) => {
        pub(crate) const REGISTERED_APP_COMMAND_IDS: &[&str] = &[$($command_id),*];

        macro_rules! app_commands {
            () => {
                tauri::generate_handler![$($handler),*]
            };
        }
    };
}

define_app_commands![
    (
        "get_ai_vendor_catalog",
        crate::host::commands::ai_commands::get_ai_vendor_catalog
    ),
    (
        "get_ai_backend_plugin_config",
        crate::host::commands::ai_commands::get_ai_backend_plugin_config
    ),
    (
        "save_ai_backend_plugin_config",
        crate::host::commands::ai_commands::save_ai_backend_plugin_config
    ),
    (
        "get_ai_vendor_models",
        crate::host::commands::ai_commands::get_ai_vendor_models
    ),
    (
        "get_ai_chat_settings",
        crate::host::commands::ai_commands::get_ai_chat_settings
    ),
    (
        "get_ai_chat_history",
        crate::host::commands::ai_commands::get_ai_chat_history
    ),
    (
        "save_ai_chat_settings",
        crate::host::commands::ai_commands::save_ai_chat_settings
    ),
    (
        "save_ai_chat_history",
        crate::host::commands::ai_commands::save_ai_chat_history
    ),
    (
        "get_ai_tool_catalog",
        crate::host::commands::ai_commands::get_ai_tool_catalog
    ),
    (
        "get_ai_sidecar_health",
        crate::host::commands::ai_commands::get_ai_sidecar_health
    ),
    (
        "start_ai_chat_stream",
        crate::host::commands::ai_commands::start_ai_chat_stream
    ),
    (
        "stop_ai_chat_stream",
        crate::host::commands::ai_commands::stop_ai_chat_stream
    ),
    (
        "submit_ai_chat_confirmation",
        crate::host::commands::ai_commands::submit_ai_chat_confirmation
    ),
    (
        "get_capability_catalog",
        crate::host::commands::capability_commands::get_capability_catalog
    ),
    (
        "execute_persistence_request",
        crate::host::commands::persistence_commands::execute_persistence_request
    ),
    (
        "update_main_window_acrylic_effect",
        crate::host::commands::window_commands::update_main_window_acrylic_effect
    ),
    (
        "forward_frontend_log",
        crate::host::commands::frontend_log_commands::forward_frontend_log
    ),
    (
        "set_current_vault",
        crate::host::commands::vault_commands::set_current_vault
    ),
    (
        "get_current_vault_tree",
        crate::host::commands::vault_commands::get_current_vault_tree
    ),
    (
        "read_vault_markdown_file",
        crate::host::commands::vault_commands::read_vault_markdown_file
    ),
    (
        "read_vault_canvas_file",
        crate::host::commands::vault_commands::read_vault_canvas_file
    ),
    (
        "read_vault_binary_file",
        crate::host::commands::vault_commands::read_vault_binary_file
    ),
    (
        "create_vault_markdown_file",
        crate::host::commands::vault_commands::create_vault_markdown_file
    ),
    (
        "create_vault_canvas_file",
        crate::host::commands::vault_commands::create_vault_canvas_file
    ),
    (
        "create_vault_directory",
        crate::host::commands::vault_commands::create_vault_directory
    ),
    (
        "create_vault_binary_file",
        crate::host::commands::vault_commands::create_vault_binary_file
    ),
    (
        "save_vault_markdown_file",
        crate::host::commands::vault_commands::save_vault_markdown_file
    ),
    (
        "save_vault_canvas_file",
        crate::host::commands::vault_commands::save_vault_canvas_file
    ),
    (
        "rename_vault_markdown_file",
        crate::host::commands::vault_commands::rename_vault_markdown_file
    ),
    (
        "rename_vault_canvas_file",
        crate::host::commands::vault_commands::rename_vault_canvas_file
    ),
    (
        "move_vault_markdown_file_to_directory",
        crate::host::commands::vault_commands::move_vault_markdown_file_to_directory
    ),
    (
        "move_vault_canvas_file_to_directory",
        crate::host::commands::vault_commands::move_vault_canvas_file_to_directory
    ),
    (
        "rename_vault_directory",
        crate::host::commands::vault_commands::rename_vault_directory
    ),
    (
        "move_vault_directory_to_directory",
        crate::host::commands::vault_commands::move_vault_directory_to_directory
    ),
    (
        "delete_vault_directory",
        crate::host::commands::vault_commands::delete_vault_directory
    ),
    (
        "delete_vault_markdown_file",
        crate::host::commands::vault_commands::delete_vault_markdown_file
    ),
    (
        "delete_vault_canvas_file",
        crate::host::commands::vault_commands::delete_vault_canvas_file
    ),
    (
        "delete_vault_binary_file",
        crate::host::commands::vault_commands::delete_vault_binary_file
    ),
    (
        "copy_vault_entry",
        crate::host::commands::vault_commands::copy_vault_entry
    ),
    (
        "resolve_wikilink_target",
        crate::host::commands::vault_commands::resolve_wikilink_target
    ),
    (
        "resolve_media_embed_target",
        crate::host::commands::vault_commands::resolve_media_embed_target
    ),
    (
        "search_vault_markdown_files",
        crate::host::commands::vault_commands::search_vault_markdown_files
    ),
    (
        "search_vault_markdown",
        crate::host::commands::vault_commands::search_vault_markdown
    ),
    (
        "query_vault_tasks",
        crate::host::commands::vault_commands::query_vault_tasks
    ),
    (
        "get_current_vault_markdown_graph",
        crate::host::commands::vault_commands::get_current_vault_markdown_graph
    ),
    (
        "get_vault_markdown_ast",
        crate::host::commands::vault_commands::get_vault_markdown_ast
    ),
    (
        "segment_chinese_text",
        crate::host::commands::vault_commands::segment_chinese_text
    ),
    (
        "suggest_wikilink_targets",
        crate::host::commands::vault_commands::suggest_wikilink_targets
    ),
    (
        "get_current_vault_config",
        crate::host::commands::vault_commands::get_current_vault_config
    ),
    (
        "save_current_vault_config",
        crate::host::commands::vault_commands::save_current_vault_config
    ),
    (
        "get_backlinks_for_file",
        crate::host::commands::vault_commands::get_backlinks_for_file
    ),
    (
        "get_vault_markdown_outline",
        crate::host::commands::vault_commands::get_vault_markdown_outline
    ),
    (
        "query_vault_markdown_frontmatter",
        crate::host::commands::vault_commands::query_vault_markdown_frontmatter
    ),
];

/// 校验宿主显式注册的 Tauri 命令与模块贡献元数据保持一致。
pub(crate) fn validate_registered_app_commands(
    contributions: &[BackendModuleContribution],
    registered_command_ids: &[&str],
) -> Result<(), String> {
    validate_registered_identifiers(
        contributions,
        registered_command_ids,
        "command_id",
        |contribution| contribution.command_ids,
    )
}

fn validate_registered_identifiers(
    contributions: &[BackendModuleContribution],
    registered_identifiers: &[&str],
    identifier_kind: &str,
    select_identifiers: fn(&BackendModuleContribution) -> &'static [&'static str],
) -> Result<(), String> {
    let mut registered_seen = HashSet::new();
    for identifier in registered_identifiers {
        if identifier.trim().is_empty() {
            return Err(format!("registered {} must not be empty", identifier_kind));
        }

        if !registered_seen.insert((*identifier).to_string()) {
            return Err(format!(
                "duplicate registered {} detected: {}",
                identifier_kind, identifier
            ));
        }
    }

    let declared_identifiers = contributions
        .iter()
        .flat_map(select_identifiers)
        .copied()
        .collect::<HashSet<_>>();

    for identifier in registered_identifiers {
        if !declared_identifiers.contains(identifier) {
            return Err(format!(
                "registered {} is missing from backend module contributions: {}",
                identifier_kind, identifier
            ));
        }
    }

    for contribution in contributions {
        for identifier in select_identifiers(contribution) {
            if !registered_seen.contains(*identifier) {
                return Err(format!(
                    "backend module contribution declares {} that is missing from registered list: module={} {}={}",
                    identifier_kind, contribution.module_id, identifier_kind, identifier
                ));
            }
        }
    }

    Ok(())
}

pub(crate) use app_commands;

#[cfg(test)]
mod tests {
    use super::{validate_registered_app_commands, REGISTERED_APP_COMMAND_IDS};
    use crate::host::commands::vault_commands::VAULT_COMMAND_IDS;
    use crate::module_contribution::{
        builtin_backend_module_contributions, BackendModuleContribution,
    };

    #[test]
    fn registered_app_commands_should_match_builtin_backend_module_contributions() {
        let contributions = builtin_backend_module_contributions();

        validate_registered_app_commands(&contributions, REGISTERED_APP_COMMAND_IDS)
            .expect("宿主显式命令表应与内建 backend module contributions 保持一致");
    }

    #[test]
    fn registered_app_commands_should_reject_missing_contribution_command() {
        let contributions = vec![BackendModuleContribution {
            module_id: "module-a",
            command_ids: &["only-command"],
            events: &[],
            persistence_owners: &[],
            capability_catalog: None,
            capability_execute: None,
        }];

        let error = validate_registered_app_commands(&contributions, &[])
            .expect_err("未注册的贡献命令应被拒绝");

        assert!(error.contains(
            "backend module contribution declares command_id that is missing from registered list"
        ));
    }

    #[test]
    fn registered_app_commands_should_reject_orphan_registered_command() {
        let contributions = vec![BackendModuleContribution {
            module_id: "module-a",
            command_ids: &[],
            events: &[],
            persistence_owners: &[],
            capability_catalog: None,
            capability_execute: None,
        }];

        let error = validate_registered_app_commands(&contributions, &["orphan-command"])
            .expect_err("游离的注册命令应被拒绝");

        assert!(
            error.contains("registered command_id is missing from backend module contributions")
        );
    }

    #[test]
    fn registered_app_commands_should_reject_duplicate_registered_command() {
        let contributions = vec![BackendModuleContribution {
            module_id: "module-a",
            command_ids: &["shared-command"],
            events: &[],
            persistence_owners: &[],
            capability_catalog: None,
            capability_execute: None,
        }];

        let error =
            validate_registered_app_commands(&contributions, &["shared-command", "shared-command"])
                .expect_err("重复注册命令应被拒绝");

        assert!(error.contains("duplicate registered command_id detected"));
    }

    #[test]
    fn registered_app_commands_should_reject_empty_registered_command() {
        let contributions = vec![BackendModuleContribution {
            module_id: "module-a",
            command_ids: &[],
            events: &[],
            persistence_owners: &[],
            capability_catalog: None,
            capability_execute: None,
        }];

        let error = validate_registered_app_commands(&contributions, &[""])
            .expect_err("空注册命令应被拒绝");

        assert!(error.contains("registered command_id must not be empty"));
    }

    #[test]
    fn canvas_vault_commands_should_be_declared_and_registered_through_host_boundary() {
        for command_id in [
            "read_vault_canvas_file",
            "create_vault_canvas_file",
            "save_vault_canvas_file",
            "rename_vault_canvas_file",
            "move_vault_canvas_file_to_directory",
            "delete_vault_canvas_file",
        ] {
            assert!(
                VAULT_COMMAND_IDS.contains(&command_id),
                "Vault command fact source must declare {command_id}",
            );
            assert!(
                REGISTERED_APP_COMMAND_IDS.contains(&command_id),
                "Host command registry must register {command_id}",
            );
        }
    }
}
