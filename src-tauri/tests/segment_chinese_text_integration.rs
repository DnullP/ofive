//! # 分词接口集成测试
//!
//! 本模块用于验证后端 `segment_chinese_text` 对前端暴露接口的可用性。
//! - 依赖：`ofive_lib::segment_chinese_text`
//! - 目标：覆盖空输入、长中文文本、UTF-16 偏移有效性
//! - 使用示例：`cargo test --test segment_chinese_text_integration`

use ofive_lib::segment_chinese_text;
use serde_json::Value;

/// 计算字符串在 UTF-16 语义下的长度。
fn utf16_len(input: &str) -> usize {
    input.encode_utf16().count()
}

/// 查找子串在 UTF-16 语义下的起始偏移。
fn utf16_find(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .find(needle)
        .map(|byte_index| utf16_len(&haystack[..byte_index]))
}

/// 从分词结果的序列化表示中读取 UTF-16 起止偏移。
fn token_offsets(token: &impl serde::Serialize) -> (usize, usize) {
    let value = serde_json::to_value(token).expect("token 应可被序列化为 JSON");
    let start = value
        .get("start")
        .and_then(Value::as_u64)
        .expect("token.start 应为非负整数") as usize;
    let end = value
        .get("end")
        .and_then(Value::as_u64)
        .expect("token.end 应为非负整数") as usize;
    (start, end)
}

/// 从分词结果中读取 token 文本。
fn token_word(token: &impl serde::Serialize) -> String {
    let value = serde_json::to_value(token).expect("token 应可被序列化为 JSON");
    value
        .get("word")
        .and_then(Value::as_str)
        .expect("token.word 应为字符串")
        .to_string()
}

/// 将 UTF-16 偏移转换为 UTF-8 字节偏移。
fn utf16_to_byte_offset(text: &str, utf16_offset: usize) -> Option<usize> {
    if utf16_offset == 0 {
        return Some(0);
    }

    let mut current_utf16 = 0usize;
    for (byte_index, character) in text.char_indices() {
        if current_utf16 == utf16_offset {
            return Some(byte_index);
        }

        current_utf16 += character.len_utf16();
        if current_utf16 == utf16_offset {
            return Some(byte_index + character.len_utf8());
        }

        if current_utf16 > utf16_offset {
            return None;
        }
    }

    if current_utf16 == utf16_offset {
        Some(text.len())
    } else {
        None
    }
}

/// 按 UTF-16 开区间切片文本。
fn utf16_slice(text: &str, start: usize, end: usize) -> Option<String> {
    let byte_start = utf16_to_byte_offset(text, start)?;
    let byte_end = utf16_to_byte_offset(text, end)?;

    if byte_end < byte_start {
        return None;
    }

    text.get(byte_start..byte_end).map(ToString::to_string)
}

/// 验证空输入时分词接口返回空数组。
#[test]
fn segment_chinese_text_returns_empty_for_blank_input() {
    let tokens = segment_chinese_text("   \n\t".to_string()).expect("分词接口应正常返回");
    assert!(tokens.is_empty(), "空输入应返回空 token 列表");
}

/// 验证长中文文本分词可用，并且返回的 UTF-16 偏移单调且合法。
#[test]
fn segment_chinese_text_handles_long_chinese_text_with_valid_offsets() {
    let text = r#"---
title: Communication-protocol Stack
aliases:
  - 通信协议栈
---
协议栈指的是形成了分层网络通信所用的接口和协议构成的层次结构。
由上，在通信双方，分层的协议通过接口进行传递，在同一层之间通过协议进行通信。
协议通常和某种软硬件绑定，提供特殊场景的信息传输能力。
在底层我们通过线缆连接两端，通过信号传输信息。
向上走一层，线缆收到信号后，我们希望有一个中枢能够将某个线缆的信息广播、转发给其他线缆。
再往上，我们希望应用程序能够读取和处理网络的信息。"#;

    let tokens = segment_chinese_text(text.to_string()).expect("分词接口应正常返回");
    assert!(!tokens.is_empty(), "长中文文本应产生分词结果");

    let total_utf16 = utf16_len(text);
    let mut prev_start = 0usize;
    let mut non_empty_span_count = 0usize;

    for (index, token) in tokens.iter().enumerate() {
        let word = token_word(token);
        let (start, end) = token_offsets(token);
        assert!(start < end, "token[{index}] 必须满足 start < end");
        assert!(
            end <= total_utf16,
            "token[{index}] 结束偏移不能超过文本 UTF-16 长度"
        );
        if index > 0 {
            assert!(start >= prev_start, "token[{index}] 起始偏移应保持非递减");
        }

        let sliced = utf16_slice(text, start, end).expect("token 偏移应可还原为有效切片");
        assert_eq!(sliced, word, "token[{index}] 文本与偏移切片必须一致");

        non_empty_span_count += 1;
        prev_start = start;
    }

    assert!(non_empty_span_count > 0, "应至少包含一个非零长度 token");

    let protocol_stack_utf16 = utf16_find(text, "协议栈").expect("测试文本应包含“协议栈”");
    assert!(
        tokens.iter().any(|token| {
            let (start, end) = token_offsets(token);
            start <= protocol_stack_utf16 && end > protocol_stack_utf16
        }),
        "分词结果应覆盖“协议栈”起始位置",
    );

    let communication_stack_utf16 =
        utf16_find(text, "通信协议栈").expect("测试文本应包含“通信协议栈”");
    assert!(
        tokens.iter().any(|token| {
            let (start, end) = token_offsets(token);
            start <= communication_stack_utf16 && end > communication_stack_utf16
        }),
        "分词结果应覆盖“通信协议栈”起始位置",
    );
}

/// 验证包含英文与符号混合文本时仍可返回稳定偏移。
#[test]
fn segment_chinese_text_handles_mixed_text() {
    let text = "协议通常和某种软硬件绑定，支持 TCP/UDP、VPN、P2P 等场景。";
    let tokens = segment_chinese_text(text.to_string()).expect("分词接口应正常返回");

    assert!(!tokens.is_empty(), "混合文本应产生分词结果");

    let total_utf16 = utf16_len(text);
    let mut non_empty_span_count = 0usize;
    for (index, token) in tokens.iter().enumerate() {
        let word = token_word(token);
        let (start, end) = token_offsets(token);
        assert!(start < end, "token[{index}] 必须满足 start < end");
        assert!(
            end <= total_utf16,
            "token[{index}] 结束偏移不能超过文本 UTF-16 长度"
        );

        let sliced = utf16_slice(text, start, end).expect("token 偏移应可还原为有效切片");
        assert_eq!(sliced, word, "token[{index}] 文本与偏移切片必须一致");

        non_empty_span_count += 1;
    }

    assert!(non_empty_span_count > 0, "应至少包含一个非零长度 token");
}

/// 验证多个关键词语样例的分词结果（用于保障 Vim `w/b/e` 的词边界质量）。
#[test]
fn segment_chinese_text_validates_multiple_word_samples() {
    let text = "通信 协议 栈 网络 应用程序 传输层 网络层 数据 交换";
    let expected_words = [
        "通信",
        "协议",
        "栈",
        "网络",
        "应用程序",
        "传输层",
        "网络层",
        "数据",
        "交换",
    ];

    let tokens = segment_chinese_text(text.to_string()).expect("分词接口应正常返回");
    assert!(!tokens.is_empty(), "关键词样例文本应产生分词结果");

    let words = tokens.iter().map(token_word).collect::<Vec<_>>();

    for (index, token) in tokens.iter().enumerate() {
        let word = token_word(token);
        let (start, end) = token_offsets(token);
        assert!(start < end, "token[{index}] 必须满足 start < end");
        let sliced = utf16_slice(text, start, end).expect("token 偏移应可还原为有效切片");
        assert_eq!(sliced, word, "token[{index}] 文本与偏移切片必须一致");
    }

    for expected in expected_words {
        assert!(
            words.iter().any(|word| word == expected),
            "分词结果中应包含词语样例：{expected}",
        );
    }
}
