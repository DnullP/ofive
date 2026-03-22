package agentruntime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	sidecarpersistence "ofive/sidecars/go/ofive-ai-agent/internal/persistence"
)

const pendingConfirmationSchemaVersion uint32 = 1

// persistedConfirmationState captures the host-backed state needed to resume
// one pending tool confirmation safely across sidecar runtime boundaries.
type persistedConfirmationState struct {
	SessionID      string `json:"sessionId"`
	ConfirmationID string `json:"confirmationId"`
	Hint           string `json:"hint,omitempty"`
	ToolName       string `json:"toolName,omitempty"`
	ToolArgsJSON   string `json:"toolArgsJson,omitempty"`
}

// savePendingConfirmation stores pending confirmation metadata through the
// Rust host persistence contract when the callback bridge is configured.
func savePendingConfirmation(
	ctx context.Context,
	sessionID string,
	confirmation pendingToolConfirmation,
	bridgeConfig CapabilityBridgeConfig,
) error {
	client, ok := persistenceClientFromBridge(bridgeConfig)
	if !ok {
		return nil
	}
	defer client.Close()

	trimmedSessionID := strings.TrimSpace(sessionID)
	trimmedConfirmationID := strings.TrimSpace(confirmation.ID)
	if trimmedSessionID == "" || trimmedConfirmationID == "" {
		return fmt.Errorf("pending confirmation persistence requires sessionID and confirmationID")
	}

	request := sidecarpersistence.NewModulePrivateRequest(
		sidecarModuleID,
		sidecarRuntimeID,
		trimmedSessionID,
		trimmedConfirmationID,
		sidecarpersistence.ActionSave,
		pendingConfirmationStateKey(trimmedSessionID, trimmedConfirmationID),
		pendingConfirmationSchemaVersion,
		"",
		persistedConfirmationState{
			SessionID:      trimmedSessionID,
			ConfirmationID: trimmedConfirmationID,
			Hint:           strings.TrimSpace(confirmation.Hint),
			ToolName:       strings.TrimSpace(confirmation.ToolName),
			ToolArgsJSON:   strings.TrimSpace(confirmation.ToolArgsJSON),
		},
	)

	response, err := client.Execute(ctx, request)
	if err != nil {
		return fmt.Errorf("save pending confirmation: %w", err)
	}
	if response == nil || response.Status != sidecarpersistence.ResponseStatusOK {
		return fmt.Errorf(
			"save pending confirmation rejected: status=%s code=%s",
			responseStatusValue(response),
			responseErrorCodeValue(response),
		)
	}

	return nil
}

// loadPersistedPendingConfirmation restores previously persisted confirmation
// metadata. The boolean return value reports whether host persistence is active.
func loadPersistedPendingConfirmation(
	ctx context.Context,
	sessionID string,
	confirmationID string,
	bridgeConfig CapabilityBridgeConfig,
) (*persistedConfirmationState, bool, error) {
	client, ok := persistenceClientFromBridge(bridgeConfig)
	if !ok {
		return nil, false, nil
	}
	defer client.Close()

	trimmedSessionID := strings.TrimSpace(sessionID)
	trimmedConfirmationID := strings.TrimSpace(confirmationID)
	request := sidecarpersistence.NewModulePrivateRequest(
		sidecarModuleID,
		sidecarRuntimeID,
		trimmedSessionID,
		trimmedConfirmationID,
		sidecarpersistence.ActionLoad,
		pendingConfirmationStateKey(trimmedSessionID, trimmedConfirmationID),
		pendingConfirmationSchemaVersion,
		"",
		nil,
	)

	response, err := client.Execute(ctx, request)
	if err != nil {
		return nil, true, fmt.Errorf("load pending confirmation: %w", err)
	}
	if response == nil {
		return nil, true, fmt.Errorf("load pending confirmation returned empty response")
	}
	if response.Status == sidecarpersistence.ResponseStatusNotFound {
		return nil, true, nil
	}
	if response.Status != sidecarpersistence.ResponseStatusOK {
		return nil, true, fmt.Errorf(
			"load pending confirmation rejected: status=%s code=%s",
			responseStatusValue(response),
			responseErrorCodeValue(response),
		)
	}

	state, err := decodePersistedConfirmationState(response.Payload)
	if err != nil {
		return nil, true, err
	}
	if state.SessionID != trimmedSessionID || state.ConfirmationID != trimmedConfirmationID {
		return nil, true, fmt.Errorf(
			"pending confirmation payload mismatch: session=%s confirmation=%s",
			state.SessionID,
			state.ConfirmationID,
		)
	}

	return state, true, nil
}

// deletePersistedPendingConfirmation removes persisted confirmation metadata
// after the confirmation roundtrip completes successfully.
func deletePersistedPendingConfirmation(
	ctx context.Context,
	sessionID string,
	confirmationID string,
	bridgeConfig CapabilityBridgeConfig,
) error {
	client, ok := persistenceClientFromBridge(bridgeConfig)
	if !ok {
		return nil
	}
	defer client.Close()

	trimmedSessionID := strings.TrimSpace(sessionID)
	trimmedConfirmationID := strings.TrimSpace(confirmationID)
	request := sidecarpersistence.NewModulePrivateRequest(
		sidecarModuleID,
		sidecarRuntimeID,
		trimmedSessionID,
		trimmedConfirmationID,
		sidecarpersistence.ActionDelete,
		pendingConfirmationStateKey(trimmedSessionID, trimmedConfirmationID),
		pendingConfirmationSchemaVersion,
		"",
		nil,
	)

	response, err := client.Execute(ctx, request)
	if err != nil {
		return fmt.Errorf("delete pending confirmation: %w", err)
	}
	if response == nil {
		return fmt.Errorf("delete pending confirmation returned empty response")
	}
	if response.Status != sidecarpersistence.ResponseStatusOK &&
		response.Status != sidecarpersistence.ResponseStatusNotFound {
		return fmt.Errorf(
			"delete pending confirmation rejected: status=%s code=%s",
			responseStatusValue(response),
			responseErrorCodeValue(response),
		)
	}

	return nil
}

// pendingConfirmationStateKey derives one host-safe persistence key for a
// session-scoped confirmation id.
func pendingConfirmationStateKey(sessionID string, confirmationID string) string {
	seed := strings.TrimSpace(sessionID) + "\n" + strings.TrimSpace(confirmationID)
	hash := sha256.Sum256([]byte(seed))
	return "confirmation-" + hex.EncodeToString(hash[:12])
}

func decodePersistedConfirmationState(payload any) (*persistedConfirmationState, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal pending confirmation payload: %w", err)
	}

	var state persistedConfirmationState
	if err := json.Unmarshal(encoded, &state); err != nil {
		return nil, fmt.Errorf("decode pending confirmation payload: %w", err)
	}

	state.SessionID = strings.TrimSpace(state.SessionID)
	state.ConfirmationID = strings.TrimSpace(state.ConfirmationID)
	state.Hint = strings.TrimSpace(state.Hint)
	state.ToolName = strings.TrimSpace(state.ToolName)
	state.ToolArgsJSON = strings.TrimSpace(state.ToolArgsJSON)

	return &state, nil
}

func responseStatusValue(response *sidecarpersistence.Response) sidecarpersistence.ResponseStatus {
	if response == nil {
		return sidecarpersistence.ResponseStatusError
	}
	return response.Status
}

func responseErrorCodeValue(response *sidecarpersistence.Response) string {
	if response == nil || response.ErrorCode == nil {
		return ""
	}
	return strings.TrimSpace(*response.ErrorCode)
}
