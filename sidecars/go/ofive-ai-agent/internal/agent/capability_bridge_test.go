package agentruntime

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestTryHandleExplicitCapabilityCommandCallsRustCallback(t *testing.T) {
	t.Parallel()

	var capturedCapabilityID string
	var capturedToken string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()

		capturedToken = request.Header.Get("X-Ofive-Sidecar-Token")
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}

		var payload struct {
			CapabilityID string `json:"capabilityId"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		capturedCapabilityID = payload.CapabilityID

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"schemaVersion":"2026-03-17","capabilityId":"vault.read_markdown_file","success":true,"output":{"relativePath":"Notes/A.md","content":"# A"},"error":""}`))
	}))
	defer server.Close()

	responseText, agentName, handled, err := tryHandleExplicitCapabilityCommand(
		context.Background(),
		`tool vault.read_markdown_file {"relativePath":"Notes/A.md"}`,
		CapabilityBridgeConfig{
			CallbackURL:   server.URL,
			CallbackToken: "test-token",
			Tools: []ToolDescriptor{
				{
					CapabilityID: "vault.read_markdown_file",
					Name:         "vault_read_markdown_file",
				},
			},
		},
	)
	if err != nil {
		t.Fatalf("tryHandleExplicitCapabilityCommand returned error: %v", err)
	}
	if !handled {
		t.Fatalf("expected command to be handled")
	}
	if agentName != capabilityBridgeAgentName {
		t.Fatalf("unexpected agent name: %s", agentName)
	}
	if capturedCapabilityID != "vault.read_markdown_file" {
		t.Fatalf("unexpected capability id: %s", capturedCapabilityID)
	}
	if capturedToken != "test-token" {
		t.Fatalf("unexpected callback token: %s", capturedToken)
	}
	if !strings.Contains(responseText, "[tool:vault.read_markdown_file]") {
		t.Fatalf("unexpected response text: %s", responseText)
	}
}

func TestTryHandleExplicitCapabilityCommandRejectsConfirmationRequiredTool(t *testing.T) {
	t.Parallel()

	_, _, handled, err := tryHandleExplicitCapabilityCommand(
		context.Background(),
		`tool vault.create_markdown_file {"relativePath":"Notes/New.md"}`,
		CapabilityBridgeConfig{
			CallbackURL:   "http://127.0.0.1:9000/capabilities/call",
			CallbackToken: "test-token",
			Tools: []ToolDescriptor{{
				CapabilityID:         "vault.create_markdown_file",
				Name:                 "vault_create_markdown_file",
				RequiresConfirmation: true,
			}},
		},
	)
	if !handled {
		t.Fatal("expected explicit tool command to be handled")
	}
	if err == nil {
		t.Fatal("expected confirmation-required tool command to be rejected")
	}
	if !strings.Contains(err.Error(), "requires confirmation") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestExecuteCapabilityPlanningLoopHandlesToolBlockAndReturnsFinalAnswer(t *testing.T) {
	t.Parallel()

	var callCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		callCount.Add(1)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"schemaVersion":"2026-03-17","capabilityId":"vault.read_markdown_file","success":true,"output":{"relativePath":"Notes/A.md","content":"# A"},"error":""}`))
	}))
	defer server.Close()

	responses := []string{
		"<OFIVE_TOOL_CALL>\n{\"capabilityId\":\"vault.read_markdown_file\",\"input\":{\"relativePath\":\"Notes/A.md\"}}\n</OFIVE_TOOL_CALL>",
		"已读取文件，标题是 A。",
	}
	responseIndex := 0

	finalText, err := executeCapabilityPlanningLoop(
		context.Background(),
		"请读取 Notes/A.md",
		CapabilityBridgeConfig{
			CallbackURL:   server.URL,
			CallbackToken: "test-token",
			Tools: []ToolDescriptor{{
				CapabilityID: "vault.read_markdown_file",
				Name:         "vault_read_markdown_file",
			}},
		},
		func(_ context.Context, prompt string) (string, error) {
			if responseIndex == 0 && !strings.Contains(prompt, "请读取 Notes/A.md") {
				t.Fatalf("unexpected initial prompt: %s", prompt)
			}
			if responseIndex == 1 && !strings.Contains(prompt, "Tool result JSON:") {
				t.Fatalf("expected tool result prompt, got: %s", prompt)
			}

			response := responses[responseIndex]
			responseIndex++
			return response, nil
		},
	)
	if err != nil {
		t.Fatalf("executeCapabilityPlanningLoop returned error: %v", err)
	}
	if finalText != "已读取文件，标题是 A。" {
		t.Fatalf("unexpected final text: %s", finalText)
	}
	if callCount.Load() != 1 {
		t.Fatalf("expected exactly one capability call, got %d", callCount.Load())
	}
}

func TestExtractPlannedCapabilityCallSupportsCapabilityAlias(t *testing.T) {
	t.Parallel()

	call, handled, err := extractPlannedCapabilityCall(
		"prefix\n<OFIVE_TOOL_CALL>{\"capability\":\"vault.read_markdown_file\",\"input\":{\"relativePath\":\"Notes/A.md\"}}</OFIVE_TOOL_CALL>",
	)
	if err != nil {
		t.Fatalf("extractPlannedCapabilityCall returned error: %v", err)
	}
	if !handled {
		t.Fatalf("expected planned tool call to be detected")
	}
	if call.Capability != "vault.read_markdown_file" {
		t.Fatalf("unexpected capability alias: %s", call.Capability)
	}
}
