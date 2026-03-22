//! # 中文分词基础设施模块
//!
//! 封装 Jieba 分词调用与 UTF-16 偏移转换，供应用层直接编排。

use crate::shared::vault_contracts::ChineseSegmentToken;
use jieba_rs::{Jieba, TokenizeMode};
use std::sync::OnceLock;

static JIEBA_INSTANCE: OnceLock<Jieba> = OnceLock::new();

fn jieba_instance() -> &'static Jieba {
    JIEBA_INSTANCE.get_or_init(Jieba::new)
}

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

pub(crate) fn segment_chinese_text(text: String) -> Result<Vec<ChineseSegmentToken>, String> {
    log::info!(
        "[segment] segment_chinese_text start: chars={} bytes={}",
        text.chars().count(),
        text.len()
    );

    if text.trim().is_empty() {
        log::info!("[segment] segment_chinese_text warning: empty input");
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

    log::info!(
        "[segment] segment_chinese_text success: tokens={}",
        result.len()
    );
    Ok(result)
}