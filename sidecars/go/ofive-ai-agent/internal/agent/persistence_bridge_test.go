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

func TestTryHandleExplicitPersistenceCommandCallsRustCallback(t *testing.T) {
	t.Parallel()

	var capturedToken string
	var capturedRequest map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()

		capturedToken = request.Header.Get("X-Ofive-Sidecar-Token")
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if err := json.Unmarshal(body, &capturedRequest); err != nil {
			t.Fatalf("decode request body: %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"status":"ok","owner":"ai-chat","stateKey":"history","schemaVersion":1,"revision":"rev-1","payload":{"messages":["hello"]},"items":[]}`))
	}))
	defer server.Close()

	responseText, agentName, handled, err := tryHandleExplicitPersistenceCommand(
		context.Background(),
		"session-1",
		`persist save {"stateKey":"history","schemaVersion":1,"payload":{"messages":["hello"]}}`,
		CapabilityBridgeConfig{
			PersistenceCallbackURL:   server.URL,
			PersistenceCallbackToken: "test-token",
		},
	)
	if err != nil {
		t.Fatalf("tryHandleExplicitPersistenceCommand returned error: %v", err)
	}
	if !handled {
		t.Fatalf("expected command to be handled")
	}
	if agentName != persistenceBridgeAgentName {
		t.Fatalf("unexpected agent name: %s", agentName)
	}
	if capturedToken != "test-token" {
		t.Fatalf("unexpected callback token: %s", capturedToken)
	}
	if capturedRequest["moduleId"] != sidecarModuleID {
		t.Fatalf("unexpected moduleId: %v", capturedRequest["moduleId"])
	}
	if capturedRequest["runtimeId"] != sidecarRuntimeID {
		t.Fatalf("unexpected runtimeId: %v", capturedRequest["runtimeId"])
	}
	if capturedRequest["action"] != "save" {
		t.Fatalf("unexpected action: %v", capturedRequest["action"])
	}
	if capturedRequest["stateKey"] != "history" {
		t.Fatalf("unexpected stateKey: %v", capturedRequest["stateKey"])
	}
	if !strings.Contains(responseText, "[persistence:save]") {
		t.Fatalf("unexpected response text: %s", responseText)
	}
	if !strings.Contains(responseText, `"status": "ok"`) {
		t.Fatalf("expected formatted persistence response, got: %s", responseText)
	}
}

func TestTryHandleExplicitPersistenceCommandRejectsMissingStateKey(t *testing.T) {
	t.Parallel()

	_, _, handled, err := tryHandleExplicitPersistenceCommand(
		context.Background(),
		"session-1",
		`persist load {"schemaVersion":1}`,
		CapabilityBridgeConfig{
			PersistenceCallbackURL:   "http://127.0.0.1:9001/persistence/state",
			PersistenceCallbackToken: "test-token",
		},
	)
	if !handled {
		t.Fatal("expected persistence command to be handled")
	}
	if err == nil {
		t.Fatal("expected missing stateKey to be rejected")
	}
	if !strings.Contains(err.Error(), "stateKey") {
		t.Fatalf("unexpected error: %v", err)
	}
}
