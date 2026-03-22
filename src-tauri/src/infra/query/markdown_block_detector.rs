//! # Markdown 块级结构检测模块
//!
//! 从原始 Markdown 文本中检测 frontmatter、围栏代码块、LaTeX 块等结构，
//! 并提供字节偏移级的排斥区间查询。
//!
//! ## 设计对齐
//!
//! 与前端 `src/utils/markdownBlockDetector.ts` 功能对等：
//! - 前端版本返回行号范围，供非编辑器组件使用
//! - 本模块返回字节偏移范围，供 Rust 文本解析函数使用
//!
//! ## 检测的块级结构（按优先级扫描顺序）
//!
//! 1. **frontmatter** — 文档开头首行为 `---` 的 YAML 块
//! 2. **code-fence** — `` ``` `` 或 `~~~` 围栏代码块
//! 3. **latex-block** — `$$` 行级 LaTeX 公式块
//!
//! ## 依赖
//!
//! 无外部依赖。
//!
//! ## 导出
//!
//! - [`ExcludedByteRange`] — 排斥字节范围
//! - [`detect_excluded_byte_ranges`] — 检测所有排斥字节范围
//! - [`is_byte_offset_excluded`] — 查询某字节偏移是否在排斥范围内

/// 一段被块级结构占据的字节范围。
///
/// ## 字段
/// - `from` — 起始字节偏移（含）
/// - `to` — 结束字节偏移（含）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExcludedByteRange {
    /// 起始字节偏移（含）。
    pub from: usize,
    /// 结束字节偏移（含）。
    pub to: usize,
}

/// 从原始 Markdown 文本中检测所有被块级结构占据的字节范围。
///
/// 按文档顺序单次遍历各行：
/// - frontmatter 仅在文档首行为 `---` 时检测
/// - code-fence 开启后内部的 `$$` 不会被识别为 LaTeX 块
/// - 未闭合的围栏 / LaTeX 块不纳入排斥范围
///
/// # 参数
/// - `content` — 原始 Markdown 文本
///
/// # 返回
/// 排斥字节范围列表（按文档顺序、不重叠）。
pub fn detect_excluded_byte_ranges(content: &str) -> Vec<ExcludedByteRange> {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut ranges = Vec::new();

    // 预计算每行的字节起始偏移
    let mut line_byte_offsets: Vec<usize> = Vec::with_capacity(lines.len());
    let mut offset = 0usize;
    for (i, line) in lines.iter().enumerate() {
        line_byte_offsets.push(offset);
        offset += line.len();
        if i < lines.len() - 1 {
            offset += 1; // '\n'
        }
    }

    let mut i = 0usize;

    // ---- frontmatter（仅文档开头） ----
    if !lines.is_empty() && is_frontmatter_delimiter(lines[0]) {
        for j in 1..lines.len() {
            if is_frontmatter_delimiter(lines[j]) {
                let from = line_byte_offsets[0];
                let to = line_byte_offsets[j] + lines[j].len() - 1;
                ranges.push(ExcludedByteRange { from, to });
                i = j + 1;
                break;
            }
        }
    }

    // ---- 扫描 code-fence 和 latex-block ----
    while i < lines.len() {
        let line = lines[i];

        // 尝试匹配围栏代码块开始
        if let Some((fence_char, fence_len)) = parse_fence_open(line) {
            let mut closed = false;
            for j in (i + 1)..lines.len() {
                if is_fence_close(lines[j], fence_char, fence_len) {
                    let from = line_byte_offsets[i];
                    let to = line_byte_offsets[j] + lines[j].len() - 1;
                    ranges.push(ExcludedByteRange { from, to });
                    i = j + 1;
                    closed = true;
                    break;
                }
            }
            if !closed {
                i += 1;
            }
            continue;
        }

        // 尝试匹配 LaTeX 块开始
        if is_latex_block_delimiter(line) {
            let mut closed = false;
            for j in (i + 1)..lines.len() {
                if is_latex_block_delimiter(lines[j]) {
                    let from = line_byte_offsets[i];
                    let to = line_byte_offsets[j] + lines[j].len() - 1;
                    ranges.push(ExcludedByteRange { from, to });
                    i = j + 1;
                    closed = true;
                    break;
                }
            }
            if !closed {
                i += 1;
            }
            continue;
        }

        i += 1;
    }

    ranges
}

/// 查询某字节偏移是否处于排斥范围内。
///
/// # 参数
/// - `byte_offset` — 字节偏移
/// - `ranges` — 由 [`detect_excluded_byte_ranges`] 返回的排斥范围列表
///
/// # 返回
/// 若偏移在排斥范围内则返回 `true`。
pub fn is_byte_offset_excluded(byte_offset: usize, ranges: &[ExcludedByteRange]) -> bool {
    ranges
        .iter()
        .any(|range| byte_offset >= range.from && byte_offset <= range.to)
}

// ================================================================ //
// 内部辅助函数                                                      //
// ================================================================ //

/// 判断是否为 frontmatter 分隔符 `---`（允许尾部空白）。
fn is_frontmatter_delimiter(line: &str) -> bool {
    let trimmed = line.trim_end();
    trimmed == "---"
}

/// 尝试解析围栏开始行，返回 `(fence_char, fence_length)`。
fn parse_fence_open(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_end();
    if trimmed.is_empty() {
        return None;
    }

    let first = trimmed.as_bytes()[0];
    if first != b'`' && first != b'~' {
        return None;
    }

    let fence_char = first as char;
    let fence_len = trimmed.bytes().take_while(|&b| b == first).count();
    if fence_len < 3 {
        return None;
    }

    // 围栏开始行：至少3个相同字符，后面可以有语言标识
    let rest = &trimmed[fence_len..];
    // 反引号围栏不允许包含反引号
    if fence_char == '`' && rest.contains('`') {
        return None;
    }

    Some((fence_char, fence_len))
}

/// 判断是否为围栏结束行。
fn is_fence_close(line: &str, fence_char: char, min_len: usize) -> bool {
    let trimmed = line.trim_end();
    if trimmed.is_empty() {
        return false;
    }

    let expected_byte = fence_char as u8;
    let close_len = trimmed.bytes().take_while(|&b| b == expected_byte).count();
    if close_len < min_len {
        return false;
    }

    // 结束行不应有其他内容
    trimmed[close_len..].trim().is_empty()
}

/// 判断是否为 LaTeX 块分隔符 `$$`（允许尾部空白）。
fn is_latex_block_delimiter(line: &str) -> bool {
    let trimmed = line.trim_end();
    trimmed == "$$"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_has_no_excluded_ranges() {
        let text = "# Hello\nSome paragraph.\n## Another";
        assert!(detect_excluded_byte_ranges(text).is_empty());
    }

    #[test]
    fn detect_frontmatter_at_start() {
        let text = "---\ntitle: Test\ndate: 2024\n---\n# Heading";
        let ranges = detect_excluded_byte_ranges(text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].from, 0);
        // "---\ntitle: Test\ndate: 2024\n---" 最后一个字符是 '-'
        let expected_end = "---\ntitle: Test\ndate: 2024\n---".len() - 1;
        assert_eq!(ranges[0].to, expected_end);
    }

    #[test]
    fn dash_in_middle_is_not_frontmatter() {
        let text = "# Heading\n---\nsome text\n---";
        let ranges = detect_excluded_byte_ranges(text);
        assert!(ranges.is_empty());
    }

    #[test]
    fn detect_single_code_fence() {
        let text = "# Heading\n```js\nconsole.log('hi');\n```\nEnd";
        let ranges = detect_excluded_byte_ranges(text);
        assert_eq!(ranges.len(), 1);
        // "```js\nconsole.log('hi');\n```" starts after "# Heading\n"
        let block_start = "# Heading\n".len();
        assert_eq!(ranges[0].from, block_start);
    }

    #[test]
    fn detect_tilde_fence() {
        let text = "~~~python\nprint('hi')\n~~~";
        let ranges = detect_excluded_byte_ranges(text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].from, 0);
    }

    #[test]
    fn skip_unclosed_fence() {
        let text = "```js\n# comment\nno closing";
        let ranges = detect_excluded_byte_ranges(text);
        assert!(ranges.is_empty());
    }

    #[test]
    fn detect_latex_block() {
        let text = "Text\n$$\nE = mc^2\n$$\nEnd";
        let ranges = detect_excluded_byte_ranges(text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].from, "Text\n".len());
    }

    #[test]
    fn dollar_inside_code_fence_is_not_latex() {
        let text = "```\n$$\nvalue\n$$\n```";
        let ranges = detect_excluded_byte_ranges(text);
        assert_eq!(ranges.len(), 1);
        // 应只有 code-fence，不应有 latex-block
        assert_eq!(ranges[0].from, 0);
        assert_eq!(ranges[0].to, text.len() - 1);
    }

    #[test]
    fn detect_all_three_together() {
        let text = "---\ntitle: Test\n---\n# Real\n```sh\n# fake\n```\n$$\nx\n$$\n## End";
        let ranges = detect_excluded_byte_ranges(text);
        assert_eq!(ranges.len(), 3);
    }

    #[test]
    fn is_byte_offset_excluded_works() {
        let ranges = vec![
            ExcludedByteRange { from: 0, to: 10 },
            ExcludedByteRange { from: 20, to: 30 },
        ];
        assert!(is_byte_offset_excluded(0, &ranges));
        assert!(is_byte_offset_excluded(5, &ranges));
        assert!(is_byte_offset_excluded(10, &ranges));
        assert!(!is_byte_offset_excluded(11, &ranges));
        assert!(!is_byte_offset_excluded(19, &ranges));
        assert!(is_byte_offset_excluded(20, &ranges));
        assert!(is_byte_offset_excluded(25, &ranges));
        assert!(!is_byte_offset_excluded(31, &ranges));
    }

    #[test]
    fn wikilink_inside_code_block_should_be_excluded() {
        let text = "# Real\n```\n[[fake-link]]\n```\n[[real-link]]";
        let ranges = detect_excluded_byte_ranges(text);

        let fake_pos = text.find("[[fake-link]]").unwrap();
        let real_pos = text.find("[[real-link]]").unwrap();

        assert!(
            is_byte_offset_excluded(fake_pos, &ranges),
            "代码块内的 [[fake-link]] 应被排斥"
        );
        assert!(
            !is_byte_offset_excluded(real_pos, &ranges),
            "代码块外的 [[real-link]] 不应被排斥"
        );
    }

    // ---- 追加：语法嵌套场景 ----

    #[test]
    fn wikilink_inside_frontmatter_should_be_excluded() {
        let text = "---\ntags: [[NotALink]]\n---\n[[real-link]]";
        let ranges = detect_excluded_byte_ranges(text);

        let fake_pos = text.find("[[NotALink]]").unwrap();
        let real_pos = text.find("[[real-link]]").unwrap();

        assert!(is_byte_offset_excluded(fake_pos, &ranges));
        assert!(!is_byte_offset_excluded(real_pos, &ranges));
    }

    #[test]
    fn wikilink_inside_latex_block_should_be_excluded() {
        let text = "# Title\n$$\n[[latex-fake]]\n$$\n[[real]]";
        let ranges = detect_excluded_byte_ranges(text);

        let fake_pos = text.find("[[latex-fake]]").unwrap();
        let real_pos = text.find("[[real]]").unwrap();

        assert!(is_byte_offset_excluded(fake_pos, &ranges));
        assert!(!is_byte_offset_excluded(real_pos, &ranges));
    }

    #[test]
    fn inline_link_inside_code_block_should_be_excluded() {
        let text = "```\n[fake](fake.md)\n```\n[real](real.md)";
        let ranges = detect_excluded_byte_ranges(text);

        let fake_pos = text.find("[fake](fake.md)").unwrap();
        let real_pos = text.find("[real](real.md)").unwrap();

        assert!(is_byte_offset_excluded(fake_pos, &ranges));
        assert!(!is_byte_offset_excluded(real_pos, &ranges));
    }

    #[test]
    fn heading_inside_code_block_should_be_excluded() {
        let text = "```bash\n# This is a comment\n## Another comment\n```\n# Real heading";
        let ranges = detect_excluded_byte_ranges(text);

        let fake_heading = text.find("# This is a comment").unwrap();
        let real_heading = text.find("# Real heading").unwrap();

        assert!(is_byte_offset_excluded(fake_heading, &ranges));
        assert!(!is_byte_offset_excluded(real_heading, &ranges));
    }

    #[test]
    fn tag_inside_code_block_should_be_excluded() {
        let text = "```\n#fake-tag\n```\n#real-tag";
        let ranges = detect_excluded_byte_ranges(text);

        let fake_pos = text.find("#fake-tag").unwrap();
        let real_pos = text.find("#real-tag").unwrap();

        assert!(is_byte_offset_excluded(fake_pos, &ranges));
        assert!(!is_byte_offset_excluded(real_pos, &ranges));
    }

    #[test]
    fn nested_fence_four_backticks_containing_three() {
        // 4 个反引号围栏内嵌套 3 个反引号——不应被视为关闭
        let text = "````md\n```\ninner\n```\n````\n[[outside]]";
        let ranges = detect_excluded_byte_ranges(text);

        assert_eq!(ranges.len(), 1, "整个 ```` 块应是一个排斥区间");
        let inner_pos = text.find("inner").unwrap();
        let outside_pos = text.find("[[outside]]").unwrap();

        assert!(is_byte_offset_excluded(inner_pos, &ranges));
        assert!(!is_byte_offset_excluded(outside_pos, &ranges));
    }

    #[test]
    fn tilde_fence_should_not_be_closed_by_backtick_fence() {
        let text = "~~~\n```\ncontent\n```\n~~~\nafter";
        let ranges = detect_excluded_byte_ranges(text);

        assert_eq!(ranges.len(), 1);
        // ~~~ 围栏应被 ~~~ 关闭，内部的 ``` 不应结束块
        let content_pos = text.find("content").unwrap();
        let after_pos = text.find("after").unwrap();

        assert!(is_byte_offset_excluded(content_pos, &ranges));
        assert!(!is_byte_offset_excluded(after_pos, &ranges));
    }

    #[test]
    fn latex_delimiter_inside_code_fence_should_not_open_latex() {
        // $$在代码块内不应开启 LaTeX 块
        let text = "```\n$$\nE=mc^2\n```\n$$\nreal-latex\n$$";
        let ranges = detect_excluded_byte_ranges(text);

        assert_eq!(ranges.len(), 2, "应有代码块和 LaTeX 块两个区间");
        let real_latex_pos = text.rfind("real-latex").unwrap();
        assert!(is_byte_offset_excluded(real_latex_pos, &ranges));
    }

    #[test]
    fn frontmatter_code_fence_and_latex_all_present() {
        let text = concat!(
            "---\ntitle: hello\n---\n",
            "# Heading\n",
            "```python\n# comment\n[[fake]]\n```\n",
            "[[real]]\n",
            "$$\nx^2\n$$\n",
            "normal text"
        );
        let ranges = detect_excluded_byte_ranges(text);
        assert_eq!(ranges.len(), 3, "frontmatter + code-fence + latex");

        let fake_pos = text.find("[[fake]]").unwrap();
        let real_pos = text.find("[[real]]").unwrap();
        let latex_pos = text.find("x^2").unwrap();
        let heading_pos = text.find("# Heading").unwrap();
        let normal_pos = text.find("normal text").unwrap();

        assert!(is_byte_offset_excluded(fake_pos, &ranges));
        assert!(!is_byte_offset_excluded(real_pos, &ranges));
        assert!(is_byte_offset_excluded(latex_pos, &ranges));
        assert!(!is_byte_offset_excluded(heading_pos, &ranges));
        assert!(!is_byte_offset_excluded(normal_pos, &ranges));
    }

    #[test]
    fn multiple_code_blocks_are_independent() {
        let text = "```\n[[A]]\n```\n[[B]]\n```\n[[C]]\n```\n[[D]]";
        let ranges = detect_excluded_byte_ranges(text);
        assert_eq!(ranges.len(), 2, "应有两个独立代码块");

        assert!(is_byte_offset_excluded(
            text.find("[[A]]").unwrap(),
            &ranges
        ));
        assert!(!is_byte_offset_excluded(
            text.find("[[B]]").unwrap(),
            &ranges
        ));
        assert!(is_byte_offset_excluded(
            text.find("[[C]]").unwrap(),
            &ranges
        ));
        assert!(!is_byte_offset_excluded(
            text.find("[[D]]").unwrap(),
            &ranges
        ));
    }

    #[test]
    fn unclosed_code_fence_should_not_exclude_content() {
        let text = "```\n[[inside]]\n# heading\nnot closed";
        let ranges = detect_excluded_byte_ranges(text);
        assert!(ranges.is_empty(), "未闭合围栏不应产生排斥区间");
    }

    #[test]
    fn unclosed_latex_block_should_not_exclude_content() {
        let text = "$$\nx=1\n[[link]]\nnot closed";
        let ranges = detect_excluded_byte_ranges(text);
        assert!(ranges.is_empty(), "未闭合 LaTeX 块不应产生排斥区间");
    }

    #[test]
    fn empty_code_block_should_still_exclude() {
        let text = "```\n```\n[[outside]]";
        let ranges = detect_excluded_byte_ranges(text);
        assert_eq!(ranges.len(), 1);
        assert!(!is_byte_offset_excluded(
            text.find("[[outside]]").unwrap(),
            &ranges
        ));
    }

    #[test]
    fn code_fence_with_language_and_trailing_info() {
        let text = "```rust title=\"example\"\nlet x = 1;\n```\n[[link]]";
        let ranges = detect_excluded_byte_ranges(text);
        assert_eq!(ranges.len(), 1);
        let code_pos = text.find("let x = 1;").unwrap();
        let link_pos = text.find("[[link]]").unwrap();
        assert!(is_byte_offset_excluded(code_pos, &ranges));
        assert!(!is_byte_offset_excluded(link_pos, &ranges));
    }
}
