//! # Frontmatter alias 查询辅助
//!
//! 解析 Markdown 文档开头 frontmatter 中受治理的 `alias` 字段。

use crate::infra::query::markdown_block_detector::detect_excluded_byte_ranges;
use serde_yaml::Value as YamlValue;

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

fn collect_alias_values(value: &YamlValue) -> Vec<String> {
    match value {
        YamlValue::String(inner) => {
            let trimmed = inner.trim();
            if trimmed.is_empty() {
                Vec::new()
            } else {
                vec![trimmed.to_string()]
            }
        }
        YamlValue::Sequence(items) => items.iter().flat_map(collect_alias_values).collect(),
        YamlValue::Tagged(tagged) => collect_alias_values(&tagged.value),
        _ => Vec::new(),
    }
}

/// 从 Markdown 文本中提取 frontmatter alias 列表。
pub(crate) fn extract_frontmatter_aliases(content: &str) -> Vec<String> {
    let Some(frontmatter_yaml) = extract_frontmatter_yaml(content) else {
        return Vec::new();
    };

    let Ok(parsed_yaml) = serde_yaml::from_str::<YamlValue>(&frontmatter_yaml) else {
        return Vec::new();
    };

    let YamlValue::Mapping(mapping) = parsed_yaml else {
        return Vec::new();
    };

    let Some(alias_value) = mapping
        .get(YamlValue::String("alias".to_string()))
        .or_else(|| mapping.get(YamlValue::String("aliases".to_string())))
    else {
        return Vec::new();
    };

    collect_alias_values(alias_value)
}

#[cfg(test)]
mod tests {
    use super::extract_frontmatter_aliases;

    #[test]
    fn extract_frontmatter_aliases_should_read_alias_list() {
        let aliases = extract_frontmatter_aliases("---\nalias:\n  - Memory Service\n---\n# Note\n");

        assert_eq!(aliases, vec!["Memory Service"]);
    }
}
