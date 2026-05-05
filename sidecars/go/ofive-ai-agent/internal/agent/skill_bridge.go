package agentruntime

import (
	"context"
	"embed"
	"fmt"
	"io/fs"

	"google.golang.org/adk/tool"
	"google.golang.org/adk/tool/skilltoolset"
	"google.golang.org/adk/tool/skilltoolset/skill"
)

const (
	ofiveSkillToolsetName = "ofive-skills"
	ofiveSkillInstruction = `You can use specialized ofive skills to route local managed tools and external MCP tools.

1. If a skill seems relevant to the current user query, you MUST use the load_skill tool with skill_name="<SKILL_NAME>" before you continue.
2. Use managed-capability-routing for local vault reads, searches, patches, canvas updates, and confirmation-aware write sequencing.
3. Use mcp-tool-routing when a task involves external integrations or mixes external MCP tools with ofive's local managed capabilities.
4. The load_skill_resource tool is only for files inside a loaded skill.`
)

//go:embed skills/**
var embeddedSkillFiles embed.FS

// buildSkillToolsets loads the sidecar's embedded ADK skills into one toolset.
func buildSkillToolsets(ctx context.Context) ([]tool.Toolset, error) {
	skillFilesystem, err := fs.Sub(embeddedSkillFiles, "skills")
	if err != nil {
		return nil, fmt.Errorf("open embedded skills: %w", err)
	}

	source := skill.NewFileSystemSource(skillFilesystem)
	source, _, err = skill.WithCompletePreloadSource(ctx, source)
	if err != nil {
		return nil, fmt.Errorf("preload embedded skills: %w", err)
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
