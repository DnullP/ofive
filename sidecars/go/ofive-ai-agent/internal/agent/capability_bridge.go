package agentruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"ofive/sidecars/go/ofive-ai-agent/internal/capabilities"
)

const capabilityBridgeAgentName = "capability-bridge"

const (
	plannedCapabilityCallStartTag = "<OFIVE_TOOL_CALL>"
	plannedCapabilityCallEndTag   = "</OFIVE_TOOL_CALL>"
	maxCapabilityPlanningTurns    = 4
)

func tryHandleExplicitCapabilityCommand(
	ctx context.Context,
	message string,
	bridgeConfig CapabilityBridgeConfig,
	trace func(DebugTraceEvent) error,
) (string, string, bool, error) {
	command, handled, err := parseExplicitCapabilityCommand(message)
	if !handled || err != nil {
		return "", capabilityBridgeAgentName, handled, err
	}

	client, ok := capabilityClientFromBridge(bridgeConfig)
	if !ok {
		return "", capabilityBridgeAgentName, true, fmt.Errorf("capability bridge is not configured")
	}
	defer client.Close()

	capabilityID, err := resolveCapabilityID(command.name, bridgeConfig.Tools)
	if err != nil {
		return "", capabilityBridgeAgentName, true, err
	}
	for _, tool := range bridgeConfig.Tools {
		if tool.CapabilityID == capabilityID && tool.RequiresConfirmation {
			return "", capabilityBridgeAgentName, true, fmt.Errorf("capability %s requires confirmation and cannot be executed through explicit tool commands", capabilityID)
		}
	}

	formattedOutput, _, err := executeCapabilityCall(ctx, client, capabilityID, command.input, trace)
	if err != nil {
		return "", capabilityBridgeAgentName, true, err
	}

	return fmt.Sprintf("[tool:%s]\n%s", capabilityID, formattedOutput), capabilityBridgeAgentName, true, nil
}

type plannedCapabilityCall struct {
	CapabilityID string `json:"capabilityId"`
	Capability   string `json:"capability"`
	Name         string `json:"name"`
	Input        any    `json:"input"`
}

func executeCapabilityPlanningLoop(
	ctx context.Context,
	originalMessage string,
	bridgeConfig CapabilityBridgeConfig,
	respond func(context.Context, string) (string, error),
) (string, error) {
	responseText, confirmation, err := executeCapabilityPlanningLoopWithConfirmation(
		ctx,
		originalMessage,
		bridgeConfig,
		respond,
	)
	if err != nil {
		return "", err
	}
	if confirmation != nil {
		return "", fmt.Errorf(
			"capability %s requires confirmation and cannot be completed by non-stream planning",
			confirmation.ToolName,
		)
	}
	return responseText, nil
}

func executeCapabilityPlanningLoopWithConfirmation(
	ctx context.Context,
	originalMessage string,
	bridgeConfig CapabilityBridgeConfig,
	respond func(context.Context, string) (string, error),
) (string, *pendingToolConfirmation, error) {
	client, ok := capabilityClientFromBridge(bridgeConfig)
	if !ok {
		return "", nil, fmt.Errorf("capability bridge is not configured")
	}
	defer client.Close()

	prompt := originalMessage
	for attempt := 0; attempt < maxCapabilityPlanningTurns; attempt++ {
		responseText, err := respond(ctx, prompt)
		if err != nil {
			return "", nil, err
		}

		plannedCall, hasCall, err := extractPlannedCapabilityCall(responseText)
		if err != nil {
			return "", nil, err
		}
		if !hasCall {
			return responseText, nil, nil
		}

		capabilityName := plannedCall.CapabilityID
		if strings.TrimSpace(capabilityName) == "" {
			capabilityName = plannedCall.Capability
		}
		if strings.TrimSpace(capabilityName) == "" {
			capabilityName = plannedCall.Name
		}

		capabilityID, err := resolveCapabilityID(capabilityName, bridgeConfig.Tools)
		if err != nil {
			return "", nil, err
		}

		if tool, ok := findToolDescriptorByCapabilityID(capabilityID, bridgeConfig.Tools); ok && tool.RequiresConfirmation {
			return "", buildPendingCapabilityConfirmation(capabilityID, plannedCall.Input), nil
		}

		formattedOutput, rawOutput, err := executeCapabilityCall(
			ctx,
			client,
			capabilityID,
			plannedCall.Input,
			nil,
		)
		if err != nil {
			return "", nil, err
		}

		prompt = buildCapabilityResultPrompt(originalMessage, capabilityID, formattedOutput, rawOutput)
	}

	return "", nil, fmt.Errorf("capability planning exceeded %d turns", maxCapabilityPlanningTurns)
}

type explicitCapabilityCommand struct {
	name  string
	input any
}

func executeCapabilityCall(
	ctx context.Context,
	client capabilityCaller,
	capabilityID string,
	input any,
	trace func(DebugTraceEvent) error,
) (string, any, error) {
	if err := emitDebugTrace(trace, DebugTraceEvent{
		Level: "info",
		Title: "Capability call started",
		Text:  fmt.Sprintf("capability=%s input=%s", capabilityID, marshalCapabilityInput(input)),
	}); err != nil {
		return "", nil, err
	}

	result, err := client.Call(ctx, capabilityID, input)
	if err != nil {
		_ = emitDebugTrace(trace, DebugTraceEvent{
			Level: "error",
			Title: "Capability call transport failed",
			Text:  fmt.Sprintf("capability=%s error=%v", capabilityID, err),
		})
		return "", nil, err
	}
	if !result.Success {
		failureText := result.Error
		if strings.TrimSpace(failureText) == "" {
			failureText = fmt.Sprintf("capability call failed: %s", capabilityID)
		}
		_ = emitDebugTrace(trace, DebugTraceEvent{
			Level: "error",
			Title: "Capability call failed",
			Text:  fmt.Sprintf("capability=%s error=%s", capabilityID, failureText),
		})
		if result.Error == "" {
			return "", nil, fmt.Errorf("capability call failed: %s", capabilityID)
		}
		return "", nil, errors.New(result.Error)
	}

	formattedOutput, err := json.MarshalIndent(result.Output, "", "  ")
	if err != nil {
		_ = emitDebugTrace(trace, DebugTraceEvent{
			Level: "error",
			Title: "Capability result encode failed",
			Text:  fmt.Sprintf("capability=%s error=%v", capabilityID, err),
		})
		return "", nil, err
	}

	_ = emitDebugTrace(trace, DebugTraceEvent{
		Level: "info",
		Title: "Capability call completed",
		Text:  fmt.Sprintf("capability=%s output=%s", capabilityID, string(formattedOutput)),
	})

	return string(formattedOutput), result.Output, nil
}

func streamManagedCapabilityConfirmationResponse(
	ctx context.Context,
	confirmed bool,
	confirmation *persistedConfirmationState,
	bridgeConfig CapabilityBridgeConfig,
	trace func(DebugTraceEvent) error,
	emit func(StreamChunk) error,
) error {
	if confirmation == nil {
		return fmt.Errorf("managed capability confirmation state is required")
	}

	if !confirmed {
		return emitChunkedTextResponse(
			fmt.Sprintf("[confirmation:rejected] %s\n%s", confirmation.ToolName, confirmation.ToolArgsJSON),
			capabilityBridgeAgentName,
			emit,
		)
	}

	client, ok := capabilityClientFromBridge(bridgeConfig)
	if !ok {
		return fmt.Errorf("capability bridge is not configured")
	}
	defer client.Close()

	capabilityID, err := resolveCapabilityID(confirmation.ToolName, bridgeConfig.Tools)
	if err != nil {
		return err
	}

	var input any = map[string]any{}
	if strings.TrimSpace(confirmation.ToolArgsJSON) != "" {
		if err := json.Unmarshal([]byte(confirmation.ToolArgsJSON), &input); err != nil {
			return fmt.Errorf("invalid confirmed capability input json: %w", err)
		}
	}

	formattedOutput, _, err := executeCapabilityCall(ctx, client, capabilityID, input, trace)
	if err != nil {
		return err
	}

	return emitChunkedTextResponse(
		fmt.Sprintf("[tool:%s]\n%s", capabilityID, formattedOutput),
		capabilityBridgeAgentName,
		emit,
	)
}

func marshalCapabilityInput(input any) string {
	encoded, err := json.Marshal(input)
	if err != nil {
		return "{}"
	}

	return string(encoded)
}

func extractPlannedCapabilityCall(text string) (plannedCapabilityCall, bool, error) {
	startIndex := strings.Index(text, plannedCapabilityCallStartTag)
	if startIndex < 0 {
		return plannedCapabilityCall{}, false, nil
	}

	endIndex := strings.Index(text, plannedCapabilityCallEndTag)
	if endIndex < 0 || endIndex < startIndex {
		return plannedCapabilityCall{}, true, fmt.Errorf("unterminated tool call block")
	}

	block := strings.TrimSpace(text[startIndex+len(plannedCapabilityCallStartTag) : endIndex])
	if block == "" {
		return plannedCapabilityCall{}, true, fmt.Errorf("empty tool call block")
	}

	var call plannedCapabilityCall
	if err := json.Unmarshal([]byte(block), &call); err != nil {
		return plannedCapabilityCall{}, true, fmt.Errorf("invalid tool call json: %w", err)
	}

	return call, true, nil
}

func buildCapabilityResultPrompt(
	originalMessage string,
	capabilityID string,
	formattedOutput string,
	rawOutput any,
) string {
	_ = rawOutput

	return fmt.Sprintf(
		"Original user request:\n%s\n\n"+
			"Tool %s completed successfully.\n"+
			"Tool result JSON:\n%s\n\n"+
			"Continue helping the user. "+
			"If another tool is required, respond with exactly one %s ... %s block and no extra text. "+
			"Otherwise answer the user directly without tool tags.",
		strings.TrimSpace(originalMessage),
		capabilityID,
		formattedOutput,
		plannedCapabilityCallStartTag,
		plannedCapabilityCallEndTag,
	)
}

func findToolDescriptorByCapabilityID(capabilityID string, tools []ToolDescriptor) (ToolDescriptor, bool) {
	for _, tool := range tools {
		if strings.TrimSpace(tool.CapabilityID) == strings.TrimSpace(capabilityID) {
			return tool, true
		}
	}
	return ToolDescriptor{}, false
}

func buildPendingCapabilityConfirmation(capabilityID string, input any) *pendingToolConfirmation {
	return &pendingToolConfirmation{
		ID:           fmt.Sprintf("ofive-cli-%d", time.Now().UnixNano()),
		Hint:         fmt.Sprintf("Execute %s through ofive's managed CLI tool runtime?", capabilityID),
		ToolName:     capabilityID,
		ToolArgsJSON: marshalConfirmationArgs(normalizeCapabilityConfirmationInput(input)),
	}
}

func normalizeCapabilityConfirmationInput(input any) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	if mapInput, ok := input.(map[string]any); ok {
		return mapInput
	}
	return map[string]any{"value": input}
}

type capabilityCaller interface {
	Call(ctx context.Context, capabilityID string, input any) (*capabilities.CallResult, error)
	Close() error
}

func parseExplicitCapabilityCommand(message string) (explicitCapabilityCommand, bool, error) {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return explicitCapabilityCommand{}, false, nil
	}

	prefixes := []string{"tool ", "/tool ", "capability ", "/capability "}
	matchedPrefix := ""
	for _, prefix := range prefixes {
		if strings.HasPrefix(trimmed, prefix) {
			matchedPrefix = prefix
			break
		}
	}
	if matchedPrefix == "" {
		return explicitCapabilityCommand{}, false, nil
	}

	remainder := strings.TrimSpace(strings.TrimPrefix(trimmed, matchedPrefix))
	parts := strings.SplitN(remainder, " ", 2)
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return explicitCapabilityCommand{}, true, fmt.Errorf("capability command missing tool name")
	}

	command := explicitCapabilityCommand{
		name:  strings.TrimSpace(parts[0]),
		input: map[string]any{},
	}
	if len(parts) == 1 {
		return command, true, nil
	}

	var input any
	if err := json.Unmarshal([]byte(strings.TrimSpace(parts[1])), &input); err != nil {
		return explicitCapabilityCommand{}, true, fmt.Errorf("invalid capability input json: %w", err)
	}
	command.input = input

	return command, true, nil
}

func resolveCapabilityID(name string, tools []ToolDescriptor) (string, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return "", fmt.Errorf("capability name is required")
	}

	for _, tool := range tools {
		if trimmedName == tool.CapabilityID || trimmedName == tool.Name {
			return tool.CapabilityID, nil
		}
	}

	return "", fmt.Errorf("unknown capability: %s", trimmedName)
}
