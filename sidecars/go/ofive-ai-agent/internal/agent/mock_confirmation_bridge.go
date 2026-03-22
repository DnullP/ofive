package agentruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const mockConfirmationAgentName = "mock-confirmation"

type explicitMockConfirmationCommand struct {
	confirmation pendingToolConfirmation
	responseText string
}

type explicitMockConfirmationPayload struct {
	ConfirmationID string `json:"confirmationId"`
	Hint           string `json:"hint"`
	ToolName       string `json:"toolName"`
	ToolArgs       any    `json:"toolArgs"`
	ResponseText   string `json:"responseText"`
}

func tryHandleExplicitMockConfirmationCommand(
	ctx context.Context,
	sessionID string,
	message string,
	bridgeConfig CapabilityBridgeConfig,
) (*pendingToolConfirmation, string, bool, error) {
	command, handled, err := parseExplicitMockConfirmationCommand(message)
	if !handled || err != nil {
		return nil, "", handled, err
	}

	if err := savePendingConfirmation(ctx, sessionID, command.confirmation, bridgeConfig); err != nil {
		return nil, "", true, err
	}

	return &command.confirmation, command.responseText, true, nil
}

func parseExplicitMockConfirmationCommand(
	message string,
) (explicitMockConfirmationCommand, bool, error) {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return explicitMockConfirmationCommand{}, false, nil
	}

	prefixes := []string{"confirmtool ", "/confirmtool "}
	matchedPrefix := ""
	for _, prefix := range prefixes {
		if strings.HasPrefix(trimmed, prefix) {
			matchedPrefix = prefix
			break
		}
	}
	if matchedPrefix == "" {
		return explicitMockConfirmationCommand{}, false, nil
	}

	rawPayload := strings.TrimSpace(strings.TrimPrefix(trimmed, matchedPrefix))
	if rawPayload == "" {
		return explicitMockConfirmationCommand{}, true, fmt.Errorf("mock confirmation command requires json payload")
	}

	var payload explicitMockConfirmationPayload
	if err := json.Unmarshal([]byte(rawPayload), &payload); err != nil {
		return explicitMockConfirmationCommand{}, true, fmt.Errorf(
			"invalid mock confirmation input json: %w",
			err,
		)
	}

	confirmationID := strings.TrimSpace(payload.ConfirmationID)
	if confirmationID == "" {
		confirmationID = "mock-confirmation"
	}

	toolName := strings.TrimSpace(payload.ToolName)
	if toolName == "" {
		return explicitMockConfirmationCommand{}, true, fmt.Errorf("mock confirmation command requires toolName")
	}

	hint := strings.TrimSpace(payload.Hint)
	if hint == "" {
		hint = "Please confirm this tool execution."
	}

	responseText := strings.TrimSpace(payload.ResponseText)
	if responseText == "" {
		responseText = fmt.Sprintf("Pending confirmation for %s", toolName)
	}

	return explicitMockConfirmationCommand{
		confirmation: pendingToolConfirmation{
			ID:           confirmationID,
			Hint:         hint,
			ToolName:     toolName,
			ToolArgsJSON: marshalConfirmationArgs(normalizeMockConfirmationArgs(payload.ToolArgs)),
		},
		responseText: responseText,
	}, true, nil
}

func streamMockConfirmationResponse(
	confirmed bool,
	confirmation *persistedConfirmationState,
	emit func(StreamChunk) error,
) error {
	status := "rejected"
	if confirmed {
		status = "approved"
	}

	toolName := "unknown-tool"
	toolArgsJSON := "{}"
	if confirmation != nil {
		if strings.TrimSpace(confirmation.ToolName) != "" {
			toolName = confirmation.ToolName
		}
		if strings.TrimSpace(confirmation.ToolArgsJSON) != "" {
			toolArgsJSON = confirmation.ToolArgsJSON
		}
	}

	responseText := fmt.Sprintf(
		"[confirmation:%s] %s\n%s",
		status,
		toolName,
		toolArgsJSON,
	)

	return emitChunkedTextResponse(responseText, mockConfirmationAgentName, emit)
}

func normalizeMockConfirmationArgs(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	mapValue, ok := value.(map[string]any)
	if ok {
		return mapValue
	}
	return map[string]any{"value": value}
}
