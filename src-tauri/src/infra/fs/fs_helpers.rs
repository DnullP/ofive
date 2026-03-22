//! # 仓库文件系统辅助模块
//!
//! 提供目录遍历、路径校验、相对路径转换、MIME 推断等通用能力。

use crate::shared::vault_contracts::VaultEntry;
use std::fs;
use std::path::{Component, Path, PathBuf};

const SUPPORTED_IMAGE_EXTENSIONS: [&str; 8] =
    ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"];
const INTERNAL_SYSTEM_DIR: &str = ".ofive";

/// 判断路径首段是否为内部系统目录（`.ofive`）。
fn is_internal_system_relative_path(path: &Path) -> bool {
    path.components().next().is_some_and(
        |component| matches!(component, Component::Normal(name) if name == INTERNAL_SYSTEM_DIR),
    )
}

/// 判断绝对路径在 vault 下的相对路径是否位于内部系统目录。
fn is_internal_system_path_under_base(path: &Path, base: &Path) -> bool {
    path.strip_prefix(base)
        .ok()
        .is_some_and(is_internal_system_relative_path)
}

/// 校验并规范化 vault 路径。
pub fn canonicalize_vault_path(vault_path: &str) -> Result<PathBuf, String> {
    if vault_path.trim().is_empty() {
        log::warn!("[vault] set_current_vault failed: empty path");
        return Err("vault 路径不能为空".to_string());
    }

    let path = PathBuf::from(vault_path);
    if !path.exists() {
        log::warn!(
            "[vault] set_current_vault failed: path not exists -> {}",
            vault_path
        );
        return Err("vault 路径不存在".to_string());
    }

    if !path.is_dir() {
        log::warn!(
            "[vault] set_current_vault failed: not a directory -> {}",
            vault_path
        );
        return Err("vault 路径必须是目录".to_string());
    }

    path.canonicalize()
        .map_err(|error| format!("规范化 vault 路径失败: {error}"))
}

/// 递归收集目录树。
pub fn collect_tree_entries(
    root: &Path,
    base: &Path,
    entries: &mut Vec<VaultEntry>,
) -> Result<(), String> {
    let read_dir =
        fs::read_dir(root).map_err(|error| format!("读取目录失败 {}: {error}", root.display()))?;

    for item in read_dir {
        let item = item.map_err(|error| format!("读取目录项失败: {error}"))?;
        let path = item.path();
        if is_internal_system_path_under_base(&path, base) {
            continue;
        }

        let metadata = item
            .metadata()
            .map_err(|error| format!("读取元数据失败 {}: {error}", path.display()))?;

        let relative = path
            .strip_prefix(base)
            .map_err(|error| format!("计算相对路径失败 {}: {error}", path.display()))?
            .to_string_lossy()
            .replace('\\', "/");

        entries.push(VaultEntry {
            relative_path: relative,
            is_dir: metadata.is_dir(),
        });

        if metadata.is_dir() {
            collect_tree_entries(&path, base, entries)?;
        }
    }

    Ok(())
}

/// 递归收集 Markdown 文件相对路径。
pub fn collect_markdown_relative_paths(
    root: &Path,
    base: &Path,
    output: &mut Vec<String>,
) -> Result<(), String> {
    let read_dir =
        fs::read_dir(root).map_err(|error| format!("读取目录失败 {}: {error}", root.display()))?;

    for entry in read_dir {
        let entry = entry.map_err(|error| format!("读取目录项失败: {error}"))?;
        let path = entry.path();
        if is_internal_system_path_under_base(&path, base) {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|error| format!("读取元数据失败 {}: {error}", path.display()))?;

        if metadata.is_dir() {
            collect_markdown_relative_paths(&path, base, output)?;
            continue;
        }

        if !metadata.is_file() || !is_markdown_file(&path) {
            continue;
        }

        let relative = path
            .strip_prefix(base)
            .map_err(|error| format!("计算相对路径失败 {}: {error}", path.display()))?
            .to_string_lossy()
            .replace('\\', "/");

        output.push(relative);
    }

    Ok(())
}

/// 解析并校验相对路径对应的 Markdown 文件真实路径。
pub fn resolve_markdown_path(vault_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    if relative_path.trim().is_empty() {
        log::warn!("[vault] read markdown failed: empty relative path");
        return Err("relative_path 不能为空".to_string());
    }

    let is_markdown = relative_path.ends_with(".md") || relative_path.ends_with(".markdown");
    if !is_markdown {
        log::warn!(
            "[vault] read markdown failed: invalid extension -> {}",
            relative_path
        );
        return Err("仅支持读取 .md/.markdown 文件".to_string());
    }

    if is_internal_system_relative_path(Path::new(relative_path)) {
        log::warn!(
            "[vault] read markdown failed: internal system path blocked -> {}",
            relative_path
        );
        return Err("禁止访问系统目录 .ofive 下的文件".to_string());
    }

    let raw_path = vault_root.join(relative_path);
    let canonical_vault_root = vault_root
        .canonicalize()
        .map_err(|error| format!("解析 vault 根目录失败 {}: {error}", vault_root.display()))?;
    let canonical = raw_path
        .canonicalize()
        .map_err(|error| format!("读取目标文件路径失败: {error}"))?;

    if !canonical.starts_with(&canonical_vault_root) {
        log::warn!(
            "[vault] read markdown failed: path traversal blocked -> {}",
            relative_path
        );
        return Err("禁止访问 vault 目录外的文件".to_string());
    }

    if !canonical.is_file() {
        log::warn!(
            "[vault] read markdown failed: not file -> {}",
            canonical.display()
        );
        return Err("目标路径不是文件".to_string());
    }

    Ok(canonical)
}

/// 校验相对路径格式，并返回 vault 内目标路径（支持文件尚不存在场景）。
pub fn resolve_markdown_target_path(
    vault_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    if relative_path.trim().is_empty() {
        log::warn!("[vault] write markdown failed: empty relative path");
        return Err("relative_path 不能为空".to_string());
    }

    let is_markdown = relative_path.ends_with(".md") || relative_path.ends_with(".markdown");
    if !is_markdown {
        log::warn!(
            "[vault] write markdown failed: invalid extension -> {}",
            relative_path
        );
        return Err("仅支持操作 .md/.markdown 文件".to_string());
    }

    let relative = Path::new(relative_path);
    if relative.is_absolute() {
        log::warn!(
            "[vault] write markdown failed: absolute path blocked -> {}",
            relative_path
        );
        return Err("relative_path 必须是相对路径".to_string());
    }

    let has_parent_escape = relative
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir));
    if has_parent_escape {
        log::warn!(
            "[vault] write markdown failed: parent traversal blocked -> {}",
            relative_path
        );
        return Err("禁止访问 vault 目录外的文件".to_string());
    }

    if is_internal_system_relative_path(relative) {
        log::warn!(
            "[vault] write markdown failed: internal system path blocked -> {}",
            relative_path
        );
        return Err("禁止访问系统目录 .ofive 下的文件".to_string());
    }

    Ok(vault_root.join(relative))
}

/// 校验相对路径格式，并返回 vault 内二进制文件目标路径（支持文件尚不存在场景）。
///
/// 与 `resolve_markdown_target_path` 类似，但不限定扩展名为 `.md`/`.markdown`。
/// # 参数
/// - `vault_root` - vault 根目录绝对路径。
/// - `relative_path` - 待写入二进制文件的相对路径。
/// # 返回
/// - 合法时返回绝对路径。
/// # 异常
/// - 路径为空、绝对路径、目录逃逸、系统目录均报错。
pub fn resolve_binary_target_path(
    vault_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    if relative_path.trim().is_empty() {
        log::warn!("[vault] write binary failed: empty relative path");
        return Err("relative_path 不能为空".to_string());
    }

    let relative = Path::new(relative_path);
    if relative.is_absolute() {
        log::warn!(
            "[vault] write binary failed: absolute path blocked -> {}",
            relative_path
        );
        return Err("relative_path 必须是相对路径".to_string());
    }

    let has_parent_escape = relative
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir));
    if has_parent_escape {
        log::warn!(
            "[vault] write binary failed: parent traversal blocked -> {}",
            relative_path
        );
        return Err("禁止访问 vault 目录外的文件".to_string());
    }

    if is_internal_system_relative_path(relative) {
        log::warn!(
            "[vault] write binary failed: internal system path blocked -> {}",
            relative_path
        );
        return Err("禁止访问系统目录 .ofive 下的文件".to_string());
    }

    Ok(vault_root.join(relative))
}

/// 校验并解析 vault 内目标目录路径（支持空字符串表示 vault 根目录）。
pub fn resolve_vault_directory_path(
    vault_root: &Path,
    relative_directory_path: &str,
) -> Result<PathBuf, String> {
    let trimmed = relative_directory_path.trim();
    if trimmed.is_empty() {
        return Ok(vault_root.to_path_buf());
    }

    let relative = Path::new(trimmed);
    if relative.is_absolute() {
        log::warn!(
            "[vault] move markdown failed: absolute directory path blocked -> {}",
            relative_directory_path
        );
        return Err("target_directory_relative_path 必须是相对路径".to_string());
    }

    let has_parent_escape = relative
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir));
    if has_parent_escape {
        log::warn!(
            "[vault] move markdown failed: parent traversal blocked -> {}",
            relative_directory_path
        );
        return Err("禁止访问 vault 目录外的路径".to_string());
    }

    if is_internal_system_relative_path(relative) {
        log::warn!(
            "[vault] move markdown failed: internal system directory blocked -> {}",
            relative_directory_path
        );
        return Err("禁止访问系统目录 .ofive 下的路径".to_string());
    }

    Ok(vault_root.join(relative))
}

/// 解析并校验 vault 内已存在的普通文件路径（不限 Markdown）。
pub fn resolve_existing_vault_file_path(
    vault_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    if relative_path.trim().is_empty() {
        log::warn!("[vault] read binary failed: empty relative path");
        return Err("relative_path 不能为空".to_string());
    }

    let relative = Path::new(relative_path);
    if relative.is_absolute() {
        log::warn!(
            "[vault] read binary failed: absolute path blocked -> {}",
            relative_path
        );
        return Err("relative_path 必须是相对路径".to_string());
    }

    let has_parent_escape = relative
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir));
    if has_parent_escape {
        log::warn!(
            "[vault] read binary failed: parent traversal blocked -> {}",
            relative_path
        );
        return Err("禁止访问 vault 目录外的文件".to_string());
    }

    if is_internal_system_relative_path(relative) {
        log::warn!(
            "[vault] read binary failed: internal system path blocked -> {}",
            relative_path
        );
        return Err("禁止访问系统目录 .ofive 下的文件".to_string());
    }

    let raw_path = vault_root.join(relative);
    let canonical_vault_root = vault_root
        .canonicalize()
        .map_err(|error| format!("解析 vault 根目录失败 {}: {error}", vault_root.display()))?;
    let canonical = raw_path
        .canonicalize()
        .map_err(|error| format!("读取目标文件路径失败: {error}"))?;

    if !canonical.starts_with(&canonical_vault_root) {
        log::warn!(
            "[vault] read binary failed: path traversal blocked -> {}",
            relative_path
        );
        return Err("禁止访问 vault 目录外的文件".to_string());
    }

    if !canonical.is_file() {
        log::warn!(
            "[vault] read binary failed: not file -> {}",
            canonical.display()
        );
        return Err("目标路径不是文件".to_string());
    }

    Ok(canonical)
}

/// 根据文件扩展名推断 MIME 类型。
pub fn detect_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| item.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

/// 判断路径是否为受支持的图片文件。
pub fn is_supported_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|item| item.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .is_some_and(|ext| {
            SUPPORTED_IMAGE_EXTENSIONS
                .iter()
                .any(|candidate| candidate == &ext)
        })
}

/// 为路径补全图片扩展名候选。
pub fn with_supported_image_extension_candidates(path: &Path) -> Vec<PathBuf> {
    if is_supported_image_file(path) {
        return vec![path.to_path_buf()];
    }

    SUPPORTED_IMAGE_EXTENSIONS
        .iter()
        .map(|ext| path.with_extension(ext))
        .collect::<Vec<_>>()
}

/// 判断路径是否为 Markdown 文件。
pub fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|item| item.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
}

/// 为路径补全 Markdown 扩展名候选。
pub fn with_markdown_extension_candidates(path: &Path) -> Vec<PathBuf> {
    if is_markdown_file(path) {
        return vec![path.to_path_buf()];
    }

    let mut candidates = Vec::with_capacity(2);
    candidates.push(path.with_extension("md"));
    candidates.push(path.with_extension("markdown"));
    candidates
}

/// 将 vault 内绝对路径转换为相对路径。
pub fn relative_path_from_vault_root(
    vault_root: &Path,
    absolute_path: &Path,
) -> Result<String, String> {
    let canonical_vault_root = vault_root
        .canonicalize()
        .map_err(|error| format!("解析 vault 根目录失败 {}: {error}", vault_root.display()))?;
    let canonical_absolute_path = absolute_path
        .canonicalize()
        .map_err(|error| format!("解析目标路径失败 {}: {error}", absolute_path.display()))?;

    canonical_absolute_path
        .strip_prefix(&canonical_vault_root)
        .map_err(|error| {
            format!(
                "计算相对路径失败 {}: {error}",
                canonical_absolute_path.display()
            )
        })
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

/// 从目录中递归收集指定文件名（不含后缀）候选 Markdown 文件。
pub fn collect_markdown_candidates_by_stem(
    root: &Path,
    expected_stem: &str,
    output: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let expected_stem_lower = expected_stem.to_lowercase();
    let read_dir =
        fs::read_dir(root).map_err(|error| format!("读取目录失败 {}: {error}", root.display()))?;

    for entry in read_dir {
        let entry = entry.map_err(|error| format!("读取目录项失败: {error}"))?;
        let path = entry.path();
        if is_internal_system_path_under_base(&path, root) {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|error| format!("读取元数据失败 {}: {error}", path.display()))?;

        if metadata.is_dir() {
            collect_markdown_candidates_by_stem(&path, expected_stem, output)?;
            continue;
        }

        if !metadata.is_file() || !is_markdown_file(&path) {
            continue;
        }

        if path
            .file_stem()
            .and_then(|item| item.to_str())
            .is_some_and(|stem| stem.to_lowercase() == expected_stem_lower)
        {
            output.push(path);
        }
    }

    Ok(())
}

/// 从目录中递归收集指定文件名（不含后缀）候选图片文件。
pub fn collect_image_candidates_by_stem(
    root: &Path,
    expected_stem: &str,
    output: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let expected_stem_lower = expected_stem.to_lowercase();
    let read_dir =
        fs::read_dir(root).map_err(|error| format!("读取目录失败 {}: {error}", root.display()))?;

    for entry in read_dir {
        let entry = entry.map_err(|error| format!("读取目录项失败: {error}"))?;
        let path = entry.path();
        if is_internal_system_path_under_base(&path, root) {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|error| format!("读取元数据失败 {}: {error}", path.display()))?;

        if metadata.is_dir() {
            collect_image_candidates_by_stem(&path, expected_stem, output)?;
            continue;
        }

        if !metadata.is_file() || !is_supported_image_file(&path) {
            continue;
        }

        let stem = path
            .file_stem()
            .and_then(|item| item.to_str())
            .map(|item| item.trim())
            .unwrap_or("");

        if stem.to_lowercase() == expected_stem_lower {
            output.push(path);
        }
    }

    Ok(())
}
