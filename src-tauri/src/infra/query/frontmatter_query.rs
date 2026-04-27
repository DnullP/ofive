//! # Frontmatter 查询基础设施模块
//!
//! 为仓库内 Markdown 文件提供基于 frontmatter 字段的筛选能力。
//! 该模块不依赖 Tauri `State`，只接收已解析的仓库根目录。

use crate::infra::fs::fs_helpers::collect_markdown_relative_paths;
use crate::infra::query::markdown_block_detector::detect_excluded_byte_ranges;
use crate::shared::vault_contracts::{FrontmatterQueryMatchItem, FrontmatterQueryResponse};
use serde_json::{Map as JsonMap, Value as JsonValue};
use serde_yaml::Value as YamlValue;
use std::fs;
use std::path::{Path, PathBuf};

/// 提取 Markdown 文档开头的 frontmatter YAML 文本。
fn extract_frontmatter_yaml(content: &str) -> Option<String> {
    let ranges = detect_excluded_byte_ranges(content);
    let first_range = ranges.first()?;
    if first_range.from != 0 || first_range.to >= content.len() {
        return None;
    }

    let block = &content[first_range.from..=first_range.to];
    let mut lines: Vec<&str> = block.lines().collect();
    if lines.len() < 2 {
        return None;
    }

    let first_line = lines.first()?.trim_end();
    let last_line = lines.last()?.trim_end();
    if first_line != "---" || last_line != "---" {
        return None;
    }

    lines.remove(0);
    let _ = lines.pop();
    Some(lines.join("\n"))
}

/// 将 YAML 标量/数组递归规范化为字符串列表，便于字段匹配。
fn collect_yaml_match_values(value: &YamlValue) -> Vec<String> {
    match value {
        YamlValue::Null => vec!["null".to_string()],
        YamlValue::Bool(inner) => vec![inner.to_string()],
        YamlValue::Number(inner) => vec![inner.to_string()],
        YamlValue::String(inner) => vec![inner.trim().to_string()],
        YamlValue::Sequence(items) => items.iter().flat_map(collect_yaml_match_values).collect(),
        YamlValue::Tagged(tagged) => collect_yaml_match_values(&tagged.value),
        YamlValue::Mapping(_) => Vec::new(),
    }
}

/// 将 YAML mapping 递归转换为 JSON 对象。
fn yaml_to_json_value(value: &YamlValue) -> Option<JsonValue> {
    match value {
        YamlValue::Null => Some(JsonValue::Null),
        YamlValue::Bool(inner) => Some(JsonValue::Bool(*inner)),
        YamlValue::Number(inner) => {
            if let Some(integer) = inner.as_i64() {
                return Some(JsonValue::from(integer));
            }
            if let Some(unsigned) = inner.as_u64() {
                return Some(JsonValue::from(unsigned));
            }
            inner
                .as_f64()
                .and_then(serde_json::Number::from_f64)
                .map(JsonValue::Number)
        }
        YamlValue::String(inner) => Some(JsonValue::String(inner.clone())),
        YamlValue::Sequence(items) => Some(JsonValue::Array(
            items.iter().filter_map(yaml_to_json_value).collect(),
        )),
        YamlValue::Mapping(entries) => {
            let mut map = JsonMap::new();
            for (key, value) in entries {
                let Some(key_string) = key.as_str() else {
                    continue;
                };
                let Some(json_value) = yaml_to_json_value(value) else {
                    continue;
                };
                map.insert(key_string.to_string(), json_value);
            }
            Some(JsonValue::Object(map))
        }
        YamlValue::Tagged(tagged) => yaml_to_json_value(&tagged.value),
    }
}

/// 从相对路径计算展示标题。
fn resolve_frontmatter_title(relative_path: &str, frontmatter: &JsonValue) -> String {
    let title_from_frontmatter = frontmatter
        .get("title")
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(title) = title_from_frontmatter {
        return title.to_string();
    }

    relative_path
        .split('/')
        .next_back()
        .unwrap_or(relative_path)
        .trim_end_matches(".markdown")
        .trim_end_matches(".md")
        .to_string()
}

/// 在指定仓库根目录下查询 frontmatter 字段。
pub(crate) fn query_vault_markdown_frontmatter_in_root(
    vault_root: &Path,
    field_name: String,
    field_value: Option<String>,
) -> Result<FrontmatterQueryResponse, String> {
    let normalized_field_name = field_name.trim().to_string();
    if normalized_field_name.is_empty() {
        log::warn!("[vault-frontmatter] query skipped: empty field name");
        return Err("frontmatter 字段名不能为空".to_string());
    }

    let normalized_field_value = field_value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    log::info!(
        "[vault-frontmatter] query start: field_name={} field_value={:?}",
        normalized_field_name,
        normalized_field_value
    );

    let mut relative_paths = Vec::new();
    collect_markdown_relative_paths(vault_root, vault_root, &mut relative_paths)?;
    relative_paths.sort();

    let mut matches = Vec::new();

    for relative_path in relative_paths {
        let file_path: PathBuf = vault_root.join(&relative_path);
        let content = fs::read_to_string(&file_path)
            .map_err(|error| format!("读取 Markdown 文件失败 {}: {error}", file_path.display()))?;

        let Some(frontmatter_yaml) = extract_frontmatter_yaml(&content) else {
            continue;
        };

        let parsed_yaml = match serde_yaml::from_str::<YamlValue>(&frontmatter_yaml) {
            Ok(parsed) => parsed,
            Err(error) => {
                log::warn!(
                    "[vault-frontmatter] parse yaml failed: path={} message={}",
                    relative_path,
                    error
                );
                continue;
            }
        };

        let YamlValue::Mapping(mapping) = &parsed_yaml else {
            log::warn!(
                "[vault-frontmatter] skip non-object frontmatter: path={}",
                relative_path
            );
            continue;
        };

        let field_key = YamlValue::String(normalized_field_name.clone());
        let Some(matched_yaml_value) = mapping.get(&field_key) else {
            continue;
        };

        let matched_field_values = collect_yaml_match_values(matched_yaml_value)
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();

        if matched_field_values.is_empty() {
            log::warn!(
                "[vault-frontmatter] matched empty field value: path={} field_name={}",
                relative_path,
                normalized_field_name
            );
            continue;
        }

        if let Some(expected_value) = &normalized_field_value {
            let matched_expected = matched_field_values
                .iter()
                .any(|value| value == expected_value);
            if !matched_expected {
                continue;
            }
        }

        let Some(frontmatter_json) = yaml_to_json_value(&parsed_yaml) else {
            log::warn!(
                "[vault-frontmatter] serialize frontmatter failed: path={}",
                relative_path
            );
            continue;
        };

        let title = resolve_frontmatter_title(&relative_path, &frontmatter_json);
        matches.push(FrontmatterQueryMatchItem {
            relative_path,
            title,
            matched_field_name: normalized_field_name.clone(),
            matched_field_values,
            frontmatter: frontmatter_json,
        });
    }

    log::info!(
        "[vault-frontmatter] query success: field_name={} matches={}",
        normalized_field_name,
        matches.len()
    );

    Ok(FrontmatterQueryResponse {
        field_name: normalized_field_name,
        matches,
    })
}

#[cfg(test)]
mod tests {
    use super::query_vault_markdown_frontmatter_in_root;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "ofive-frontmatter-query-test-{}-{}",
            unique, sequence
        ));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    fn write_markdown_file(root: &Path, relative_path: &str, content: &str) {
        let file_path = root.join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("应成功创建测试目录");
        }
        fs::write(file_path, content).expect("应成功写入 Markdown 文件");
    }

    #[test]
    fn query_vault_markdown_frontmatter_should_match_date_field() {
        let root = create_test_root();
        write_markdown_file(
            &root,
            "daily/2024-07-09.md",
            "---\ndate: 2024-07-09\ntitle: Daily Note\n---\n# Daily\n",
        );
        write_markdown_file(
            &root,
            "notes/guide.md",
            "---\ndate: 2024-07-10 09:30:00\n---\n# Guide\n",
        );
        write_markdown_file(&root, "plain.md", "# Plain\n");

        let response = query_vault_markdown_frontmatter_in_root(&root, "date".to_string(), None)
            .expect("frontmatter 查询应成功");

        assert_eq!(response.field_name, "date");
        assert_eq!(response.matches.len(), 2);
        assert_eq!(response.matches[0].relative_path, "daily/2024-07-09.md");
        assert_eq!(response.matches[0].title, "Daily Note");
        assert_eq!(response.matches[0].matched_field_values, vec!["2024-07-09"]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn query_vault_markdown_frontmatter_should_filter_by_exact_value() {
        let root = create_test_root();
        write_markdown_file(&root, "notes/a.md", "---\ndate: 2024-07-09\n---\n# A\n");
        write_markdown_file(&root, "notes/b.md", "---\ndate: 2024-07-10\n---\n# B\n");

        let response = query_vault_markdown_frontmatter_in_root(
            &root,
            "date".to_string(),
            Some("2024-07-09".to_string()),
        )
        .expect("frontmatter 查询应成功");

        assert_eq!(response.matches.len(), 1);
        assert_eq!(response.matches[0].relative_path, "notes/a.md");

        let _ = fs::remove_dir_all(root);
    }
}
