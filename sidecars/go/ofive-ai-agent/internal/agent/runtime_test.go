package agentruntime

import (
	"testing"

	"google.golang.org/adk/tool/toolconfirmation"
	"google.golang.org/genai"
)

func TestCanUseCapabilityPlanningDisabledForMCP(t *testing.T) {
	t.Parallel()

	if canUseCapabilityPlanning(CapabilityBridgeConfig{
		MCPServerURL: "http://127.0.0.1:57874/mcp",
		MCPAuthToken: "test-token",
		Tools: []ToolDescriptor{{
			CapabilityID: "vault.search_markdown_files",
			Name:         "vault_search_markdown_files",
		}},
	}) {
		t.Fatal("expected legacy capability planning to be disabled when MCP is configured")
	}
}

func TestCanUseCapabilityPlanningEnabledForLegacyCallback(t *testing.T) {
	t.Parallel()

	if !canUseCapabilityPlanning(CapabilityBridgeConfig{
		CallbackURL:   "http://127.0.0.1:9000/capabilities/call",
		CallbackToken: "test-token",
		Tools: []ToolDescriptor{{
			CapabilityID: "vault.read_markdown_file",
			Name:         "vault_read_markdown_file",
		}},
	}) {
		t.Fatal("expected legacy capability planning to remain enabled for callback bridge")
	}
}

func TestExtractPendingToolConfirmationReturnsOriginalToolDetails(t *testing.T) {
	t.Parallel()

	confirmation := extractPendingToolConfirmation(&genai.Content{
		Role: genai.RoleModel,
		Parts: []*genai.Part{{
			FunctionCall: &genai.FunctionCall{
				ID:   "confirm-1",
				Name: toolconfirmation.FunctionCallName,
				Args: map[string]any{
					"toolConfirmation": map[string]any{"hint": "Please confirm this write."},
					"originalFunctionCall": map[string]any{
						"name": "vault.create_markdown_file",
						"args": map[string]any{
							"relativePath": "Notes/New.md",
							"content": "# New",
						},
					},
				},
			},
		}},
	})

	if confirmation == nil {
		t.Fatal("expected pending confirmation to be extracted")
	}
	if confirmation.ID != "confirm-1" {
		t.Fatalf("unexpected confirmation id: %s", confirmation.ID)
	}
	if confirmation.ToolName != "vault.create_markdown_file" {
		t.Fatalf("unexpected tool name: %s", confirmation.ToolName)
	}
	if confirmation.Hint != "Please confirm this write." {
		t.Fatalf("unexpected hint: %s", confirmation.Hint)
	}
	if confirmation.ToolArgsJSON == "" || confirmation.ToolArgsJSON == "{}" {
		t.Fatalf("expected marshaled tool args, got %q", confirmation.ToolArgsJSON)
	}
}