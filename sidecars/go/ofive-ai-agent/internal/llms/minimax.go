// Package llms provides concrete ADK model.LLM implementations used by the sidecar.
package llms

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"iter"
	"net/http"
	"os"
	"strings"
	"time"

	"google.golang.org/adk/model"
	"google.golang.org/genai"
)

const minimaxAnthropicVersion = "2023-06-01"

// MinimaxLLM implements ADK's model.LLM backed by MiniMax's Anthropic-compatible Messages API.
type MinimaxLLM struct {
	name     string
	endpoint string
	model    string
	apiKey   string
	client   *http.Client
	trace    func(title string, text string) error
}

// NewMinimaxLLM creates a new MiniMax adapter using explicit values first and env defaults second.
func NewMinimaxLLM(name, endpoint, modelName, apiKey string) *MinimaxLLM {
	if endpoint == "" {
		endpoint = "https://api.minimaxi.com/anthropic"
	}
	if modelName == "" {
		if value := os.Getenv("MINIMAX_MODEL"); value != "" {
			modelName = value
		}
	}
	if apiKey == "" {
		apiKey = firstNonEmpty(os.Getenv("MINIMAX_API_KEY"), os.Getenv("ANTHROPIC_API_KEY"))
	}

	return &MinimaxLLM{
		name:     ifEmpty(name, "minimax-anthropic"),
		endpoint: endpoint,
		model:    modelName,
		apiKey:   apiKey,
		client:   &http.Client{Timeout: 60 * time.Second},
	}
}

// Name returns the configured model identifier.
func (m *MinimaxLLM) Name() string { return m.name }

// SetTraceEmitter configures a debug trace sink for raw request/response logging.
func (m *MinimaxLLM) SetTraceEmitter(trace func(title string, text string) error) {
	m.trace = trace
}

// GenerateContent implements model.LLM.
func (m *MinimaxLLM) GenerateContent(
	ctx context.Context,
	req *model.LLMRequest,
	_ bool,
) iter.Seq2[*model.LLMResponse, error] {
	return func(yield func(*model.LLMResponse, error) bool) {
		systemPrompt, messages := buildMinimaxMessages(req)
		payload := minimaxChatRequest{
			Model:     m.resolveRequestModel(req.Model),
			Messages:  messages,
			Stream:    false,
			MaxTokens: 4096,
		}
		if systemPrompt != "" {
			payload.System = systemPrompt
		}
		payload.Tools = buildMinimaxTools(req)
		if len(payload.Tools) > 0 {
			payload.ToolChoice = &minimaxToolChoice{Type: "auto"}
		}

		if strings.TrimSpace(payload.Model) == "" {
			yield(nil, fmt.Errorf("minimax model is required; refresh the model list and save a supported model first"))
			return
		}

		if req.Config != nil {
			if req.Config.Temperature != nil {
				payload.Temperature = req.Config.Temperature
			}
			if req.Config.TopP != nil {
				payload.TopP = req.Config.TopP
			}
			if req.Config.MaxOutputTokens > 0 {
				payload.MaxTokens = int(req.Config.MaxOutputTokens)
			}
			if len(req.Config.StopSequences) > 0 {
				payload.StopSequences = req.Config.StopSequences
			}
		}

		body, err := json.Marshal(payload)
		if err != nil {
			yield(nil, err)
			return
		}
		if err := m.emitTrace("Model HTTP request", prettyJSON(body)); err != nil {
			yield(nil, err)
			return
		}

		httpReq, err := http.NewRequestWithContext(
			ctx,
			http.MethodPost,
			resolveMinimaxMessagesEndpoint(m.endpoint),
			bytes.NewReader(body),
		)
		if err != nil {
			yield(nil, err)
			return
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("anthropic-version", minimaxAnthropicVersion)
		if apiKey := strings.TrimSpace(m.apiKey); apiKey != "" {
			httpReq.Header.Set("x-api-key", apiKey)
		}

		resp, err := m.client.Do(httpReq)
		if err != nil {
			yield(nil, err)
			return
		}
		defer resp.Body.Close()

		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			yield(nil, err)
			return
		}
		if err := m.emitTrace("Model HTTP response", string(raw)); err != nil {
			yield(nil, err)
			return
		}

		var parsed minimaxChatResponse
		if err := json.Unmarshal(raw, &parsed); err != nil {
			yield(nil, err)
			return
		}
		if parsed.Error != nil {
			yield(nil, fmt.Errorf("minimax api error: type=%s message=%s", parsed.Error.Type, parsed.Error.Message))
			return
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			yield(nil, fmt.Errorf("minimax api error: status=%d body=%s", resp.StatusCode, string(raw)))
			return
		}

		parts := buildMinimaxResponseParts(parsed.Content)
		if len(parts) == 0 {
			parts = []*genai.Part{genai.NewPartFromText("")}
		}

		llmResp := &model.LLMResponse{
			Content: &genai.Content{
				Role:  genai.RoleModel,
				Parts: parts,
			},
			FinishReason: mapMinimaxFinishReason(parsed.StopReason),
			UsageMetadata: &genai.GenerateContentResponseUsageMetadata{
				PromptTokenCount:     int32(parsed.Usage.InputTokens),
				CandidatesTokenCount: int32(parsed.Usage.OutputTokens),
				TotalTokenCount: int32(
					parsed.Usage.InputTokens + parsed.Usage.OutputTokens,
				),
			},
			TurnComplete: true,
		}
		yield(llmResp, nil)
	}
}

func (m *MinimaxLLM) emitTrace(title string, text string) error {
	if m.trace == nil || strings.TrimSpace(text) == "" {
		return nil
	}
	return m.trace(title, text)
}

func (m *MinimaxLLM) resolveRequestModel(requestModel string) string {
	configuredModel := strings.TrimSpace(m.model)
	if configuredModel != "" {
		return configuredModel
	}

	trimmedRequestModel := strings.TrimSpace(requestModel)
	if trimmedRequestModel == "" {
		return ""
	}
	if trimmedRequestModel == strings.TrimSpace(m.name) {
		return ""
	}

	return trimmedRequestModel
}

func resolveMinimaxMessagesEndpoint(endpoint string) string {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		trimmed = "https://api.minimaxi.com/anthropic"
	}
	trimmed = strings.TrimRight(trimmed, "/")
	if strings.HasSuffix(trimmed, "/v1/messages") {
		return trimmed
	}
	return trimmed + "/v1/messages"
}

func buildMinimaxMessages(req *model.LLMRequest) (string, []minimaxMessage) {
	if req == nil {
		return "", nil
	}

	systemPrompt := ""
	if req.Config != nil && req.Config.SystemInstruction != nil {
		systemPrompt = extractText(req.Config.SystemInstruction)
	}

	state := &toolCallHistoryState{}
	messages := make([]minimaxMessage, 0, len(req.Contents))
	for _, content := range req.Contents {
		message := convertContentToMinimaxMessage(content, state)
		if len(message.Content) == 0 {
			continue
		}
		messages = append(messages, message)
	}

	return systemPrompt, messages
}

func convertContentToMinimaxMessage(
	content *genai.Content,
	state *toolCallHistoryState,
) minimaxMessage {
	if content == nil {
		return minimaxMessage{}
	}
	message := minimaxMessage{Role: mapRole(string(content.Role))}

	for _, part := range content.Parts {
		if part == nil {
			continue
		}
		if part.Text != "" {
			message.Content = append(message.Content, minimaxContentBlock{
				Type: "text",
				Text: part.Text,
			})
			continue
		}

		if part.FunctionCall != nil {
			toolUseID := state.registerCall(part.FunctionCall.ID)
			message.Role = "assistant"
			message.Content = append(message.Content, minimaxContentBlock{
				Type:  "tool_use",
				ID:    toolUseID,
				Name:  part.FunctionCall.Name,
				Input: part.FunctionCall.Args,
			})
			continue
		}

		if part.FunctionResponse != nil {
			toolUseID := state.resolveResponse(part.FunctionResponse.ID)
			message.Role = "user"
			message.Content = append(message.Content, minimaxContentBlock{
				Type:      "tool_result",
				ToolUseID: toolUseID,
				Content:   marshalJSONObject(part.FunctionResponse.Response),
			})
		}
	}

	return message
}

func buildMinimaxTools(req *model.LLMRequest) []minimaxTool {
	if req == nil || req.Config == nil || len(req.Config.Tools) == 0 {
		return nil
	}

	tools := make([]minimaxTool, 0)
	for _, tool := range req.Config.Tools {
		if tool == nil || len(tool.FunctionDeclarations) == 0 {
			continue
		}
		for _, declaration := range tool.FunctionDeclarations {
			if declaration == nil || strings.TrimSpace(declaration.Name) == "" {
				continue
			}
			tools = append(tools, minimaxTool{
				Name:        declaration.Name,
				Description: declaration.Description,
				InputSchema: buildToolParameters(declaration),
			})
		}
	}
	if len(tools) == 0 {
		return nil
	}
	return tools
}

func buildMinimaxResponseParts(content []minimaxContentBlock) []*genai.Part {
	parts := make([]*genai.Part, 0, len(content))
	state := &toolCallHistoryState{}
	for _, block := range content {
		switch block.Type {
		case "text":
			if strings.TrimSpace(block.Text) != "" {
				parts = append(parts, genai.NewPartFromText(block.Text))
			}
		case "tool_use":
			if strings.TrimSpace(block.Name) == "" {
				continue
			}
			args, ok := block.Input.(map[string]any)
			if !ok || args == nil {
				args = map[string]any{}
			}
			parts = append(parts, &genai.Part{FunctionCall: &genai.FunctionCall{
				ID:   state.registerCall(block.ID),
				Name: block.Name,
				Args: args,
			}})
		}
	}
	return parts
}

func mapMinimaxFinishReason(reason string) genai.FinishReason {
	switch reason {
	case "end_turn":
		return genai.FinishReasonStop
	case "tool_use":
		return genai.FinishReasonStop
	case "max_tokens":
		return genai.FinishReasonMaxTokens
	case "stop_sequence":
		return genai.FinishReasonStop
	default:
		return genai.FinishReasonUnspecified
	}
}

type minimaxChatRequest struct {
	Model         string             `json:"model"`
	System        string             `json:"system,omitempty"`
	Messages      []minimaxMessage   `json:"messages"`
	Tools         []minimaxTool      `json:"tools,omitempty"`
	ToolChoice    *minimaxToolChoice `json:"tool_choice,omitempty"`
	MaxTokens     int                `json:"max_tokens"`
	Stream        bool               `json:"stream,omitempty"`
	Temperature   *float32           `json:"temperature,omitempty"`
	TopP          *float32           `json:"top_p,omitempty"`
	StopSequences []string           `json:"stop_sequences,omitempty"`
}

type minimaxMessage struct {
	Role    string                `json:"role"`
	Content []minimaxContentBlock `json:"content"`
}

type minimaxContentBlock struct {
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	ToolUseID string `json:"tool_use_id,omitempty"`
	Input     any    `json:"input,omitempty"`
	Content   string `json:"content,omitempty"`
}

type minimaxTool struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	InputSchema any    `json:"input_schema,omitempty"`
}

type minimaxToolChoice struct {
	Type string `json:"type"`
}

type minimaxChatResponse struct {
	ID         string                `json:"id"`
	Type       string                `json:"type"`
	Role       string                `json:"role"`
	Model      string                `json:"model"`
	StopReason string                `json:"stop_reason"`
	Content    []minimaxContentBlock `json:"content"`
	Usage      struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
	Error *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}
