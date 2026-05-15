//! # Agent Skill App Service
//!
//! 管理当前 vault 中给 AI Agent 使用的用户自定义 SKILL。
//! 存储位置固定为 `.ofive/skills/<skill-name>/`，一个目录对应一个 SKILL。

use serde::Deserialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::shared::vault_contracts::{
    AgentSkillFileEntry, AgentSkillSidecarFile, AgentSkillSummary, ReadAgentSkillFileResponse,
    WriteAgentSkillFileResponse,
};

const AGENT_SKILLS_ROOT_RELATIVE_PATH: &str = ".ofive/skills";
const SKILL_FILE_NAME: &str = "SKILL.md";
const MAX_SIDE_CAR_SKILL_FILE_BYTES: u64 = 256 * 1024;

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
struct SkillFrontmatter {
    name: String,
    description: String,
    license: Option<String>,
    compatibility: Option<String>,
    metadata: Option<BTreeMap<String, String>>,
    allowed_tools: Option<Vec<String>>,
}

fn skills_root(vault_root: &Path) -> PathBuf {
    vault_root.join(AGENT_SKILLS_ROOT_RELATIVE_PATH)
}

fn is_valid_skill_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return false;
    }
    if trimmed.starts_with('-') || trimmed.ends_with('-') || trimmed.contains("--") {
        return false;
    }
    trimmed
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

fn normalize_skill_name(name: &str) -> Result<String, String> {
    let normalized = name.trim().to_string();
    if !is_valid_skill_name(&normalized) {
        return Err(
            "skillName 只能包含小写字母、数字和连字符，长度 1-64，且不能以连字符开头或结尾"
                .to_string(),
        );
    }
    Ok(normalized)
}

fn normalize_skill_file_relative_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err("relativePath 不能为空".to_string());
    }
    if trimmed.starts_with('/') {
        return Err("relativePath 必须是相对路径".to_string());
    }

    let candidate = Path::new(&trimmed);
    if candidate.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("禁止访问 skill 目录外的文件".to_string());
    }

    let first_segment = trimmed.split('/').next().unwrap_or("");
    let allowed = trimmed == SKILL_FILE_NAME
        || first_segment == "references"
        || first_segment == "assets"
        || first_segment == "scripts";
    if !allowed {
        return Err(
            "SKILL 参考文件必须是 SKILL.md，或位于 references/、assets/、scripts/ 目录下"
                .to_string(),
        );
    }

    if !(trimmed.ends_with(".md") || trimmed.ends_with(".markdown")) {
        return Err("当前仅支持管理 SKILL.md 和 Markdown 参考文件".to_string());
    }

    Ok(trimmed)
}

fn resolve_skill_directory(vault_root: &Path, skill_name: &str) -> Result<PathBuf, String> {
    let normalized_name = normalize_skill_name(skill_name)?;
    Ok(skills_root(vault_root).join(normalized_name))
}

fn resolve_skill_file_path(
    vault_root: &Path,
    skill_name: &str,
    relative_path: &str,
) -> Result<(String, String, PathBuf), String> {
    let normalized_name = normalize_skill_name(skill_name)?;
    let normalized_relative_path = normalize_skill_file_relative_path(relative_path)?;
    let directory = skills_root(vault_root).join(&normalized_name);
    let target = directory.join(&normalized_relative_path);
    Ok((normalized_name, normalized_relative_path, target))
}

fn extract_skill_frontmatter(content: &str) -> Result<SkillFrontmatter, String> {
    let normalized = content.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next() != Some("---") {
        return Err("SKILL.md 必须以 YAML frontmatter 开头".to_string());
    }

    let mut yaml_lines = Vec::new();
    for line in lines {
        if line == "---" {
            let fm = serde_yaml::from_str::<SkillFrontmatter>(&yaml_lines.join("\n"))
                .map_err(|error| format!("SKILL.md frontmatter 必须符合 ADK schema: {error}"))?;
            if !is_valid_skill_name(&fm.name) {
                return Err("SKILL.md frontmatter name 不符合 skill 命名规则".to_string());
            }
            let description = fm.description.trim();
            if description.is_empty() || description.len() > 1024 {
                return Err("SKILL.md frontmatter description 长度必须为 1-1024".to_string());
            }
            if fm
                .compatibility
                .as_ref()
                .is_some_and(|value| value.len() > 500)
            {
                return Err("SKILL.md frontmatter compatibility 长度不能超过 500".to_string());
            }
            return Ok(SkillFrontmatter {
                name: fm.name,
                description: description.to_string(),
                license: fm.license,
                compatibility: fm.compatibility,
                metadata: fm.metadata,
                allowed_tools: fm.allowed_tools,
            });
        }
        yaml_lines.push(line);
    }

    Err("SKILL.md 缺少结束 frontmatter 分隔符".to_string())
}

fn default_skill_content(skill_name: &str, description: &str) -> String {
    format!(
        "---\nname: {skill_name}\ndescription: {description}\n---\n# {skill_name}\n\nUse this skill when {description}\n\n## Instructions\n1. Describe the concrete workflow this agent should follow.\n2. List required context files or references under `references/` when useful.\n3. Keep the skill focused on one repeatable job.\n"
    )
}

fn collect_skill_files(skill_dir: &Path) -> Result<Vec<AgentSkillFileEntry>, String> {
    let mut files = Vec::new();
    if !skill_dir.exists() {
        return Ok(files);
    }

    for allowed_dir in ["references", "assets", "scripts"] {
        let root = skill_dir.join(allowed_dir);
        if !root.exists() {
            continue;
        }
        collect_markdown_files_under(skill_dir, &root, &mut files)?;
    }

    let skill_file_path = skill_dir.join(SKILL_FILE_NAME);
    if skill_file_path.is_file() {
        let metadata = fs::metadata(&skill_file_path)
            .map_err(|error| format!("读取 SKILL.md 元数据失败: {error}"))?;
        files.push(AgentSkillFileEntry {
            relative_path: SKILL_FILE_NAME.to_string(),
            size_bytes: metadata.len(),
        });
    }

    files.sort_by(|left, right| {
        if left.relative_path == SKILL_FILE_NAME {
            return std::cmp::Ordering::Less;
        }
        if right.relative_path == SKILL_FILE_NAME {
            return std::cmp::Ordering::Greater;
        }
        left.relative_path.cmp(&right.relative_path)
    });
    Ok(files)
}

fn collect_markdown_files_under(
    skill_dir: &Path,
    root: &Path,
    output: &mut Vec<AgentSkillFileEntry>,
) -> Result<(), String> {
    let entries = fs::read_dir(root)
        .map_err(|error| format!("读取 SKILL 资源目录失败 {}: {error}", root.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 SKILL 资源目录项失败: {error}"))?;
        let path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|error| format!("读取 SKILL 文件元数据失败 {}: {error}", path.display()))?;
        if metadata.is_dir() {
            collect_markdown_files_under(skill_dir, &path, output)?;
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let relative_path = path
            .strip_prefix(skill_dir)
            .map_err(|error| format!("计算 SKILL 文件相对路径失败 {}: {error}", path.display()))?
            .to_string_lossy()
            .replace('\\', "/");
        if !(relative_path.ends_with(".md") || relative_path.ends_with(".markdown")) {
            continue;
        }
        output.push(AgentSkillFileEntry {
            relative_path,
            size_bytes: metadata.len(),
        });
    }
    Ok(())
}

fn build_skill_summary(skill_dir: &Path) -> Result<AgentSkillSummary, String> {
    let name = skill_dir
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    let directory_relative_path = format!("{AGENT_SKILLS_ROOT_RELATIVE_PATH}/{name}");
    let files = collect_skill_files(skill_dir)?;

    let skill_file_path = skill_dir.join(SKILL_FILE_NAME);
    let content = fs::read_to_string(&skill_file_path);
    let (description, valid, error) = match content {
        Ok(value) => match extract_skill_frontmatter(&value) {
            Ok(frontmatter) if frontmatter.name == name => (frontmatter.description, true, None),
            Ok(frontmatter) => (
                frontmatter.description,
                false,
                Some(format!(
                    "SKILL.md name={} 与目录名 {} 不一致",
                    frontmatter.name, name
                )),
            ),
            Err(message) => (String::new(), false, Some(message)),
        },
        Err(error) => (
            String::new(),
            false,
            Some(format!("读取 SKILL.md 失败: {error}")),
        ),
    };

    Ok(AgentSkillSummary {
        name,
        description,
        directory_relative_path,
        files,
        valid,
        error,
    })
}

/// 列出当前 vault 的全部 Agent SKILL。
pub(crate) fn list_agent_skills_in_root(
    vault_root: &Path,
) -> Result<Vec<AgentSkillSummary>, String> {
    let root = skills_root(vault_root);
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut skills = Vec::new();
    for entry in fs::read_dir(&root)
        .map_err(|error| format!("读取 Agent SKILL 根目录失败 {}: {error}", root.display()))?
    {
        let entry = entry.map_err(|error| format!("读取 Agent SKILL 目录项失败: {error}"))?;
        let path = entry.path();
        if !entry
            .metadata()
            .map_err(|error| {
                format!(
                    "读取 Agent SKILL 目录元数据失败 {}: {error}",
                    path.display()
                )
            })?
            .is_dir()
        {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !is_valid_skill_name(name) {
            continue;
        }
        skills.push(build_skill_summary(&path)?);
    }
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(skills)
}

/// 创建一个 Agent SKILL 目录和初始 SKILL.md。
pub(crate) fn create_agent_skill_in_root(
    vault_root: &Path,
    skill_name: String,
    description: String,
) -> Result<AgentSkillSummary, String> {
    let skill_name = normalize_skill_name(&skill_name)?;
    let description = description.trim().to_string();
    if description.is_empty() || description.len() > 1024 {
        return Err("description 长度必须为 1-1024".to_string());
    }

    let directory = resolve_skill_directory(vault_root, &skill_name)?;
    if directory.exists() {
        return Err("SKILL 目录已存在".to_string());
    }
    fs::create_dir_all(&directory)
        .map_err(|error| format!("创建 SKILL 目录失败 {}: {error}", directory.display()))?;
    fs::create_dir_all(directory.join("references"))
        .map_err(|error| format!("创建 SKILL references 目录失败: {error}"))?;

    let content = default_skill_content(&skill_name, &description);
    fs::write(directory.join(SKILL_FILE_NAME), content.as_bytes())
        .map_err(|error| format!("写入 SKILL.md 失败: {error}"))?;

    build_skill_summary(&directory)
}

/// 读取一个 Agent SKILL 文件。
pub(crate) fn read_agent_skill_file_in_root(
    vault_root: &Path,
    skill_name: String,
    relative_path: String,
) -> Result<ReadAgentSkillFileResponse, String> {
    let (skill_name, relative_path, target_path) =
        resolve_skill_file_path(vault_root, &skill_name, &relative_path)?;
    if !target_path.is_file() {
        return Err("目标 SKILL 文件不存在".to_string());
    }
    let content = fs::read_to_string(&target_path)
        .map_err(|error| format!("读取 SKILL 文件失败 {}: {error}", target_path.display()))?;
    Ok(ReadAgentSkillFileResponse {
        skill_name,
        relative_path,
        content,
    })
}

/// 写入一个 Agent SKILL 文件。
pub(crate) fn write_agent_skill_file_in_root(
    vault_root: &Path,
    skill_name: String,
    relative_path: String,
    content: String,
) -> Result<WriteAgentSkillFileResponse, String> {
    let (skill_name, relative_path, target_path) =
        resolve_skill_file_path(vault_root, &skill_name, &relative_path)?;
    if relative_path == SKILL_FILE_NAME {
        let frontmatter = extract_skill_frontmatter(&content)?;
        if frontmatter.name != skill_name {
            return Err(format!(
                "SKILL.md frontmatter name={} 必须与目录名 {} 一致",
                frontmatter.name, skill_name
            ));
        }
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 SKILL 文件父目录失败 {}: {error}", parent.display()))?;
    }
    let created = !target_path.exists();
    fs::write(&target_path, content.as_bytes())
        .map_err(|error| format!("写入 SKILL 文件失败 {}: {error}", target_path.display()))?;

    Ok(WriteAgentSkillFileResponse {
        skill_name,
        relative_path,
        created,
    })
}

/// 收集传递给 Go sidecar 的有效 Agent SKILL 文件。
pub(crate) fn collect_agent_skill_sidecar_files_in_root(
    vault_root: &Path,
) -> Result<Vec<AgentSkillSidecarFile>, String> {
    let summaries = list_agent_skills_in_root(vault_root)?;
    let mut files = Vec::new();
    for summary in summaries.into_iter().filter(|item| item.valid) {
        for file in summary.files {
            if file.size_bytes > MAX_SIDE_CAR_SKILL_FILE_BYTES {
                continue;
            }
            let read = read_agent_skill_file_in_root(
                vault_root,
                summary.name.clone(),
                file.relative_path,
            )?;
            files.push(AgentSkillSidecarFile {
                skill_name: read.skill_name,
                relative_path: read.relative_path,
                content: read.content,
            });
        }
    }
    files.sort_by(|left, right| {
        left.skill_name
            .cmp(&right.skill_name)
            .then(left.relative_path.cmp(&right.relative_path))
    });
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("ofive-agent-skill-test-{unique}-{sequence}"));
        fs::create_dir_all(&root).expect("应成功创建测试根目录");
        root
    }

    #[test]
    fn create_and_collect_sidecar_files_should_include_skill_and_reference() {
        let root = create_test_root();
        create_agent_skill_in_root(
            &root,
            "research-helper".to_string(),
            "research local notes".to_string(),
        )
        .expect("应成功创建 skill");
        write_agent_skill_file_in_root(
            &root,
            "research-helper".to_string(),
            "references/context.md".to_string(),
            "# Context\n".to_string(),
        )
        .expect("应成功写入参考文件");

        let files =
            collect_agent_skill_sidecar_files_in_root(&root).expect("应成功收集 sidecar 文件");

        assert!(files.iter().any(|item| {
            item.skill_name == "research-helper" && item.relative_path == SKILL_FILE_NAME
        }));
        assert!(files.iter().any(|item| {
            item.skill_name == "research-helper" && item.relative_path == "references/context.md"
        }));
    }

    #[test]
    fn write_skill_md_should_reject_frontmatter_name_mismatch() {
        let root = create_test_root();
        create_agent_skill_in_root(
            &root,
            "research-helper".to_string(),
            "research local notes".to_string(),
        )
        .expect("应成功创建 skill");

        let error = write_agent_skill_file_in_root(
            &root,
            "research-helper".to_string(),
            SKILL_FILE_NAME.to_string(),
            "---\nname: wrong-name\ndescription: wrong\n---\n# Wrong\n".to_string(),
        )
        .expect_err("frontmatter name 不一致应失败");

        assert!(error.contains("必须与目录名"));
    }

    #[test]
    fn write_skill_md_should_reject_unknown_adk_frontmatter_fields() {
        let root = create_test_root();
        create_agent_skill_in_root(
            &root,
            "research-helper".to_string(),
            "research local notes".to_string(),
        )
        .expect("应成功创建 skill");

        let error = write_agent_skill_file_in_root(
            &root,
            "research-helper".to_string(),
            SKILL_FILE_NAME.to_string(),
            "---\nname: research-helper\ndescription: research local notes\ntype: skill\nversion: 1.0\n---\n# Research\n".to_string(),
        )
        .expect_err("ADK 不支持的 frontmatter 字段应失败");

        assert!(error.contains("ADK schema"));
        assert!(error.contains("type") || error.contains("version"));
    }

    #[test]
    fn write_skill_md_should_accept_adk_optional_frontmatter_fields() {
        let root = create_test_root();
        create_agent_skill_in_root(
            &root,
            "research-helper".to_string(),
            "research local notes".to_string(),
        )
        .expect("应成功创建 skill");

        write_agent_skill_file_in_root(
            &root,
            "research-helper".to_string(),
            SKILL_FILE_NAME.to_string(),
            "---\nname: research-helper\ndescription: research local notes\nlicense: MIT\ncompatibility: ofive\nmetadata:\n  version: \"1.0\"\nallowed-tools:\n  - agent_skill.read_file\n---\n# Research\n".to_string(),
        )
        .expect("ADK 支持的可选 frontmatter 字段应通过");
    }

    #[test]
    fn collect_agent_skill_sidecar_files_should_skip_unknown_adk_frontmatter_fields() {
        let root = create_test_root();
        let skill_dir = skills_root(&root).join("legacy-helper");
        fs::create_dir_all(&skill_dir).expect("应成功创建 legacy skill 目录");
        fs::write(
            skill_dir.join(SKILL_FILE_NAME),
            "---\nname: legacy-helper\ndescription: old shape\ntype: skill\nversion: 1.0\n---\n# Legacy\n",
        )
        .expect("应成功写入 legacy SKILL.md");

        let summaries = list_agent_skills_in_root(&root).expect("应成功列出 skill");
        let summary = summaries
            .iter()
            .find(|item| item.name == "legacy-helper")
            .expect("应包含 legacy skill 摘要");
        assert!(!summary.valid);
        assert!(summary
            .error
            .as_deref()
            .unwrap_or("")
            .contains("ADK schema"));

        let files =
            collect_agent_skill_sidecar_files_in_root(&root).expect("应成功收集 sidecar 文件");
        assert!(files.is_empty());
    }

    #[test]
    fn read_skill_file_should_reject_path_escape() {
        let root = create_test_root();
        let error = read_agent_skill_file_in_root(
            &root,
            "research-helper".to_string(),
            "../secret.md".to_string(),
        )
        .expect_err("路径逃逸应失败");

        assert!(error.contains("禁止访问 skill 目录外"));
    }
}
