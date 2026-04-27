package agentruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"google.golang.org/adk/agent"
	"google.golang.org/adk/model"
	"google.golang.org/adk/tool"
	"google.golang.org/genai"
)

type capabilityToolset struct {
	tools []tool.Tool
}

type capabilityTool struct {
	config       CapabilityBridgeConfig
	capabilityID string
	name         string
	description  string
	inputSchema  any
	outputSchema any
	confirmation bool
}

func newCapabilityToolset(config CapabilityBridgeConfig) (*capabilityToolset, error) {
	items := make([]tool.Tool, 0, len(config.Tools))
	for _, descriptor := range config.Tools {
		if strings.TrimSpace(descriptor.CapabilityID) == "" || strings.TrimSpace(descriptor.Name) == "" {
			continue
		}

		inputSchema, err := decodeToolSchemaJSON(descriptor.InputSchemaJSON)
		if err != nil {
			return nil, fmt.Errorf("decode input schema for %s: %w", descriptor.CapabilityID, err)
		}
		outputSchema, err := decodeToolSchemaJSON(descriptor.OutputSchemaJSON)
		if err != nil {
			return nil, fmt.Errorf("decode output schema for %s: %w", descriptor.CapabilityID, err)
		}

		items = append(items, &capabilityTool{
			config:       config,
			capabilityID: strings.TrimSpace(descriptor.CapabilityID),
			name:         strings.TrimSpace(descriptor.Name),
			description:  strings.TrimSpace(descriptor.Description),
			inputSchema:  inputSchema,
			outputSchema: outputSchema,
			confirmation: descriptor.RequiresConfirmation,
		})
	}

	return &capabilityToolset{
		tools: items,
	}, nil
}

func (s *capabilityToolset) Name() string {
	return "ofive-managed-capabilities"
}

func (s *capabilityToolset) Tools(_ agent.ReadonlyContext) ([]tool.Tool, error) {
	return append([]tool.Tool(nil), s.tools...), nil
}

func (t *capabilityTool) Name() string {
	return t.name
}

func (t *capabilityTool) Description() string {
	return t.description
}

func (t *capabilityTool) IsLongRunning() bool {
	return false
}

func (t *capabilityTool) Declaration() *genai.FunctionDeclaration {
	declaration := &genai.FunctionDeclaration{
		Name:        t.name,
		Description: t.description,
	}
	if t.inputSchema != nil {
		declaration.ParametersJsonSchema = t.inputSchema
	}
	if t.outputSchema != nil {
		declaration.ResponseJsonSchema = t.outputSchema
	}
	return declaration
}

func (t *capabilityTool) ProcessRequest(_ tool.Context, request *model.LLMRequest) error {
	if request.Tools == nil {
		request.Tools = make(map[string]any)
	}
	if _, exists := request.Tools[t.name]; exists {
		return fmt.Errorf("duplicate tool: %q", t.name)
	}
	request.Tools[t.name] = t

	if request.Config == nil {
		request.Config = &genai.GenerateContentConfig{}
	}
	var functionTool *genai.Tool
	for _, item := range request.Config.Tools {
		if item != nil && item.FunctionDeclarations != nil {
			functionTool = item
			break
		}
	}
	if functionTool == nil {
		request.Config.Tools = append(request.Config.Tools, &genai.Tool{
			FunctionDeclarations: []*genai.FunctionDeclaration{t.Declaration()},
		})
	} else {
		functionTool.FunctionDeclarations = append(functionTool.FunctionDeclarations, t.Declaration())
	}
	return nil
}

func (t *capabilityTool) Run(ctx tool.Context, args any) (map[string]any, error) {
	if confirmation := ctx.ToolConfirmation(); confirmation != nil {
		if !confirmation.Confirmed {
			return nil, fmt.Errorf("error tool %q %w", t.Name(), tool.ErrConfirmationRejected)
		}
	} else if t.confirmation {
		if err := ctx.RequestConfirmation(
			fmt.Sprintf("Execute %s through ofive's managed CLI tool runtime?", t.capabilityID),
			map[string]any{
				"capabilityId": t.capabilityID,
				"toolName":     t.name,
				"input":        normalizeCapabilityConfirmationInput(args),
			},
		); err != nil {
			return nil, err
		}
		ctx.Actions().SkipSummarization = true
		return nil, fmt.Errorf("error tool %q %w", t.Name(), tool.ErrConfirmationRequired)
	}

	return t.call(ctx, args)
}

func (t *capabilityTool) call(ctx context.Context, args any) (map[string]any, error) {
	client, ok := capabilityClientFromBridge(t.config)
	if !ok {
		return nil, fmt.Errorf("capability bridge is not configured")
	}
	defer client.Close()

	result, err := client.Call(ctx, t.capabilityID, normalizeCapabilityToolInput(args))
	if err != nil {
		return nil, err
	}
	if !result.Success {
		failureText := strings.TrimSpace(result.Error)
		if failureText == "" {
			failureText = fmt.Sprintf("capability call failed: %s", t.capabilityID)
		}
		return nil, fmt.Errorf("%s", failureText)
	}

	return map[string]any{
		"capabilityId": t.capabilityID,
		"output":       result.Output,
	}, nil
}

func buildCapabilityToolsets(config CapabilityBridgeConfig) ([]tool.Toolset, error) {
	if strings.TrimSpace(config.CallbackURL) == "" || strings.TrimSpace(config.CallbackToken) == "" {
		return nil, nil
	}
	if len(config.Tools) == 0 {
		return nil, nil
	}
	toolset, err := newCapabilityToolset(config)
	if err != nil {
		return nil, err
	}
	if len(toolset.tools) == 0 {
		return nil, nil
	}
	return []tool.Toolset{toolset}, nil
}

func decodeToolSchemaJSON(raw string) (any, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, err
	}
	return value, nil
}

func normalizeCapabilityToolInput(input any) any {
	if input == nil {
		return map[string]any{}
	}
	if typed, ok := input.(map[string]any); ok {
		return typed
	}
	return map[string]any{"value": input}
}

var _ tool.Tool = (*capabilityTool)(nil)
