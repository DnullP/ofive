package agentruntime

import (
	"context"
	"testing"

	"google.golang.org/adk/session"
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
							"content":      "# New",
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

func TestSeedSessionHistoryAppendsUserAndAssistantEventsOnce(t *testing.T) {
	t.Parallel()

	runtime, err := New()
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}

	ctx := context.Background()
	if err := runtime.EnsureSession(ctx, "user-1", "session-1"); err != nil {
		t.Fatalf("EnsureSession returned error: %v", err)
	}

	history := []HistoryEntry{
		{Role: "user", Text: "第一句"},
		{Role: "assistant", Text: "第一句回答"},
	}
	if err := runtime.seedSessionHistory(ctx, "user-1", "session-1", history); err != nil {
		t.Fatalf("seedSessionHistory returned error: %v", err)
	}
	if err := runtime.seedSessionHistory(ctx, "user-1", "session-1", history); err != nil {
		t.Fatalf("second seedSessionHistory returned error: %v", err)
	}

	response, err := runtime.sessionService.Get(ctx, &session.GetRequest{
		AppName:   appName,
		UserID:    "user-1",
		SessionID: "session-1",
	})
	if err != nil {
		t.Fatalf("sessionService.Get returned error: %v", err)
	}
	if response.Session.Events().Len() != 2 {
		t.Fatalf("expected exactly two seeded events, got %d", response.Session.Events().Len())
	}
	if response.Session.Events().At(0).Author != "user" {
		t.Fatalf("unexpected first author: %s", response.Session.Events().At(0).Author)
	}
	if response.Session.Events().At(1).Author != agentName {
		t.Fatalf("unexpected second author: %s", response.Session.Events().At(1).Author)
	}
}
