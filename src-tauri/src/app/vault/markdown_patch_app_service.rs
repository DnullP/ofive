//! # Vault Markdown Patch 应用服务
//!
//! 负责在 Vault 模块内对 Markdown 文件应用 unified diff patch，
//! 避免 AI 每次修改都整文件覆盖。

use std::path::Path;

use crate::app::vault::vault_app_service;
use crate::shared::vault_contracts::ApplyMarkdownPatchResponse;

#[derive(Debug, Clone, PartialEq, Eq)]
struct MatchedPatchRange {
    old_start: usize,
    old_end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedUnifiedDiff {
    relative_path: String,
    blocks: Vec<ParsedDiffBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedDiffBlock {
    before_context: Vec<String>,
    old_lines: Vec<String>,
    new_lines: Vec<String>,
    after_context: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PatchMismatchDetail {
    match_start: usize,
    matched_line_count: usize,
    segment_name: &'static str,
    segment_line_index: usize,
    file_line_index: usize,
    expected: Option<String>,
    actual: Option<String>,
}

/// 在指定仓库根目录下对 Markdown 文件应用 unified diff。
pub fn apply_unified_markdown_diff_in_root(
    vault_root: &Path,
    unified_diff: String,
) -> Result<ApplyMarkdownPatchResponse, String> {
    let parsed = parse_unified_diff(&unified_diff)?;
    let current = vault_app_service::read_vault_markdown_file_in_root(
        parsed.relative_path.clone(),
        vault_root,
    )?;
    let patched = apply_parsed_diff_blocks_to_content(&current.content, &parsed.blocks)?;
    vault_app_service::save_vault_markdown_file_in_root(
        parsed.relative_path.clone(),
        patched,
        vault_root,
    )?;

    Ok(ApplyMarkdownPatchResponse {
        relative_path: parsed.relative_path,
        applied_block_count: parsed.blocks.len(),
    })
}

/// 在内存文本上应用 unified diff，用于单元测试和纯文本校验。
#[cfg(test)]
fn apply_unified_markdown_diff_to_content(
    content: &str,
    unified_diff: &str,
) -> Result<String, String> {
    let parsed = parse_unified_diff(unified_diff)?;
    apply_parsed_diff_blocks_to_content(content, &parsed.blocks)
}

fn parse_unified_diff(unified_diff: &str) -> Result<ParsedUnifiedDiff, String> {
    let lines = split_lines_preserve_content(unified_diff);
    if lines.is_empty() {
        return Err("unified diff 不能为空".to_string());
    }

    let mut index = 0;
    while index < lines.len() && is_unified_diff_metadata_line(&lines[index]) {
        index += 1;
    }

    let old_header = lines
        .get(index)
        .ok_or_else(|| "unified diff 缺少 --- 文件头".to_string())?;
    let old_path = parse_unified_diff_header(old_header, "--- ")?;
    index += 1;

    let new_header = lines
        .get(index)
        .ok_or_else(|| "unified diff 缺少 +++ 文件头".to_string())?;
    let new_path = parse_unified_diff_header(new_header, "+++")?;
    index += 1;

    let relative_path = resolve_unified_diff_relative_path(&old_path, &new_path)?;
    let mut blocks = Vec::new();

    while index < lines.len() {
        if lines[index].is_empty() {
            index += 1;
            continue;
        }

        let header = &lines[index];
        if !header.starts_with("@@") {
            return Err(format!(
                "unified diff 第{}行不是合法 hunk 头: {:?}",
                index + 1,
                header,
            ));
        }
        index += 1;

        let hunk_start = index;
        while index < lines.len() && !lines[index].starts_with("@@") {
            index += 1;
        }

        let block = parse_unified_diff_hunk(&lines[hunk_start..index], blocks.len() + 1)?;
        blocks.push(block);
    }

    if blocks.is_empty() {
        return Err("unified diff 至少需要一个 @@ hunk".to_string());
    }

    Ok(ParsedUnifiedDiff {
        relative_path,
        blocks,
    })
}

fn is_unified_diff_metadata_line(line: &str) -> bool {
    line.starts_with("diff --git ")
        || line.starts_with("index ")
        || line.starts_with("new file mode ")
        || line.starts_with("deleted file mode ")
        || line.starts_with("old mode ")
        || line.starts_with("new mode ")
        || line.starts_with("similarity index ")
        || line.starts_with("rename from ")
        || line.starts_with("rename to ")
}

fn parse_unified_diff_header(line: &str, prefix: &str) -> Result<String, String> {
    line.strip_prefix(prefix)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| format!("unified diff 缺少合法的 {} 文件头: {:?}", prefix.trim(), line))
}

fn resolve_unified_diff_relative_path(old_path: &str, new_path: &str) -> Result<String, String> {
    let normalized_old = normalize_unified_diff_path(old_path)?;
    let normalized_new = normalize_unified_diff_path(new_path)?;
    if normalized_old != normalized_new {
        return Err(format!(
            "unified diff 仅支持单文件修改，--- 与 +++ 路径必须一致，当前为 {:?} 与 {:?}",
            old_path,
            new_path,
        ));
    }
    Ok(normalized_new)
}

fn normalize_unified_diff_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed == "/dev/null" {
        return Err("unified diff 不支持 /dev/null，请使用创建或删除专用工具".to_string());
    }

    let normalized = trimmed
        .strip_prefix("a/")
        .or_else(|| trimmed.strip_prefix("b/"))
        .unwrap_or(trimmed)
        .trim_matches('"')
        .replace('\\', "/");
    if normalized.is_empty() {
        return Err(format!("unified diff 路径不能为空: {:?}", path));
    }

    Ok(normalized)
}

fn parse_unified_diff_hunk(
    lines: &[String],
    hunk_index: usize,
) -> Result<ParsedDiffBlock, String> {
    if lines.is_empty() {
        return Err(format!("unified diff hunk {} 不能为空", hunk_index));
    }

    let mut first_change_index: Option<usize> = None;
    let mut last_change_index: Option<usize> = None;

    for (index, line) in lines.iter().enumerate() {
        if line == "\\ No newline at end of file" {
            continue;
        }

        let prefix = line.chars().next().unwrap_or_default();
        if !matches!(prefix, ' ' | '-' | '+') {
            return Err(format!(
                "unified diff hunk {} 包含非法行 {:?}，只支持以空格、+、- 开头的内容行",
                hunk_index,
                line,
            ));
        }

        if matches!(prefix, '-' | '+') {
            first_change_index.get_or_insert(index);
            last_change_index = Some(index);
        }
    }

    let first_change_index = first_change_index.ok_or_else(|| {
        format!("unified diff hunk {} 没有任何增删行，至少需要一行以 + 或 - 开头", hunk_index)
    })?;
    let last_change_index = last_change_index.expect("change index should exist");

    let before_context = lines[..first_change_index]
        .iter()
        .filter(|line| line.as_str() != "\\ No newline at end of file")
        .map(|line| line[1..].to_string())
        .collect::<Vec<_>>();
    let after_context = lines[last_change_index + 1..]
        .iter()
        .filter(|line| line.as_str() != "\\ No newline at end of file")
        .map(|line| line[1..].to_string())
        .collect::<Vec<_>>();

    let mut old_lines = Vec::new();
    let mut new_lines = Vec::new();
    for line in &lines[first_change_index..=last_change_index] {
        if line == "\\ No newline at end of file" {
            continue;
        }

        let prefix = line.chars().next().unwrap_or_default();
        let content = line[1..].to_string();
        match prefix {
            ' ' => {
                old_lines.push(content.clone());
                new_lines.push(content);
            }
            '-' => old_lines.push(content),
            '+' => new_lines.push(content),
            _ => unreachable!("validated prefix"),
        }
    }

    Ok(ParsedDiffBlock {
        before_context,
        old_lines,
        new_lines,
        after_context,
    })
}

fn apply_parsed_diff_blocks_to_content(
    content: &str,
    blocks: &[ParsedDiffBlock],
) -> Result<String, String> {
    let had_trailing_newline = content.ends_with('\n');
    let mut lines = split_lines_preserve_content(content);

    for (index, block) in blocks.iter().enumerate() {
        validate_patch_block(block, index)?;
        let matched = find_block_match(&lines, block, index)?;
        lines.splice(matched.old_start..matched.old_end, block.new_lines.iter().cloned());
    }

    Ok(join_lines(&lines, had_trailing_newline))
}

fn split_lines_preserve_content(content: &str) -> Vec<String> {
    if content.is_empty() {
        return Vec::new();
    }

    let mut lines = content
        .split('\n')
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    if content.ends_with('\n') {
        let _ = lines.pop();
    }

    lines
}

fn join_lines(lines: &[String], had_trailing_newline: bool) -> String {
    if lines.is_empty() {
        return if had_trailing_newline {
            "\n".to_string()
        } else {
            String::new()
        };
    }

    let mut output = lines.join("\n");
    if had_trailing_newline {
        output.push('\n');
    }
    output
}

fn validate_patch_block(block: &ParsedDiffBlock, index: usize) -> Result<(), String> {
    if block.before_context.is_empty() && block.after_context.is_empty() {
        return Err(format!(
            "patch hunk {} 缺少上下文，至少需要 beforeContext 或 afterContext。建议：先重新读取目标文件，至少提供 oldLines 前后任意一侧的紧邻原始行；不要只发送 oldLines/newLines。",
            index + 1,
        ));
    }

    if block.old_lines.is_empty() && block.new_lines.is_empty() {
        return Err(format!(
            "patch hunk {} 的 oldLines 和 newLines 不能同时为空。建议：普通替换至少保留一侧内容；纯插入请使用 oldLines=[]；纯删除请使用 newLines=[].",
            index + 1,
        ));
    }

    Ok(())
}

fn find_block_match(
    lines: &[String],
    block: &ParsedDiffBlock,
    index: usize,
) -> Result<MatchedPatchRange, String> {
    let before_len = block.before_context.len();
    let old_len = block.old_lines.len();
    let after_len = block.after_context.len();
    let total_match_len = before_len + old_len + after_len;
    let max_start = lines.len().saturating_sub(total_match_len);
    let mut matches = Vec::new();

    for start in 0..=max_start {
        if !slice_eq(lines, start, &block.before_context) {
            continue;
        }

        let old_start = start + before_len;
        if old_start + old_len > lines.len() {
            continue;
        }
        if !slice_eq(lines, old_start, &block.old_lines) {
            continue;
        }

        let after_start = old_start + old_len;
        if after_start + after_len > lines.len() {
            continue;
        }
        if !slice_eq(lines, after_start, &block.after_context) {
            continue;
        }

        matches.push(MatchedPatchRange {
            old_start,
            old_end: old_start + old_len,
        });
    }

    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => Err(format!(
            "patch hunk {} 未命中目标上下文，请检查 beforeContext/oldLines/afterContext 是否与当前文件一致。{}建议：先重新读取最新文件内容，逐行复制 oldLines 及其前后紧邻上下文；保留空行为空字符串；如果目标附近有重复内容，请增加更多 beforeContext/afterContext 再重试。",
            index + 1,
            describe_best_mismatch(lines, block),
        )),
        _ => Err(format!(
            "patch hunk {} 命中了多个位置，请提供更精确的上下文避免误修改。{}建议：重新读取文件并补充更多前后紧邻原始行，直到该 hunk 只命中一个位置。",
            index + 1,
            describe_ambiguous_matches(&matches),
        )),
    }
}

fn describe_best_mismatch(lines: &[String], block: &ParsedDiffBlock) -> String {
    let total_match_len = block.before_context.len() + block.old_lines.len() + block.after_context.len();
    let max_start = lines.len().saturating_sub(total_match_len);
    let mut best_detail: Option<PatchMismatchDetail> = None;

    for start in 0..=max_start {
        let Some(detail) = first_mismatch_at_start(lines, block, start) else {
            continue;
        };

        let should_replace = best_detail.as_ref().is_none_or(|current| {
            detail.matched_line_count > current.matched_line_count
        });
        if should_replace {
            best_detail = Some(detail);
        }
    }

    let Some(detail) = best_detail else {
        return String::new();
    };

    format!(
        "最接近的候选从文件第{}行开始；{} 第{}行不匹配：期望 {}，实际文件第{}行为 {}。",
        detail.match_start + 1,
        detail.segment_name,
        detail.segment_line_index + 1,
        format_diagnostic_line_value(detail.expected.as_deref()),
        detail.file_line_index + 1,
        format_diagnostic_line_value(detail.actual.as_deref()),
    )
}

fn describe_ambiguous_matches(matches: &[MatchedPatchRange]) -> String {
    let locations = matches
        .iter()
        .take(3)
        .map(|matched| format!("第{}行", matched.old_start + 1))
        .collect::<Vec<_>>()
        .join("、");

    if matches.len() > 3 {
        format!("当前 hunk 至少命中了 {}、等多个位置。", locations)
    } else {
        format!("当前 hunk 命中了多个位置：{}。", locations)
    }
}

fn first_mismatch_at_start(
    lines: &[String],
    block: &ParsedDiffBlock,
    start: usize,
) -> Option<PatchMismatchDetail> {
    let mut cursor = start;
    let mut matched_line_count = 0;

    for (line_index, expected) in block.before_context.iter().enumerate() {
        let actual = lines.get(cursor);
        if actual != Some(expected) {
            return Some(PatchMismatchDetail {
                match_start: start,
                matched_line_count,
                segment_name: "beforeContext",
                segment_line_index: line_index,
                file_line_index: cursor,
                expected: Some(expected.clone()),
                actual: actual.cloned(),
            });
        }
        cursor += 1;
        matched_line_count += 1;
    }

    for (line_index, expected) in block.old_lines.iter().enumerate() {
        let actual = lines.get(cursor);
        if actual != Some(expected) {
            return Some(PatchMismatchDetail {
                match_start: start,
                matched_line_count,
                segment_name: "oldLines",
                segment_line_index: line_index,
                file_line_index: cursor,
                expected: Some(expected.clone()),
                actual: actual.cloned(),
            });
        }
        cursor += 1;
        matched_line_count += 1;
    }

    for (line_index, expected) in block.after_context.iter().enumerate() {
        let actual = lines.get(cursor);
        if actual != Some(expected) {
            return Some(PatchMismatchDetail {
                match_start: start,
                matched_line_count,
                segment_name: "afterContext",
                segment_line_index: line_index,
                file_line_index: cursor,
                expected: Some(expected.clone()),
                actual: actual.cloned(),
            });
        }
        cursor += 1;
        matched_line_count += 1;
    }

    None
}

fn format_diagnostic_line_value(value: Option<&str>) -> String {
    match value {
        Some("") => "<空行>".to_string(),
        Some(text) => format!("{:?}", text),
        None => "<文件结束>".to_string(),
    }
}

fn slice_eq(lines: &[String], start: usize, expected: &[String]) -> bool {
    if expected.is_empty() {
        return true;
    }

    lines
        .get(start..start + expected.len())
        .is_some_and(|slice| slice == expected)
}

#[cfg(test)]
mod tests {
    use super::{
        apply_parsed_diff_blocks_to_content, apply_unified_markdown_diff_in_root,
        apply_unified_markdown_diff_to_content, parse_unified_diff, ParsedDiffBlock,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("ofive-markdown-patch-test-{unique}-{sequence}"));
        fs::create_dir_all(&root).expect("应成功创建测试根目录");
        root
    }

    #[test]
    fn apply_unified_markdown_diff_to_content_should_replace_matched_block() {
        let patched = apply_unified_markdown_diff_to_content(
            "# Title\n\nalpha\nbeta\ngamma\n",
            "--- a/notes/guide.md\n+++ b/notes/guide.md\n@@ -3,3 +3,3 @@\n alpha\n-beta\n+beta patched\n gamma",
        )
        .expect("应用 patch 应成功");

        assert_eq!(patched, "# Title\n\nalpha\nbeta patched\ngamma\n");
    }

    #[test]
    fn apply_unified_markdown_diff_to_content_should_insert_between_contexts() {
        let patched = apply_unified_markdown_diff_to_content(
            "# Title\n\nalpha\ngamma\n",
            "--- a/notes/guide.md\n+++ b/notes/guide.md\n@@ -3,2 +3,3 @@\n alpha\n+beta\n gamma",
        )
        .expect("插入 patch 应成功");

        assert_eq!(patched, "# Title\n\nalpha\nbeta\ngamma\n");
    }

    #[test]
    fn apply_parsed_diff_blocks_to_content_should_report_guidance_when_context_missing() {
        let result = apply_parsed_diff_blocks_to_content(
            "alpha\nbeta\n",
            &[ParsedDiffBlock {
                before_context: vec![],
                old_lines: vec!["beta".to_string()],
                new_lines: vec!["patched".to_string()],
                after_context: vec![],
            }],
        );

        let error = result.expect_err("缺少上下文时应返回错误");
        assert!(error.contains("建议：先重新读取目标文件"));
        assert!(error.contains("不要只发送 oldLines/newLines"));
    }

    #[test]
    fn apply_parsed_diff_blocks_to_content_should_report_guidance_when_context_not_found() {
        let result = apply_parsed_diff_blocks_to_content(
            "alpha\nbeta\ngamma\n",
            &[ParsedDiffBlock {
                before_context: vec!["alpha".to_string()],
                old_lines: vec!["beta old".to_string()],
                new_lines: vec!["beta patched".to_string()],
                after_context: vec!["gamma".to_string()],
            }],
        );

        let error = result.expect_err("未命中上下文时应返回错误");
        assert!(error.contains("先重新读取最新文件内容"));
        assert!(error.contains("保留空行为空字符串"));
        assert!(error.contains("增加更多 beforeContext/afterContext"));
        assert!(error.contains("oldLines 第1行不匹配"));
        assert!(error.contains("实际文件第2行为 \"beta\""));
    }

    #[test]
    fn apply_parsed_diff_blocks_to_content_should_reject_ambiguous_context() {
        let result = apply_parsed_diff_blocks_to_content(
            "alpha\nbeta\nalpha\nbeta\n",
            &[ParsedDiffBlock {
                before_context: vec!["alpha".to_string()],
                old_lines: vec!["beta".to_string()],
                new_lines: vec!["patched".to_string()],
                after_context: vec![],
            }],
        );

        assert!(result.is_err());
        assert!(result
            .expect_err("应返回歧义错误")
            .contains("多个位置"));
    }

    #[test]
    fn apply_parsed_diff_blocks_to_content_should_report_guidance_when_context_is_ambiguous() {
        let result = apply_parsed_diff_blocks_to_content(
            "alpha\nbeta\nalpha\nbeta\n",
            &[ParsedDiffBlock {
                before_context: vec!["alpha".to_string()],
                old_lines: vec!["beta".to_string()],
                new_lines: vec!["patched".to_string()],
                after_context: vec![],
            }],
        );

        let error = result.expect_err("歧义上下文时应返回错误");
        assert!(error.contains("补充更多前后紧邻原始行"));
        assert!(error.contains("只命中一个位置"));
        assert!(error.contains("第2行"));
        assert!(error.contains("第4行"));
    }

    #[test]
    fn apply_parsed_diff_blocks_to_content_should_report_blank_line_mismatch_details() {
        let result = apply_parsed_diff_blocks_to_content(
            "## 主要类型\n- 外部性\n- 公共物品\n- 垄断\n- 信息不对称\n\n\n## 政府干预\n",
            &[ParsedDiffBlock {
                before_context: vec!["## 主要类型".to_string()],
                old_lines: vec![
                    "- 外部性".to_string(),
                    "- 公共物品".to_string(),
                    "- 垄断".to_string(),
                    "- 信息不对称".to_string(),
                ],
                new_lines: vec!["替换内容".to_string()],
                after_context: vec!["".to_string(), "## 政府干预".to_string()],
            }],
        );

        let error = result.expect_err("空行不匹配时应返回错误");
        assert!(error.contains("afterContext 第2行不匹配"));
        assert!(error.contains("期望 \"## 政府干预\""));
        assert!(error.contains("实际文件第7行为 <空行>"));
    }

    #[test]
    fn parse_unified_diff_should_convert_single_hunk_to_internal_patch() {
        let parsed = parse_unified_diff(
            "--- a/notes/guide.md\n+++ b/notes/guide.md\n@@ -3,3 +3,3 @@\n alpha\n-beta\n+beta patched\n gamma",
        )
        .expect("应成功解析 unified diff");

        assert_eq!(parsed.relative_path, "notes/guide.md");
        assert_eq!(parsed.blocks.len(), 1);
        assert_eq!(
            parsed.blocks[0],
            ParsedDiffBlock {
                before_context: vec!["alpha".to_string()],
                old_lines: vec!["beta".to_string()],
                new_lines: vec!["beta patched".to_string()],
                after_context: vec!["gamma".to_string()],
            }
        );
    }

    #[test]
    fn apply_unified_markdown_diff_in_root_should_persist_file_changes() {
        let root = create_test_root();
        let file_path = root.join("notes").join("guide.md");
        fs::create_dir_all(file_path.parent().expect("应有父目录")).expect("应成功创建目录");
        fs::write(&file_path, "# Guide\n\nalpha\nbeta\ngamma\n").expect("应成功写入文件");

        let response = apply_unified_markdown_diff_in_root(
            &root,
            "--- a/notes/guide.md\n+++ b/notes/guide.md\n@@ -3,3 +3,3 @@\n alpha\n-beta\n+beta patched\n gamma".to_string(),
        )
        .expect("应成功应用 unified diff");

        assert_eq!(response.relative_path, "notes/guide.md");
        assert_eq!(response.applied_block_count, 1);
        assert_eq!(
            fs::read_to_string(file_path).expect("应成功读取写回文件"),
            "# Guide\n\nalpha\nbeta patched\ngamma\n"
        );
    }
}