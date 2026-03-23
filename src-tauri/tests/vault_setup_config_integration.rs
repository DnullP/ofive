//! # 仓库初始化与配置接口集成测试
//!
//! 覆盖后端暴露接口：
//! - `set_current_vault`（通过 `set_current_vault_precheck` 覆盖核心校验与配置初始化）
//! - `get_current_vault_config`
//! - `save_current_vault_config`

#[path = "support/mod.rs"]
mod support;

use ofive_lib::test_support::{
    get_current_vault_config_in_root, save_current_vault_config_in_root,
    set_current_vault_precheck, VaultConfig,
};
use serde_json::{json, Value};
use support::TestVault;

#[test]
fn set_current_vault_precheck_should_create_config_file() {
    let vault = TestVault::new();
    let canonical_root = vault.root.canonicalize().expect("临时仓库路径应可规范化");
    let root_string = canonical_root.to_string_lossy().to_string();

    let response = set_current_vault_precheck(root_string.clone()).expect("预检应成功");
    let response_json = serde_json::to_value(response).expect("响应应可序列化");

    assert_eq!(
        response_json.get("vaultPath").and_then(Value::as_str),
        Some(root_string.as_str())
    );
    assert!(canonical_root.join(".ofive/config.json").exists());
}

#[test]
fn get_and_save_vault_config_should_roundtrip_entries() {
    let vault = TestVault::new();

    let initial = get_current_vault_config_in_root(&vault.root).expect("读取默认配置应成功");
    assert_eq!(initial.schema_version, 1);

    let mut next_entries = initial.entries.clone();
    next_entries.insert("featureToggle".to_string(), json!(true));
    next_entries.insert("graph".to_string(), json!({"nodeSize": 7}));

    let next = VaultConfig {
        schema_version: initial.schema_version,
        entries: next_entries,
    };

    let saved =
        save_current_vault_config_in_root(next.clone(), &vault.root).expect("保存配置应成功");
    assert_eq!(saved.entries.get("featureToggle"), Some(&json!(true)));

    let loaded = get_current_vault_config_in_root(&vault.root).expect("再次读取配置应成功");
    assert_eq!(loaded.entries.get("featureToggle"), Some(&json!(true)));
    assert_eq!(loaded.entries.get("graph"), Some(&json!({"nodeSize": 7})));
}
