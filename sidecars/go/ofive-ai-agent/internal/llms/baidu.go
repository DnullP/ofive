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
	"sort"
	"strings"
	"time"

	"google.golang.org/adk/model"
	"google.golang.org/genai"
)

// BaiduLLM implements ADK's model.LLM backed by Baidu Qianfan Chat Completions API.
type BaiduLLM struct {
	name     string
	endpoint string
	model    string
	appID    string
	apiKey   string
	client   *http.Client
	trace    func(title string, text string) error
}

// NewBaiduLLM creates a new BaiduLLM using explicit values first and env defaults second.
func NewBaiduLLM(name, endpoint, modelName, appID, authToken string) *BaiduLLM {
	if endpoint == "" {
		endpoint = "https://qianfan.baidubce.com/v2/chat/completions"
	}
	if modelName == "" {
		if value := os.Getenv("BAIDU_QIANFAN_MODEL"); value != "" {
			modelName = value
		}
	}
	if appID == "" {
		appID = os.Getenv("BAIDU_APP_ID")
	}
	if authToken == "" {
		authToken = os.Getenv("BAIDU_AUTH_TOKEN")
	}

	return &BaiduLLM{
		name:     ifEmpty(name, "baidu-qianfan"),
		endpoint: endpoint,
		model:    modelName,
		appID:    appID,
		apiKey:   authToken,
		client:   &http.Client{Timeout: 60 * time.Second},
	}
}

// Name returns the configured model identifier.
func (b *BaiduLLM) Name() string { return b.name }

// SetTraceEmitter configures a debug trace sink for raw request/response logging.
func (b *BaiduLLM) SetTraceEmitter(trace func(title string, text string) error) {
	b.trace = trace
}

// GenerateContent implements model.LLM.
func (b *BaiduLLM) GenerateContent(
	ctx context.Context,
	req *model.LLMRequest,
	_ bool,
) iter.Seq2[*model.LLMResponse, error] {
	return func(yield func(*model.LLMResponse, error) bool) {
		msgs := buildMessages(req)

		payload := baiduChatRequest{
			Model:    b.resolveRequestModel(req.Model),
			Messages: msgs,
			Stream:   true,
		}
		payload.Tools = buildTools(req)
		if len(payload.Tools) > 0 {
			payload.ToolChoice = "auto"
		}

		if strings.TrimSpace(payload.Model) == "" {
			yield(nil, fmt.Errorf("baidu model is required; refresh the model list and save a supported model first"))
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
				maxTokens := int32(req.Config.MaxOutputTokens)
				payload.MaxTokens = &maxTokens
			}
			if len(req.Config.StopSequences) > 0 {
				payload.Stop = req.Config.StopSequences
			}
			if req.Config.PresencePenalty != nil {
				payload.PresencePenalty = req.Config.PresencePenalty
			}
			if req.Config.FrequencyPenalty != nil {
				payload.FrequencyPenalty = req.Config.FrequencyPenalty
			}
			if req.Config.Seed != nil {
				payload.Seed = req.Config.Seed
			}
			if req.Config.ResponseMIMEType == "application/json" {
				payload.ResponseFormat = &baiduRespFormat{Type: "json_object"}
			}
		}

		body, err := json.Marshal(payload)
		if err != nil {
			yield(nil, err)
			return
		}
		if err := b.emitTrace("Model HTTP request", prettyJSON(body)); err != nil {
			yield(nil, err)
			return
		}

		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, b.endpoint, bytes.NewReader(body))
		if err != nil {
			yield(nil, err)
			return
		}
		httpReq.Header.Set("Content-Type", "application/json")
		if b.appID != "" {
			httpReq.Header.Set("appid", b.appID)
		}
		if normalizedAuthorization := normalizeBaiduAuthorizationHeader(b.apiKey); normalizedAuthorization != "" {
			httpReq.Header.Set("Authorization", normalizedAuthorization)
		}

		resp, err := b.client.Do(httpReq)
		if err != nil {
			yield(nil, err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			raw, err := io.ReadAll(resp.Body)
			if err != nil {
				yield(nil, err)
				return
			}
			if err := b.emitTrace("Model HTTP response", string(raw)); err != nil {
				yield(nil, err)
				return
			}

			var parsed baiduChatResponse
			if err := json.Unmarshal(raw, &parsed); err == nil && (parsed.ErrorCode != "" || parsed.ErrorMessage != "") {
				yield(nil, fmt.Errorf(
					"baidu api error: code=%s type=%s message=%s",
					parsed.ErrorCode,
					parsed.ErrorType,
					parsed.ErrorMessage,
				))
				return
			}
			yield(nil, fmt.Errorf("baidu api error: status=%d body=%s", resp.StatusCode, string(raw)))
			return
		}

		if isEventStreamContentType(resp.Header.Get("Content-Type")) {
			raw, err := b.streamResponse(resp.Body, yield)
			if traceErr := b.emitTrace("Model HTTP response", raw); traceErr != nil {
				yield(nil, traceErr)
				return
			}
			if err != nil {
				yield(nil, err)
			}
			return
		}

		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			yield(nil, err)
			return
		}
		if err := b.emitTrace("Model HTTP response", string(raw)); err != nil {
			yield(nil, err)
			return
		}

		var parsed baiduChatResponse
		if err := json.Unmarshal(raw, &parsed); err != nil {
			yield(nil, err)
			return
		}

		if parsed.ErrorCode != "" || parsed.ErrorMessage != "" {
			yield(nil, fmt.Errorf(
				"baidu api error: code=%s type=%s message=%s",
				parsed.ErrorCode,
				parsed.ErrorType,
				parsed.ErrorMessage,
			))
			return
		}

		message := baiduChatResponseMessage{}
		finishReason := ""
		if len(parsed.Choices) > 0 {
			message = parsed.Choices[0].Message
			finishReason = parsed.Choices[0].FinishReason
		}
		yield(buildBaiduLLMResponse(message, finishReason, parsed.Usage.PromptTokens, parsed.Usage.CompletionTokens, parsed.Usage.TotalTokens, true), nil)
	}
}

func (b *BaiduLLM) streamResponse(
	body io.Reader,
	yield func(*model.LLMResponse, error) bool,
) (string, error) {
	state := baiduStreamState{
		toolCalls: make(map[int]*baiduStreamToolCall),
	}
	var emitted bool
	var completed bool

	raw, err := consumeSSEStream(body, func(event sseEvent) error {
		data := strings.TrimSpace(event.Data)
		if data == "" {
			return nil
		}
		if data == "[DONE]" {
			if !yield(buildBaiduLLMResponse(state.snapshotMessage(), state.finishReason, state.promptTokens, state.completionTokens, state.totalTokens, true), nil) {
				return io.EOF
			}
			emitted = true
			completed = true
			return nil
		}

		var chunk baiduChatStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return err
		}
		if chunk.ErrorCode != "" || chunk.ErrorMessage != "" {
			return fmt.Errorf(
				"baidu api error: code=%s type=%s message=%s",
				chunk.ErrorCode,
				chunk.ErrorType,
				chunk.ErrorMessage,
			)
		}

		if strings.TrimSpace(chunk.Result) != "" {
			state.text.WriteString(chunk.Result)
		}
		if chunk.Usage.PromptTokens > 0 {
			state.promptTokens = chunk.Usage.PromptTokens
		}
		if chunk.Usage.CompletionTokens > 0 {
			state.completionTokens = chunk.Usage.CompletionTokens
		}
		if chunk.Usage.TotalTokens > 0 {
			state.totalTokens = chunk.Usage.TotalTokens
		}

		textUpdated := strings.TrimSpace(chunk.Result) != ""
		for _, choice := range chunk.Choices {
			if strings.TrimSpace(choice.Delta.Content) != "" {
				state.text.WriteString(choice.Delta.Content)
				textUpdated = true
			}
			state.mergeToolCalls(choice.Delta.ToolCalls)
			if strings.TrimSpace(choice.FinishReason) != "" {
				state.finishReason = choice.FinishReason
			}
		}

		if textUpdated {
			emitted = true
			if !yield(buildBaiduLLMResponse(state.snapshotMessage(), state.finishReason, state.promptTokens, state.completionTokens, state.totalTokens, false), nil) {
				return io.EOF
			}
		}

		return nil
	})
	if err != nil && err != io.EOF {
		return raw, err
	}
	if err == io.EOF {
		return raw, nil
	}

	if !completed && (!emitted || strings.TrimSpace(state.text.String()) != "" || len(state.toolCalls) > 0) {
		yield(buildBaiduLLMResponse(state.snapshotMessage(), state.finishReason, state.promptTokens, state.completionTokens, state.totalTokens, true), nil)
	}
	return raw, nil
}

func (b *BaiduLLM) emitTrace(title string, text string) error {
	if b.trace == nil || strings.TrimSpace(text) == "" {
		return nil
	}
	return b.trace(title, text)
}

func prettyJSON(value []byte) string {
	var decoded any
	if err := json.Unmarshal(value, &decoded); err != nil {
		return string(value)
	}
	formatted, err := json.MarshalIndent(decoded, "", "  ")
	if err != nil {
		return string(value)
	}
	return string(formatted)
}

// buildMessages converts an ADK request into Baidu chat messages.
func buildMessages(req *model.LLMRequest) []baiduMessage {
	var msgs []baiduMessage

	if req.Config != nil && req.Config.SystemInstruction != nil {
		systemText := extractText(req.Config.SystemInstruction)
		if systemText != "" {
			msgs = append(msgs, baiduMessage{Role: "system", Content: systemText})
		}
	}

	msgs = append(msgs, convertContentsToMessages(req.Contents)...)
	return msgs
}

// extractText concatenates text parts from genai.Content.
func extractText(content *genai.Content) string {
	if content == nil {
		return ""
	}

	var builder bytes.Buffer
	for _, part := range content.Parts {
		if part != nil && part.Text != "" {
			builder.WriteString(part.Text)
		}
	}

	return builder.String()
}

// mapFinishReason maps Baidu finish_reason into genai finish reasons.
func mapFinishReason(reason string) genai.FinishReason {
	switch reason {
	case "stop":
		return genai.FinishReasonStop
	case "tool_calls":
		return genai.FinishReasonStop
	case "length":
		return genai.FinishReasonMaxTokens
	case "content_filter":
		return genai.FinishReasonSafety
	default:
		return genai.FinishReasonUnspecified
	}
}

func ifEmpty(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func (b *BaiduLLM) resolveRequestModel(requestModel string) string {
	configuredModel := strings.TrimSpace(b.model)
	if configuredModel != "" {
		return configuredModel
	}

	trimmedRequestModel := strings.TrimSpace(requestModel)
	if trimmedRequestModel == "" {
		return ""
	}

	if trimmedRequestModel == strings.TrimSpace(b.name) {
		return ""
	}

	return trimmedRequestModel
}

func normalizeBaiduAuthorizationHeader(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	lowerTrimmed := strings.ToLower(trimmed)
	if strings.HasPrefix(lowerTrimmed, "bearer ") {
		return trimmed
	}

	return "Bearer " + trimmed
}

type baiduMessage struct {
	Role       string             `json:"role"`
	Content    interface{}        `json:"content"`
	Name       string             `json:"name,omitempty"`
	ToolCallID string             `json:"tool_call_id,omitempty"`
	ToolCalls  []baiduToolCallRef `json:"tool_calls,omitempty"`
}

type baiduChatRequest struct {
	Model            string           `json:"model"`
	Messages         []baiduMessage   `json:"messages"`
	Tools            []baiduTool      `json:"tools,omitempty"`
	ToolChoice       string           `json:"tool_choice,omitempty"`
	Stream           bool             `json:"stream,omitempty"`
	Temperature      *float32         `json:"temperature,omitempty"`
	TopP             *float32         `json:"top_p,omitempty"`
	PenaltyScore     *float32         `json:"penalty_score,omitempty"`
	MaxTokens        *int32           `json:"max_tokens,omitempty"`
	Seed             *int32           `json:"seed,omitempty"`
	Stop             []string         `json:"stop,omitempty"`
	FrequencyPenalty *float32         `json:"frequency_penalty,omitempty"`
	PresencePenalty  *float32         `json:"presence_penalty,omitempty"`
	ResponseFormat   *baiduRespFormat `json:"response_format,omitempty"`
	User             string           `json:"user,omitempty"`
}

type baiduRespFormat struct {
	Type string `json:"type"`
}

type baiduTool struct {
	Type     string            `json:"type"`
	Function baiduToolFunction `json:"function"`
}

type baiduToolFunction struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Parameters  any    `json:"parameters,omitempty"`
}

type baiduToolCallRef struct {
	ID       string                  `json:"id,omitempty"`
	Type     string                  `json:"type,omitempty"`
	Function baiduToolCallRefPayload `json:"function,omitempty"`
}

type baiduToolCallRefPayload struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

type baiduChatResponseMessage struct {
	Role      string             `json:"role"`
	Content   string             `json:"content"`
	ToolCalls []baiduToolCallRef `json:"tool_calls"`
}

type baiduChatResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index        int                      `json:"index"`
		Message      baiduChatResponseMessage `json:"message"`
		FinishReason string                   `json:"finish_reason"`
		Flag         int                      `json:"flag"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	NeedClear    bool   `json:"need_clear_history"`
	ErrorCode    string `json:"code"`
	ErrorMessage string `json:"message"`
	ErrorType    string `json:"type"`
}

type baiduChatStreamChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index        int                    `json:"index"`
		Delta        baiduChatResponseDelta `json:"delta"`
		FinishReason string                 `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Result       string `json:"result"`
	ErrorCode    string `json:"code"`
	ErrorMessage string `json:"message"`
	ErrorType    string `json:"type"`
}

type baiduChatResponseDelta struct {
	Role      string                  `json:"role"`
	Content   string                  `json:"content"`
	ToolCalls []baiduToolCallDeltaRef `json:"tool_calls"`
}

type baiduToolCallDeltaRef struct {
	Index    *int                    `json:"index,omitempty"`
	ID       string                  `json:"id,omitempty"`
	Type     string                  `json:"type,omitempty"`
	Function baiduToolCallRefPayload `json:"function,omitempty"`
}

// convertContentsToMessages maps genai contents into Baidu chat messages.
func convertContentsToMessages(contents []*genai.Content) []baiduMessage {
	state := &toolCallHistoryState{}
	msgs := make([]baiduMessage, 0, len(contents))
	for _, content := range contents {
		if content == nil {
			continue
		}

		msgs = append(msgs, convertContentToMessages(content, state)...)
	}

	return msgs
}

type toolCallHistoryState struct {
	nextSyntheticID int
	pendingIDs      []string
}

func (s *toolCallHistoryState) newSyntheticID() string {
	s.nextSyntheticID++
	return fmt.Sprintf("tool-call-%d", s.nextSyntheticID)
}

func (s *toolCallHistoryState) registerCall(id string) string {
	trimmed := strings.TrimSpace(id)
	if trimmed == "" {
		trimmed = s.newSyntheticID()
	}
	s.pendingIDs = append(s.pendingIDs, trimmed)
	return trimmed
}

func (s *toolCallHistoryState) resolveResponse(id string) string {
	trimmed := strings.TrimSpace(id)
	if trimmed != "" {
		s.consume(trimmed)
		return trimmed
	}
	if len(s.pendingIDs) == 0 {
		return s.newSyntheticID()
	}
	trimmed = s.pendingIDs[0]
	s.pendingIDs = s.pendingIDs[1:]
	return trimmed
}

func (s *toolCallHistoryState) consume(id string) {
	if len(s.pendingIDs) == 0 {
		return
	}
	for index, pendingID := range s.pendingIDs {
		if pendingID != id {
			continue
		}
		s.pendingIDs = append(s.pendingIDs[:index], s.pendingIDs[index+1:]...)
		return
	}
}

func convertContentToMessages(content *genai.Content, state *toolCallHistoryState) []baiduMessage {
	role := mapRole(content.Role)
	msgs := make([]baiduMessage, 0, len(content.Parts))
	var textBuilder bytes.Buffer
	flushText := func() {
		if textBuilder.Len() == 0 {
			return
		}
		msgs = append(msgs, baiduMessage{
			Role:    role,
			Content: textBuilder.String(),
		})
		textBuilder.Reset()
	}

	for _, part := range content.Parts {
		if part == nil {
			continue
		}
		if part.Text != "" {
			textBuilder.WriteString(part.Text)
			continue
		}

		flushText()

		if part.FunctionCall != nil {
			toolCallID := state.registerCall(part.FunctionCall.ID)
			msgs = append(msgs, baiduMessage{
				Role:    "assistant",
				Content: "",
				ToolCalls: []baiduToolCallRef{{
					ID:   toolCallID,
					Type: "function",
					Function: baiduToolCallRefPayload{
						Name:      part.FunctionCall.Name,
						Arguments: marshalJSONObject(part.FunctionCall.Args),
					},
				}},
			})
			continue
		}

		if part.FunctionResponse != nil {
			toolCallID := state.resolveResponse(part.FunctionResponse.ID)
			msgs = append(msgs, baiduMessage{
				Role:       "tool",
				Name:       part.FunctionResponse.Name,
				ToolCallID: toolCallID,
				Content:    marshalJSONObject(part.FunctionResponse.Response),
			})
		}
	}

	flushText()
	return msgs
}

func buildTools(req *model.LLMRequest) []baiduTool {
	if req == nil || req.Config == nil || len(req.Config.Tools) == 0 {
		return nil
	}

	tools := make([]baiduTool, 0)
	for _, tool := range req.Config.Tools {
		if tool == nil || len(tool.FunctionDeclarations) == 0 {
			continue
		}
		for _, declaration := range tool.FunctionDeclarations {
			if declaration == nil || strings.TrimSpace(declaration.Name) == "" {
				continue
			}
			tools = append(tools, baiduTool{
				Type: "function",
				Function: baiduToolFunction{
					Name:        declaration.Name,
					Description: declaration.Description,
					Parameters:  buildToolParameters(declaration),
				},
			})
		}
	}

	if len(tools) == 0 {
		return nil
	}
	return tools
}

func buildToolParameters(declaration *genai.FunctionDeclaration) any {
	if declaration == nil {
		return nil
	}
	if declaration.ParametersJsonSchema != nil {
		return sanitizeJSONSchemaValue(declaration.ParametersJsonSchema)
	}
	if declaration.Parameters == nil {
		return map[string]any{"type": "object", "properties": map[string]any{}}
	}
	converted, ok := convertSchemaToJSONObject(declaration.Parameters).(map[string]any)
	if !ok {
		return map[string]any{"type": "object", "properties": map[string]any{}}
	}
	return sanitizeJSONSchemaValue(converted)
}

func convertSchemaToJSONObject(schema *genai.Schema) any {
	if schema == nil {
		return nil
	}

	result := map[string]any{}
	if typeName := mapSchemaType(schema.Type); typeName != "" {
		result["type"] = typeName
	}
	if schema.Description != "" {
		result["description"] = schema.Description
	}
	if schema.Format != "" {
		result["format"] = strings.ToLower(schema.Format)
	}
	if len(schema.Enum) > 0 {
		result["enum"] = schema.Enum
	}
	if schema.Default != nil {
		result["default"] = schema.Default
	}
	if schema.Example != nil {
		result["example"] = schema.Example
	}
	if len(schema.Required) > 0 {
		result["required"] = schema.Required
	}
	if len(schema.PropertyOrdering) > 0 {
		result["propertyOrdering"] = schema.PropertyOrdering
	}
	if schema.Pattern != "" {
		result["pattern"] = schema.Pattern
	}
	if schema.Nullable != nil {
		result["nullable"] = *schema.Nullable
	}
	if schema.Items != nil {
		result["items"] = convertSchemaToJSONObject(schema.Items)
	}
	if len(schema.Properties) > 0 {
		properties := make(map[string]any, len(schema.Properties))
		for name, property := range schema.Properties {
			properties[name] = convertSchemaToJSONObject(property)
		}
		result["properties"] = properties
	}
	if len(schema.AnyOf) > 0 {
		anyOf := make([]any, 0, len(schema.AnyOf))
		for _, item := range schema.AnyOf {
			anyOf = append(anyOf, convertSchemaToJSONObject(item))
		}
		result["anyOf"] = anyOf
	}
	if schema.MinItems != nil {
		result["minItems"] = *schema.MinItems
	}
	if schema.MaxItems != nil {
		result["maxItems"] = *schema.MaxItems
	}
	if schema.MinLength != nil {
		result["minLength"] = *schema.MinLength
	}
	if schema.MaxLength != nil {
		result["maxLength"] = *schema.MaxLength
	}
	if schema.MinProperties != nil {
		result["minProperties"] = *schema.MinProperties
	}
	if schema.MaxProperties != nil {
		result["maxProperties"] = *schema.MaxProperties
	}
	if schema.Minimum != nil {
		result["minimum"] = *schema.Minimum
	}
	if schema.Maximum != nil {
		result["maximum"] = *schema.Maximum
	}
	return result
}

func mapSchemaType(schemaType genai.Type) string {
	switch strings.ToUpper(string(schemaType)) {
	case "OBJECT":
		return "object"
	case "ARRAY":
		return "array"
	case "STRING":
		return "string"
	case "INTEGER":
		return "integer"
	case "NUMBER":
		return "number"
	case "BOOLEAN":
		return "boolean"
	case "NULL":
		return "null"
	default:
		return ""
	}
}

func buildResponseParts(message baiduChatResponseMessage) []*genai.Part {
	parts := make([]*genai.Part, 0, len(message.ToolCalls)+1)
	if strings.TrimSpace(message.Content) != "" {
		parts = append(parts, genai.NewPartFromText(message.Content))
	}
	state := &toolCallHistoryState{}
	for _, toolCall := range message.ToolCalls {
		if strings.TrimSpace(toolCall.Function.Name) == "" {
			continue
		}
		args := map[string]any{}
		if strings.TrimSpace(toolCall.Function.Arguments) != "" {
			if err := json.Unmarshal([]byte(toolCall.Function.Arguments), &args); err != nil {
				parts = append(parts, genai.NewPartFromText(toolCall.Function.Arguments))
				continue
			}
		}
		toolCallID := state.registerCall(toolCall.ID)
		parts = append(parts, &genai.Part{
			FunctionCall: &genai.FunctionCall{
				ID:   toolCallID,
				Name: toolCall.Function.Name,
				Args: args,
			},
		})
	}
	return parts
}

func buildBaiduLLMResponse(
	message baiduChatResponseMessage,
	finishReason string,
	promptTokens int,
	completionTokens int,
	totalTokens int,
	turnComplete bool,
) *model.LLMResponse {
	parts := buildResponseParts(message)
	if len(parts) == 0 {
		parts = []*genai.Part{genai.NewPartFromText("")}
	}

	return &model.LLMResponse{
		Content: &genai.Content{
			Role:  genai.RoleModel,
			Parts: parts,
		},
		FinishReason: mapFinishReason(finishReason),
		UsageMetadata: &genai.GenerateContentResponseUsageMetadata{
			PromptTokenCount:     int32(promptTokens),
			CandidatesTokenCount: int32(completionTokens),
			TotalTokenCount:      int32(totalTokens),
		},
		TurnComplete: turnComplete,
	}
}

type baiduStreamToolCall struct {
	id        string
	typ       string
	name      string
	arguments strings.Builder
}

type baiduStreamState struct {
	text             strings.Builder
	toolCalls        map[int]*baiduStreamToolCall
	finishReason     string
	promptTokens     int
	completionTokens int
	totalTokens      int
}

func (s *baiduStreamState) mergeToolCalls(toolCalls []baiduToolCallDeltaRef) {
	for index, toolCall := range toolCalls {
		resolvedIndex := index
		if toolCall.Index != nil {
			resolvedIndex = *toolCall.Index
		}
		accumulator, ok := s.toolCalls[resolvedIndex]
		if !ok {
			accumulator = &baiduStreamToolCall{}
			s.toolCalls[resolvedIndex] = accumulator
		}
		if strings.TrimSpace(toolCall.ID) != "" {
			accumulator.id = toolCall.ID
		}
		if strings.TrimSpace(toolCall.Type) != "" {
			accumulator.typ = toolCall.Type
		}
		if strings.TrimSpace(toolCall.Function.Name) != "" {
			accumulator.name = toolCall.Function.Name
		}
		if toolCall.Function.Arguments != "" {
			accumulator.arguments.WriteString(toolCall.Function.Arguments)
		}
	}
}

func (s *baiduStreamState) snapshotMessage() baiduChatResponseMessage {
	message := baiduChatResponseMessage{
		Role:    "assistant",
		Content: s.text.String(),
	}
	if len(s.toolCalls) == 0 {
		return message
	}

	indices := make([]int, 0, len(s.toolCalls))
	for index := range s.toolCalls {
		indices = append(indices, index)
	}
	sort.Ints(indices)

	message.ToolCalls = make([]baiduToolCallRef, 0, len(indices))
	for _, index := range indices {
		toolCall := s.toolCalls[index]
		if toolCall == nil || strings.TrimSpace(toolCall.name) == "" {
			continue
		}
		message.ToolCalls = append(message.ToolCalls, baiduToolCallRef{
			ID:   toolCall.id,
			Type: ifEmpty(toolCall.typ, "function"),
			Function: baiduToolCallRefPayload{
				Name:      toolCall.name,
				Arguments: toolCall.arguments.String(),
			},
		})
	}
	return message
}

func marshalJSONObject(value map[string]any) string {
	if value == nil {
		return "{}"
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func sanitizeJSONSchemaValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return sanitizeJSONSchemaObject(typed)
	case []any:
		items := make([]any, 0, len(typed))
		for _, item := range typed {
			items = append(items, sanitizeJSONSchemaValue(item))
		}
		return items
	default:
		return value
	}
}

func sanitizeJSONSchemaObject(schema map[string]any) map[string]any {
	if schema == nil {
		return map[string]any{}
	}

	sanitized := make(map[string]any, len(schema))
	for key, value := range schema {
		switch key {
		case "nullable", "propertyOrdering":
			continue
		case "type":
			sanitizedType, keepType := sanitizeJSONSchemaType(value)
			if keepType {
				sanitized[key] = sanitizedType
			}
		default:
			sanitized[key] = sanitizeJSONSchemaValue(value)
		}
	}

	return sanitized
}

func sanitizeJSONSchemaType(value any) (any, bool) {
	types, ok := value.([]any)
	if !ok {
		return value, true
	}

	filtered := make([]string, 0, len(types))
	for _, item := range types {
		typeName, ok := item.(string)
		if !ok {
			continue
		}
		if strings.EqualFold(typeName, "null") {
			continue
		}
		filtered = append(filtered, strings.ToLower(typeName))
	}

	switch len(filtered) {
	case 0:
		return nil, false
	case 1:
		return filtered[0], true
	default:
		values := make([]any, 0, len(filtered))
		for _, item := range filtered {
			values = append(values, item)
		}
		return values, true
	}
}

func mapRole(role string) string {
	switch role {
	case "user":
		return "user"
	case "model", "assistant":
		return "assistant"
	case "system":
		return "system"
	default:
		return "user"
	}
}
