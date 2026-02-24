//! # 中文分词模块
//!
//! 封装 Jieba 分词调用与 UTF-16 偏移转换。

use crate::vault_commands::types::ChineseSegmentToken;
use jieba_rs::{Jieba, TokenizeMode};
use std::sync::OnceLock;

/// 中文分词器单例。
static JIEBA_INSTANCE: OnceLock<Jieba> = OnceLock::new();

/// 获取中文分词器单例。
fn jieba_instance() -> &'static Jieba {
    JIEBA_INSTANCE.get_or_init(Jieba::new)
}

/// 将 UTF-8 字节偏移转换为 UTF-16 偏移（向下取整到字符边界）。
fn utf16_offset_of_byte_floor(text: &str, byte_index: usize) -> usize {
    let clamped_byte_index = byte_index.min(text.len());
    let mut utf16_offset = 0usize;

    for (char_start, character) in text.char_indices() {
        let char_end = char_start + character.len_utf8();
        if char_end > clamped_byte_index {
            break;
        }
        utf16_offset += character.len_utf16();
    }

    utf16_offset
}

/// 将 UTF-8 字节偏移转换为 UTF-16 偏移（向上取整到字符边界）。
fn utf16_offset_of_byte_ceil(text: &str, byte_index: usize) -> usize {
    let clamped_byte_index = byte_index.min(text.len());
    let mut utf16_offset = 0usize;

    for (char_start, character) in text.char_indices() {
        let char_end = char_start + character.len_utf8();
        if char_end < clamped_byte_index {
            utf16_offset += character.len_utf16();
            continue;
        }

        utf16_offset += character.len_utf16();
        return utf16_offset;
    }

    utf16_offset
}

/// 将字符位置偏移（按 Unicode 标量个数）转换为 UTF-16 偏移。
fn utf16_offset_of_char_position(text: &str, position: usize) -> usize {
    if position == 0 {
        return 0;
    }

    let mut utf16_offset = 0usize;
    let mut character_count = 0usize;

    for character in text.chars() {
        if character_count >= position {
            break;
        }
        utf16_offset += character.len_utf16();
        character_count += 1;
    }

    utf16_offset
}

/// 解析单个 token 的 UTF-16 起止偏移。
///
/// 兼容 `jieba-rs` 位置索引在不同场景下可能出现的“字节偏移”或“字符偏移”语义。
fn resolve_token_utf16_offsets(
    text: &str,
    word: &str,
    raw_start: usize,
    raw_end: usize,
) -> (usize, usize) {
    let byte_semantics_matched = raw_start <= raw_end
        && raw_end <= text.len()
        && text.is_char_boundary(raw_start)
        && text.is_char_boundary(raw_end)
        && text
            .get(raw_start..raw_end)
            .is_some_and(|slice| slice == word);

    if byte_semantics_matched {
        return (
            utf16_offset_of_byte_floor(text, raw_start),
            utf16_offset_of_byte_floor(text, raw_end),
        );
    }

    let char_start = utf16_offset_of_char_position(text, raw_start);
    let char_end = utf16_offset_of_char_position(text, raw_end);
    if char_end > char_start {
        return (char_start, char_end);
    }

    let byte_start = utf16_offset_of_byte_floor(text, raw_start);
    let mut byte_end = utf16_offset_of_byte_ceil(text, raw_end);
    if byte_end < byte_start {
        byte_end = byte_start;
    }

    (byte_start, byte_end)
}

/// 对文本执行中文分词。
pub fn segment_chinese_text(text: String) -> Result<Vec<ChineseSegmentToken>, String> {
    println!(
        "[segment] segment_chinese_text start: chars={} bytes={}",
        text.chars().count(),
        text.len()
    );

    if text.trim().is_empty() {
        println!("[segment] segment_chinese_text warning: empty input");
        return Ok(Vec::new());
    }

    let jieba = jieba_instance();
    let tokens = jieba.tokenize(&text, TokenizeMode::Default, true);

    let result = tokens
        .into_iter()
        .map(|token| {
            let word = token.word.to_string();
            let (start, mut end) =
                resolve_token_utf16_offsets(&text, &word, token.start, token.end);

            if end < start {
                end = start;
            }

            ChineseSegmentToken { word, start, end }
        })
        .collect::<Vec<_>>();

    println!(
        "[segment] segment_chinese_text success: tokens={}",
        result.len()
    );
    Ok(result)
}

/* ================================================================== */
/*  单元测试                                                           */
/* ================================================================== */

#[cfg(test)]
mod tests {
    use super::*;

    // ---- utf16_offset 辅助函数 ----

    #[test]
    fn utf16_floor_ascii() {
        assert_eq!(utf16_offset_of_byte_floor("hello", 0), 0);
        assert_eq!(utf16_offset_of_byte_floor("hello", 3), 3);
        assert_eq!(utf16_offset_of_byte_floor("hello", 5), 5);
    }

    #[test]
    fn utf16_floor_chinese() {
        // "你好" → 每字 3 字节, 1 UTF-16 码元
        assert_eq!(utf16_offset_of_byte_floor("你好", 0), 0);
        assert_eq!(utf16_offset_of_byte_floor("你好", 3), 1);
        assert_eq!(utf16_offset_of_byte_floor("你好", 6), 2);
    }

    #[test]
    fn utf16_floor_mixed() {
        // "a你b" → a(1 byte, 1 u16), 你(3 bytes, 1 u16), b(1 byte, 1 u16)
        assert_eq!(utf16_offset_of_byte_floor("a你b", 0), 0);
        assert_eq!(utf16_offset_of_byte_floor("a你b", 1), 1); // 'a' 之后
        assert_eq!(utf16_offset_of_byte_floor("a你b", 4), 2); // '你' 之后
        assert_eq!(utf16_offset_of_byte_floor("a你b", 5), 3); // 'b' 之后
    }

    #[test]
    fn utf16_ceil_ascii() {
        assert_eq!(utf16_offset_of_byte_ceil("hello", 0), 1);
        assert_eq!(utf16_offset_of_byte_ceil("hello", 5), 5);
    }

    #[test]
    fn utf16_ceil_chinese() {
        // byte 0 → '你' 的起始，ceil 取到 '你' 结束 → UTF-16 偏移 1
        assert_eq!(utf16_offset_of_byte_ceil("你好", 0), 1);
        // byte 3 → '你'/'好' 边界，ceil 取到 '你' 结束 → UTF-16 偏移 1
        assert_eq!(utf16_offset_of_byte_ceil("你好", 3), 1);
        // byte 4 → '好' 内部，ceil 取到 '好' 结束 → UTF-16 偏移 2
        assert_eq!(utf16_offset_of_byte_ceil("你好", 4), 2);
    }

    #[test]
    fn utf16_char_position_basic() {
        assert_eq!(utf16_offset_of_char_position("hello", 0), 0);
        assert_eq!(utf16_offset_of_char_position("hello", 3), 3);
        assert_eq!(utf16_offset_of_char_position("你好", 0), 0);
        assert_eq!(utf16_offset_of_char_position("你好", 1), 1);
        assert_eq!(utf16_offset_of_char_position("你好", 2), 2);
    }

    // ---- segment_chinese_text ----

    #[test]
    fn segment_empty_text() {
        let result = segment_chinese_text("".to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn segment_whitespace_only() {
        let result = segment_chinese_text("   ".to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn segment_pure_chinese() {
        let result = segment_chinese_text("我是一个学生".to_string()).unwrap();
        assert!(!result.is_empty());

        // 验证 token 连续覆盖整行
        assert_eq!(result.first().unwrap().start, 0);
        assert_eq!(result.last().unwrap().end, 6); // 6 个 UTF-16 码元

        // token 之间不应该有间隙
        for i in 1..result.len() {
            assert_eq!(
                result[i].start,
                result[i - 1].end,
                "token gap between '{}' and '{}'",
                result[i - 1].word,
                result[i].word
            );
        }
    }

    #[test]
    fn segment_pure_english() {
        let result = segment_chinese_text("hello world test".to_string()).unwrap();
        assert!(!result.is_empty());

        // 验证覆盖整行
        assert_eq!(result.first().unwrap().start, 0);
        assert_eq!(result.last().unwrap().end, 16);
    }

    #[test]
    fn segment_mixed_chinese_english() {
        let result = segment_chinese_text("我是developer测试".to_string()).unwrap();
        assert!(!result.is_empty());

        // 验证覆盖整行
        assert_eq!(result.first().unwrap().start, 0);
        // "我是developer测试" = 2 + 9 + 2 = 13 UTF-16 码元
        assert_eq!(result.last().unwrap().end, 13);

        // 无间隙
        for i in 1..result.len() {
            assert_eq!(result[i].start, result[i - 1].end);
        }

        // 至少有一个 token 包含 "developer"
        let has_dev = result.iter().any(|t| t.word.contains("developer"));
        assert!(
            has_dev,
            "should contain 'developer' token, got: {:?}",
            result.iter().map(|t| &t.word).collect::<Vec<_>>()
        );
    }

    #[test]
    fn segment_with_punctuation() {
        let result = segment_chinese_text("你好，世界！".to_string()).unwrap();
        assert!(!result.is_empty());

        // 覆盖整行
        assert_eq!(result.first().unwrap().start, 0);
        assert_eq!(result.last().unwrap().end, 6);

        // 无间隙
        for i in 1..result.len() {
            assert_eq!(result[i].start, result[i - 1].end);
        }
    }

    #[test]
    fn segment_markdown_heading() {
        let result = segment_chinese_text("## 这是标题".to_string()).unwrap();
        assert!(!result.is_empty());

        // 覆盖整行
        assert_eq!(result.first().unwrap().start, 0);
        // "## 这是标题" = 2 + 1 + 4 = 7 UTF-16 码元
        assert_eq!(result.last().unwrap().end, 7);
    }

    #[test]
    fn segment_numbers_and_chinese() {
        let result = segment_chinese_text("第1个测试2024年".to_string()).unwrap();
        assert!(!result.is_empty());
        assert_eq!(result.first().unwrap().start, 0);
        // "第1个测试2024年" = 1+1+1+2+4+1 = 10 UTF-16 码元
        assert_eq!(result.last().unwrap().end, 10);

        // 无间隙
        for i in 1..result.len() {
            assert_eq!(result[i].start, result[i - 1].end);
        }
    }

    #[test]
    fn segment_offsets_are_monotonic() {
        let inputs = vec![
            "你好世界",
            "hello world",
            "我是developer测试",
            "第1个test 2024年！",
            "## 标题\n正文内容",
        ];

        for input in inputs {
            let result = segment_chinese_text(input.to_string()).unwrap();
            for i in 0..result.len() {
                assert!(
                    result[i].start <= result[i].end,
                    "Token '{}' has start {} > end {} in '{}'",
                    result[i].word,
                    result[i].start,
                    result[i].end,
                    input
                );
                if i > 0 {
                    assert!(
                        result[i].start >= result[i - 1].end,
                        "Token overlap: '{}' end {} > '{}' start {} in '{}'",
                        result[i - 1].word,
                        result[i - 1].end,
                        result[i].word,
                        result[i].start,
                        input
                    );
                }
            }
        }
    }

    // ---- resolve_token_utf16_offsets ----

    #[test]
    fn resolve_offsets_byte_semantics() {
        // "你好世界" → 每字 3 字节
        let text = "你好世界";
        // token "你好" at byte 0..6
        let (start, end) = resolve_token_utf16_offsets(text, "你好", 0, 6);
        assert_eq!(start, 0);
        assert_eq!(end, 2);

        // token "世界" at byte 6..12
        let (start, end) = resolve_token_utf16_offsets(text, "世界", 6, 12);
        assert_eq!(start, 2);
        assert_eq!(end, 4);
    }

    #[test]
    fn resolve_offsets_mixed_text() {
        let text = "a你b";
        // 'a'=1byte, '你'=3bytes, 'b'=1byte → total 5 bytes
        let (start, end) = resolve_token_utf16_offsets(text, "a", 0, 1);
        assert_eq!(start, 0);
        assert_eq!(end, 1);

        let (start, end) = resolve_token_utf16_offsets(text, "你", 1, 4);
        assert_eq!(start, 1);
        assert_eq!(end, 2);

        let (start, end) = resolve_token_utf16_offsets(text, "b", 4, 5);
        assert_eq!(start, 2);
        assert_eq!(end, 3);
    }
}
