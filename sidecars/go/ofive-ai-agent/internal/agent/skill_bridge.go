package agentruntime

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"strings"
	"testing/fstest"

	"google.golang.org/adk/tool"
	"google.golang.org/adk/tool/skilltoolset"
	"google.golang.org/adk/tool/skilltoolset/skill"
)

const (
	ofiveSkillToolsetName = "ofive-skills"
	ofiveSkillInstruction = `You can use specialized ofive skills to route local managed tools and external MCP tools.

1. If a skill seems relevant to the current user query, you MUST use the load_skill tool with name="<SKILL_NAME>" before you continue.
2. Use managed-capability-routing for local vault reads, searches, patches, canvas updates, and confirmation-aware write sequencing.
3. Use mcp-tool-routing when a task involves external integrations or mixes external MCP tools with ofive's local managed capabilities.
4. User-created skills from the current vault are available alongside the built-in routing skills.
5. The load_skill_resource tool is only for files inside a loaded skill.`
)

//go:embed skills/*/SKILL.md
var embeddedSkillFiles embed.FS

// buildSkillToolsets loads embedded and per-vault ADK skills into one toolset.
func buildSkillToolsets(
	ctx context.Context,
	agentSkillFiles []AgentSkillFile,
) ([]tool.Toolset, error) {
	skillFilesystem, err := fs.Sub(embeddedSkillFiles, "skills")
	if err != nil {
		return nil, fmt.Errorf("open embedded skills: %w", err)
	}

	sources := []skill.Source{skill.NewFileSystemSource(skillFilesystem)}
	if len(agentSkillFiles) > 0 {
		sources = append(sources, skill.NewFileSystemSource(buildAgentSkillMemoryFS(agentSkillFiles)))
	}

	source := skill.NewMergedSource(sources...)
	source, _, err = skill.WithCompletePreloadSource(ctx, source)
	if err != nil {
		return nil, fmt.Errorf("preload skills: %w", err)
	}

	toolset, err := skilltoolset.New(ctx, skilltoolset.Config{
		Name:              ofiveSkillToolsetName,
		Source:            source,
		SystemInstruction: ofiveSkillInstruction,
	})
	if err != nil {
		return nil, fmt.Errorf("create skill toolset: %w", err)
	}

	return []tool.Toolset{toolset}, nil
}

func buildAgentSkillMemoryFS(files []AgentSkillFile) fstest.MapFS {
	filesystem := fstest.MapFS{}
	seen := map[string]struct{}{}
	for _, file := range files {
		skillName := strings.TrimSpace(file.SkillName)
		relativePath := strings.Trim(strings.ReplaceAll(file.RelativePath, "\\", "/"), "/")
		if !isValidAgentSkillName(skillName) || !isValidAgentSkillResourcePath(relativePath) {
			continue
		}
		fullPath := skillName + "/" + relativePath
		if _, ok := seen[fullPath]; ok {
			continue
		}
		seen[fullPath] = struct{}{}
		filesystem[fullPath] = &fstest.MapFile{
			Data: []byte(file.Content),
			Mode: 0o644,
		}
	}
	return filesystem
}

func isValidAgentSkillName(name string) bool {
	if len(name) < 1 || len(name) > 64 {
		return false
	}
	if strings.HasPrefix(name, "-") || strings.HasSuffix(name, "-") || strings.Contains(name, "--") {
		return false
	}
	for _, ch := range name {
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '-' {
			continue
		}
		return false
	}
	return true
}

func isValidAgentSkillResourcePath(path string) bool {
	if path == "" || strings.HasPrefix(path, "/") {
		return false
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	if path == "SKILL.md" {
		return true
	}
	switch strings.SplitN(path, "/", 2)[0] {
	case "references", "assets", "scripts":
		return strings.HasSuffix(path, ".md") || strings.HasSuffix(path, ".markdown")
	default:
		return false
	}
}
