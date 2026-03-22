package agentruntime

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTryHandleExplicitMockConfirmationCommandPersistsAndReturnsChunkData(t *testing.T) {
	t.Parallel()

	var capturedRequest map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()

		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if err := json.Unmarshal(body, &capturedRequest); err != nil {
			t.Fatalf("decode request body: %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"status":"ok","owner":"ai-chat","stateKey":"mock","items":[]}`))
	}))
	defer server.Close()

	confirmation, responseText, handled, err := tryHandleExplicitMockConfirmationCommand(
		context.Background(),
		"session-1",
		`confirmtool {"confirmationId":"confirm-1","toolName":"vault.create_markdown_file","toolArgs":{"relativePath":"Notes/New.md"},"hint":"Please confirm this write.","responseText":"Pending create file"}`,
		CapabilityBridgeConfig{
			PersistenceCallbackURL:   server.URL,
			PersistenceCallbackToken: "test-token",
		},
	)
	if err != nil {
		t.Fatalf("tryHandleExplicitMockConfirmationCommand returned error: %v", err)
	}
	if !handled {
		t.Fatal("expected command to be handled")
	}
	if confirmation == nil {
		t.Fatal("expected confirmation payload")
	}
	if confirmation.ID != "confirm-1" {
		t.Fatalf("unexpected confirmation id: %s", confirmation.ID)
	}
	if confirmation.ToolName != "vault.create_markdown_file" {
		t.Fatalf("unexpected tool name: %s", confirmation.ToolName)
	}
	if responseText != "Pending create file" {
		t.Fatalf("unexpected response text: %s", responseText)
	}
	if capturedRequest["action"] != "save" {
		t.Fatalf("expected save action, got %v", capturedRequest["action"])
	}
	if capturedRequest["traceId"] != "confirm-1" {
		t.Fatalf("expected trace id to mirror confirmation id, got %v", capturedRequest["traceId"])
	}
	if !strings.HasPrefix(capturedRequest["stateKey"].(string), "confirmation-") {
		t.Fatalf("unexpected state key: %v", capturedRequest["stateKey"])
	}
}

func TestStreamMockConfirmationResponseUsesPersistedToolDetails(t *testing.T) {
	t.Parallel()

	var chunks []StreamChunk
	err := streamMockConfirmationResponse(true, &persistedConfirmationState{
		ConfirmationID: "confirm-1",
		ToolName:       "vault.create_markdown_file",
		ToolArgsJSON:   "{\n  \"relativePath\": \"Notes/New.md\"\n}",
	}, func(chunk StreamChunk) error {
		chunks = append(chunks, chunk)
		return nil
	})
	if err != nil {
		t.Fatalf("streamMockConfirmationResponse returned error: %v", err)
	}
	if len(chunks) == 0 {
		t.Fatal("expected streamed chunks")
	}
	finalChunk := chunks[len(chunks)-1]
	if !finalChunk.Done {
		t.Fatal("expected final chunk to be done")
	}
	if !strings.Contains(finalChunk.AccumulatedText, "[confirmation:approved]") {
		t.Fatalf("unexpected accumulated text: %s", finalChunk.AccumulatedText)
	}
	if !strings.Contains(finalChunk.AccumulatedText, "vault.create_markdown_file") {
		t.Fatalf("unexpected accumulated text: %s", finalChunk.AccumulatedText)
	}
}
