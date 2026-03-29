//! # Vault Canvas 应用服务
//!
//! 负责 Vault 模块内的结构化 Canvas 读写用例编排，
//! 让 AI 等消费者通过稳定契约访问 `.canvas` 文档，
//! 而不是直接操作原始 JSON 文本。

use std::path::Path;

use crate::app::vault::vault_app_service;
use crate::infra::query::canvas_document;
use crate::shared::vault_contracts::{
    ReadCanvasDocumentResponse, VaultCanvasDocument, WriteMarkdownResponse,
};

/// 在指定仓库根目录下读取结构化 Canvas 文档。
pub fn get_vault_canvas_document_in_root(
    vault_root: &Path,
    relative_path: String,
) -> Result<ReadCanvasDocumentResponse, String> {
    let response = vault_app_service::read_vault_canvas_file_in_root(relative_path, vault_root)?;
    let document = canvas_document::parse_vault_canvas_document(&response.content)?;

    Ok(ReadCanvasDocumentResponse {
        relative_path: response.relative_path,
        document,
    })
}

/// 在指定仓库根目录下保存结构化 Canvas 文档。
pub fn save_vault_canvas_document_in_root(
    vault_root: &Path,
    relative_path: String,
    document: VaultCanvasDocument,
) -> Result<WriteMarkdownResponse, String> {
    let content = canvas_document::serialize_vault_canvas_document(&document)?;
    vault_app_service::save_vault_canvas_file_in_root(relative_path, content, vault_root)
}
