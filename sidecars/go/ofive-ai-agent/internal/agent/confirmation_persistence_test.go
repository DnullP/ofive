package agentruntime

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	sidecarpersistence "ofive/sidecars/go/ofive-ai-agent/internal/persistence"
)

func TestPendingConfirmationPersistenceRoundTrip(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	stored := map[string]any{}
	var actions []string
	var stateKeys []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()

		if got := request.Header.Get("X-Ofive-Sidecar-Token"); got != "test-token" {
			t.Fatalf("unexpected callback token: %s", got)
		}

		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}

		var persistenceRequest sidecarpersistence.Request
		if err := json.Unmarshal(body, &persistenceRequest); err != nil {
			t.Fatalf("decode request body: %v", err)
		}

		mu.Lock()
		actions = append(actions, string(persistenceRequest.Action))
		stateKeys = append(stateKeys, persistenceRequest.StateKey)
		mu.Unlock()

		writer.Header().Set("Content-Type", "application/json")
		switch persistenceRequest.Action {
		case sidecarpersistence.ActionSave:
			mu.Lock()
			stored[persistenceRequest.StateKey] = persistenceRequest.Payload
			mu.Unlock()
			_, _ = writer.Write([]byte(`{"status":"ok","owner":"ai-chat","stateKey":"history"}`))
		case sidecarpersistence.ActionLoad:
			mu.Lock()
			payload, ok := stored[persistenceRequest.StateKey]
			mu.Unlock()
			if !ok {
				_, _ = writer.Write([]byte(`{"status":"not_found","owner":"ai-chat","stateKey":"history"}`))
				return
			}
			responseBody, err := json.Marshal(map[string]any{
				"status":        "ok",
				"owner":         "ai-chat",
				"stateKey":      persistenceRequest.StateKey,
				"schemaVersion": 1,
				"payload":       payload,
			})
			if err != nil {
				t.Fatalf("marshal load response: %v", err)
			}
			_, _ = writer.Write(responseBody)
		case sidecarpersistence.ActionDelete:
			mu.Lock()
			delete(stored, persistenceRequest.StateKey)
			mu.Unlock()
			_, _ = writer.Write([]byte(`{"status":"ok","owner":"ai-chat","stateKey":"history"}`))
		default:
			t.Fatalf("unexpected action: %s", persistenceRequest.Action)
		}
	}))
	defer server.Close()

	config := CapabilityBridgeConfig{
		PersistenceCallbackURL:   server.URL,
		PersistenceCallbackToken: "test-token",
	}
	confirmation := pendingToolConfirmation{
		ID:           "confirm-1",
		Hint:         "Please confirm this write.",
		ToolName:     "vault.create_markdown_file",
		ToolArgsJSON: `{\n  "relativePath": "Notes/New.md"\n}`,
	}

	if err := savePendingConfirmation(context.Background(), "session-1", confirmation, config); err != nil {
		t.Fatalf("savePendingConfirmation returned error: %v", err)
	}

	state, persistenceEnabled, err := loadPersistedPendingConfirmation(
		context.Background(),
		"session-1",
		"confirm-1",
		config,
	)
	if err != nil {
		t.Fatalf("loadPersistedPendingConfirmation returned error: %v", err)
	}
	if !persistenceEnabled {
		t.Fatal("expected persistence to be enabled")
	}
	if state == nil {
		t.Fatal("expected persisted confirmation state")
	}
	if state.ToolName != confirmation.ToolName {
		t.Fatalf("unexpected tool name: %s", state.ToolName)
	}
	if state.ConfirmationID != confirmation.ID {
		t.Fatalf("unexpected confirmation id: %s", state.ConfirmationID)
	}

	if err := deletePersistedPendingConfirmation(
		context.Background(),
		"session-1",
		"confirm-1",
		config,
	); err != nil {
		t.Fatalf("deletePersistedPendingConfirmation returned error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(actions) != 3 {
		t.Fatalf("expected save/load/delete actions, got %v", actions)
	}
	for _, stateKey := range stateKeys {
		if !strings.HasPrefix(stateKey, "confirmation-") {
			t.Fatalf("unexpected state key: %s", stateKey)
		}
		if strings.Contains(stateKey, "confirm-1") {
			t.Fatalf("state key should be host-safe hash, got %s", stateKey)
		}
	}
	if len(stored) != 0 {
		t.Fatalf("expected stored state to be empty after delete, got %d entries", len(stored))
	}
}

func TestLoadPersistedPendingConfirmationReturnsNilForNotFound(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"status":"not_found","owner":"ai-chat","stateKey":"history"}`))
	}))
	defer server.Close()

	state, persistenceEnabled, err := loadPersistedPendingConfirmation(
		context.Background(),
		"session-1",
		"confirm-1",
		CapabilityBridgeConfig{
			PersistenceCallbackURL:   server.URL,
			PersistenceCallbackToken: "test-token",
		},
	)
	if err != nil {
		t.Fatalf("loadPersistedPendingConfirmation returned error: %v", err)
	}
	if !persistenceEnabled {
		t.Fatal("expected persistence to be enabled")
	}
	if state != nil {
		t.Fatal("expected nil persisted state for not_found")
	}
}

func TestStreamConfirmationRejectsMissingHostPersistenceState(t *testing.T) {
	t.Parallel()

	runtime, err := New()
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"status":"not_found","owner":"ai-chat","stateKey":"history"}`))
	}))
	defer server.Close()

	err = runtime.StreamConfirmation(
		context.Background(),
		"user-1",
		"session-1",
		"confirm-1",
		true,
		VendorConfig{},
		CapabilityBridgeConfig{
			PersistenceCallbackURL:   server.URL,
			PersistenceCallbackToken: "test-token",
		},
		func(StreamChunk) error { return nil },
	)
	if err == nil {
		t.Fatal("expected StreamConfirmation to reject missing persisted confirmation")
	}
	if !strings.Contains(err.Error(), "not found in host persistence") {
		t.Fatalf("unexpected error: %v", err)
	}
}
