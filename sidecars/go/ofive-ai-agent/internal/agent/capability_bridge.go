package agentruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

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

	formattedOutput, _, err := executeCapabilityCall(ctx, client, capabilityID, command.input)
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
	client, ok := capabilityClientFromBridge(bridgeConfig)
	if !ok {
		return "", fmt.Errorf("capability bridge is not configured")
	}
	defer client.Close()

	prompt := originalMessage
	for attempt := 0; attempt < maxCapabilityPlanningTurns; attempt++ {
		responseText, err := respond(ctx, prompt)
		if err != nil {
			return "", err
		}

		plannedCall, hasCall, err := extractPlannedCapabilityCall(responseText)
		if err != nil {
			return "", err
		}
		if !hasCall {
			return responseText, nil
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
			return "", err
		}

		formattedOutput, rawOutput, err := executeCapabilityCall(
			ctx,
			client,
			capabilityID,
			plannedCall.Input,
		)
		if err != nil {
			return "", err
		}

		prompt = buildCapabilityResultPrompt(originalMessage, capabilityID, formattedOutput, rawOutput)
	}

	return "", fmt.Errorf("capability planning exceeded %d turns", maxCapabilityPlanningTurns)
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
) (string, any, error) {
	result, err := client.Call(ctx, capabilityID, input)
	if err != nil {
		return "", nil, err
	}
	if !result.Success {
		if result.Error == "" {
			return "", nil, fmt.Errorf("capability call failed: %s", capabilityID)
		}
		return "", nil, errors.New(result.Error)
	}

	formattedOutput, err := json.MarshalIndent(result.Output, "", "  ")
	if err != nil {
		return "", nil, err
	}

	return string(formattedOutput), result.Output, nil
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
