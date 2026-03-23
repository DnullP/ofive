//! # Vault 任务查询模块
//!
//! 在整个仓库内扫描符合任务看板语法的 Markdown task line，
//! 并跳过 frontmatter、代码块和 LaTeX 块中的伪匹配。
//!
//! ## 语法约定
//!
//! 任务行需要满足如下结构：
//! `- [ ] task content @2026-03-24 10:00 !high`
//!
//! 其中：
//! - due / priority 元数据允许缺省，保存时由前端补齐
//! - 兼容旧格式 `` `{$...}` `` 以及历史尾部 `edit` 标记
//! - 任务仍兼容 `[x]` 已完成状态

use crate::infra::fs::fs_helpers::collect_markdown_relative_paths;
use crate::infra::query::markdown_block_detector::{
    detect_excluded_byte_ranges, is_byte_offset_excluded,
};
use crate::shared::vault_contracts::VaultTaskItem;
use std::fs;
use std::path::{Path, PathBuf};

/// 解析后的任务行结构。
#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedTaskLine {
    /// 是否已完成。
    checked: bool,
    /// 任务正文。
    content: String,
    /// 截止时间元数据。
    due: Option<String>,
    /// 优先级元数据。
    priority: Option<String>,
}

/// 在指定仓库根目录下查询所有任务。
///
/// # 参数
/// - `vault_root` - 当前仓库根目录。
///
/// # 返回
/// - 返回按文件路径和行号排序的任务列表。
///
/// # 异常
/// - 读取目录或 Markdown 文件失败时返回错误。
pub(crate) fn query_vault_tasks_in_root(vault_root: &Path) -> Result<Vec<VaultTaskItem>, String> {
    log::info!(
        "[vault-task-query] query start: root={}",
        vault_root.display()
    );

    let mut relative_paths = Vec::new();
    collect_markdown_relative_paths(vault_root, vault_root, &mut relative_paths)?;
    relative_paths.sort();

    let mut tasks = Vec::new();

    for relative_path in relative_paths {
        let file_path: PathBuf = vault_root.join(&relative_path);
        let content = fs::read_to_string(&file_path)
            .map_err(|error| format!("读取 Markdown 文件失败 {}: {error}", file_path.display()))?;
        let excluded_ranges = detect_excluded_byte_ranges(&content);
        let title = resolve_task_title(&relative_path);

        let mut line_start_offset = 0usize;
        for (line_index, line) in content.lines().enumerate() {
            if is_byte_offset_excluded(line_start_offset, &excluded_ranges) {
                line_start_offset = line_start_offset.saturating_add(line.len() + 1);
                continue;
            }

            if let Some(parsed) = parse_task_line(line) {
                tasks.push(VaultTaskItem {
                    relative_path: relative_path.clone(),
                    title: title.clone(),
                    line: line_index + 1,
                    raw_line: line.to_string(),
                    checked: parsed.checked,
                    content: parsed.content,
                    due: parsed.due,
                    priority: parsed.priority,
                });
            }

            line_start_offset = line_start_offset.saturating_add(line.len() + 1);
        }
    }

    tasks.sort_by(|left, right| {
        left.relative_path
            .cmp(&right.relative_path)
            .then(left.line.cmp(&right.line))
    });

    log::info!(
        "[vault-task-query] query success: root={} task_count={}",
        vault_root.display(),
        tasks.len()
    );

    Ok(tasks)
}

/// 从相对路径推导展示标题。
fn resolve_task_title(relative_path: &str) -> String {
    relative_path
        .split('/')
        .next_back()
        .unwrap_or(relative_path)
        .trim_end_matches(".markdown")
        .trim_end_matches(".md")
        .to_string()
}

/// 解析单行任务语法。
fn parse_task_line(line: &str) -> Option<ParsedTaskLine> {
    let (checked, mut tail) = parse_task_prefix(line)?;
    tail = strip_trailing_edit_token(tail);

    let (tail_without_priority, priority) = pop_metadata_token(tail, "priority");
    let (tail_without_due, due) = pop_metadata_token(tail_without_priority, "due");
    let content = tail_without_due.trim();
    if content.is_empty() {
        return None;
    }

    Some(ParsedTaskLine {
        checked,
        content: content.to_string(),
        due,
        priority,
    })
}

/// 解析 task list 前缀并返回剩余正文。
fn parse_task_prefix(line: &str) -> Option<(bool, &str)> {
    let bytes = line.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }

    if index >= bytes.len() {
        return None;
    }

    if matches!(bytes[index], b'-' | b'+' | b'*') {
        index += 1;
    } else if bytes[index].is_ascii_digit() {
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if bytes.get(index) != Some(&b'.') {
            return None;
        }
        index += 1;
    } else {
        return None;
    }

    if bytes
        .get(index)
        .is_none_or(|byte| !byte.is_ascii_whitespace())
    {
        return None;
    }
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }

    if bytes.get(index) != Some(&b'[') {
        return None;
    }
    let checked = match bytes.get(index + 1) {
        Some(b'x') | Some(b'X') => true,
        Some(b' ') => false,
        _ => return None,
    };
    if bytes.get(index + 2) != Some(&b']') {
        return None;
    }
    index += 3;

    if bytes
        .get(index)
        .is_none_or(|byte| !byte.is_ascii_whitespace())
    {
        return None;
    }
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }

    Some((checked, &line[index..]))
}

/// 去除行尾历史遗留的 `edit` 标记；未携带时原样返回。
fn strip_trailing_edit_token(input: &str) -> &str {
    let trimmed = input.trim_end();
    if trimmed == "edit" {
        return "";
    }

    trimmed
        .strip_suffix(" edit")
        .map(str::trim_end)
        .unwrap_or(trimmed)
}

/// 从行尾提取一个简写或旧式元数据 token。
fn pop_metadata_token<'a>(input: &'a str, kind: &str) -> (&'a str, Option<String>) {
    let trimmed = input.trim_end();
    if let Some(result) = pop_short_metadata_token(trimmed, kind) {
        return result;
    }

    if !trimmed.ends_with('`') || !trimmed.ends_with("}`") {
        return (trimmed, None);
    }

    let Some(start_index) = trimmed.rfind("`{$") else {
        return (trimmed, None);
    };

    if start_index > 0 {
        let preceding = trimmed[..start_index].chars().next_back();
        if !preceding.is_some_and(char::is_whitespace) {
            return (trimmed, None);
        }
    }

    let token_body = &trimmed[start_index + 3..trimmed.len().saturating_sub(2)];
    let value = token_body.trim();
    let remaining = trimmed[..start_index].trim_end();

    if value.is_empty() {
        return (remaining, None);
    }

    (remaining, Some(value.to_string()))
}

/// 从行尾提取简写元数据 token，例如 `@2026-03-24 10:00` 或 `!high`。
fn pop_short_metadata_token<'a>(input: &'a str, kind: &str) -> Option<(&'a str, Option<String>)> {
    let trimmed = input.trim_end();
    match kind {
        "priority" => {
            let (remaining, token) = split_last_whitespace_token(trimmed)?;
            let value = token
                .strip_prefix('!')
                .map(str::trim)
                .filter(|value| matches!(*value, "high" | "medium" | "low"))?;

            Some((remaining, Some(value.to_string())))
        }
        "due" => {
            let (remaining, last_token) = split_last_whitespace_token(trimmed)?;

            if let Some(value) = last_token
                .strip_prefix('@')
                .filter(|value| is_short_due_value(value))
            {
                return Some((remaining, Some(value.to_string())));
            }

            if is_time_token(last_token) {
                let (remaining_without_date, date_token) = split_last_whitespace_token(remaining)?;
                let date_value = date_token.strip_prefix('@')?;
                let candidate = format!("{date_value} {last_token}");
                if is_short_due_value(&candidate) {
                    return Some((remaining_without_date, Some(candidate)));
                }
            }

            None
        }
        _ => None,
    }
}

fn split_last_whitespace_token(input: &str) -> Option<(&str, &str)> {
    let trimmed = input.trim_end();
    if trimmed.is_empty() {
        return None;
    }

    let token_end = trimmed.len();
    for (index, ch) in trimmed.char_indices().rev() {
        if ch.is_whitespace() {
            let token_start = index + ch.len_utf8();
            if token_start >= token_end {
                continue;
            }

            return Some((
                trimmed[..index].trim_end(),
                &trimmed[token_start..token_end],
            ));
        }
    }

    Some(("", trimmed))
}

fn is_short_due_value(value: &str) -> bool {
    let mut parts = value.split(' ');
    let Some(date_part) = parts.next() else {
        return false;
    };
    if !is_date_token(date_part) {
        return false;
    }

    match parts.next() {
        None => true,
        Some(time_part) => parts.next().is_none() && is_time_token(time_part),
    }
}

fn is_date_token(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
}

fn is_time_token(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 5
        && bytes[2] == b':'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 2 || byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::{parse_task_line, query_vault_tasks_in_root};
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
        let root =
            std::env::temp_dir().join(format!("ofive-task-query-test-{}-{}", unique, sequence));
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
    fn parse_task_line_should_extract_due_priority_and_status() {
        let parsed = parse_task_line("- [x] Finish quarterly review @2026-03-24 09:30 !high")
            .expect("应成功解析任务行");

        assert!(parsed.checked);
        assert_eq!(parsed.content, "Finish quarterly review");
        assert_eq!(parsed.due.as_deref(), Some("2026-03-24 09:30"));
        assert_eq!(parsed.priority.as_deref(), Some("high"));
    }

    #[test]
    fn parse_task_line_should_allow_lines_without_edit_token() {
        let parsed = parse_task_line("- [ ] Finish quarterly review @2026-03-24 !high")
            .expect("新语法任务行应允许不带 edit 标记");
        assert_eq!(parsed.content, "Finish quarterly review");
    }

    #[test]
    fn parse_task_line_should_support_legacy_metadata_tokens() {
        let parsed =
            parse_task_line("- [ ] Legacy quarterly review `{$2026-03-24 09:30}` `{$high}` edit")
                .expect("应成功解析旧语法任务行");

        assert_eq!(parsed.due.as_deref(), Some("2026-03-24 09:30"));
        assert_eq!(parsed.priority.as_deref(), Some("high"));
    }

    #[test]
    fn parse_task_line_should_handle_unicode_content_without_panicking() {
        let parsed = parse_task_line("- [ ] 基本区块链知识 ⏬ ⏳ 2025-01-07")
            .expect("包含 emoji 的任务行不应触发 Unicode 边界 panic");

        assert_eq!(parsed.content, "基本区块链知识 ⏬ ⏳ 2025-01-07");
        assert_eq!(parsed.due, None);
        assert_eq!(parsed.priority, None);
    }

    #[test]
    fn parse_task_line_should_extract_due_after_unicode_content() {
        let parsed = parse_task_line("- [ ] 基本区块链知识 ⏬ @2025-01-07 18:42 !medium")
            .expect("带 Unicode 内容的任务行应成功提取 due 和 priority");

        assert_eq!(parsed.content, "基本区块链知识 ⏬");
        assert_eq!(parsed.due.as_deref(), Some("2025-01-07 18:42"));
        assert_eq!(parsed.priority.as_deref(), Some("medium"));
    }

    #[test]
    fn query_vault_tasks_in_root_should_skip_code_fence_and_collect_tasks() {
        let root = create_test_root();
        write_markdown_file(
            &root,
            "notes/tasks.md",
            "# Tasks\n- [ ] Valid task @2026-03-24 09:30 !high\n```md\n- [ ] Hidden task @2026-03-25 !low\n```\n- [x] Done task @2026-03-23 12:00 !medium\n",
        );

        let tasks = query_vault_tasks_in_root(&root).expect("任务查询应成功");

        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].relative_path, "notes/tasks.md");
        assert_eq!(tasks[0].line, 2);
        assert_eq!(tasks[0].content, "Valid task");
        assert_eq!(tasks[1].checked, true);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn query_vault_tasks_in_root_should_collect_unicode_tasks_without_panicking() {
        let root = create_test_root();
        write_markdown_file(
            &root,
            "notes/unicode-tasks.md",
            "# Tasks\n- [ ] 基本区块链知识 ⏬ ⏳ 2025-01-07\n- [ ] 深入学习 @2025-01-08 08:30 !low\n",
        );

        let tasks = query_vault_tasks_in_root(&root).expect("Unicode 任务查询应成功");

        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].content, "基本区块链知识 ⏬ ⏳ 2025-01-07");
        assert_eq!(tasks[0].due, None);
        assert_eq!(tasks[1].due.as_deref(), Some("2025-01-08 08:30"));
        assert_eq!(tasks[1].priority.as_deref(), Some("low"));

        let _ = fs::remove_dir_all(root);
    }
}
