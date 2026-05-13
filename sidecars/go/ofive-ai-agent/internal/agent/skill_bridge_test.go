package agentruntime

import (
	"context"
	"io"
	"testing"

	"google.golang.org/adk/tool/skilltoolset/skill"
)

func TestBuildAgentSkillMemoryFSSupportsADKFileSystemSource(t *testing.T) {
	t.Parallel()

	filesystem := buildAgentSkillMemoryFS([]AgentSkillFile{
		{
			SkillName:    "research-helper",
			RelativePath: "SKILL.md",
			Content:      "---\nname: research-helper\ndescription: Research local notes.\n---\n# Research\n",
		},
		{
			SkillName:    "research-helper",
			RelativePath: "references/context.md",
			Content:      "# Context\n",
		},
	})
	source := skill.NewFileSystemSource(filesystem)

	frontmatters, err := source.ListFrontmatters(context.Background())
	if err != nil {
		t.Fatalf("ListFrontmatters returned error: %v", err)
	}
	if len(frontmatters) != 1 || frontmatters[0].Name != "research-helper" {
		t.Fatalf("unexpected frontmatters: %+v", frontmatters)
	}

	resource, err := source.LoadResource(context.Background(), "research-helper", "references/context.md")
	if err != nil {
		t.Fatalf("LoadResource returned error: %v", err)
	}
	defer resource.Close()
	content, err := io.ReadAll(resource)
	if err != nil {
		t.Fatalf("read resource: %v", err)
	}
	if string(content) != "# Context\n" {
		t.Fatalf("unexpected resource content: %q", string(content))
	}
}

func TestBuildAgentSkillMemoryFSRejectsUnsafePaths(t *testing.T) {
	t.Parallel()

	filesystem := buildAgentSkillMemoryFS([]AgentSkillFile{
		{
			SkillName:    "research-helper",
			RelativePath: "../SKILL.md",
			Content:      "bad",
		},
		{
			SkillName:    "bad_name",
			RelativePath: "SKILL.md",
			Content:      "bad",
		},
	})

	if len(filesystem) != 0 {
		t.Fatalf("expected unsafe files to be rejected, got %#v", filesystem)
	}
}
