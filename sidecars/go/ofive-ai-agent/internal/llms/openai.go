// Package llms provides concrete ADK model.LLM implementations used by the sidecar.
package llms

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"iter"
	"os"
	"sort"
	"strings"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/shared"
	"google.golang.org/adk/model"
	"google.golang.org/genai"
)

// OpenAICompatibleLLM implements ADK's model.LLM through OpenAI Chat Completions.
type OpenAICompatibleLLM struct {
	name    string
	baseURL string
	model   string
	apiKey  string
	client  openai.Client
	trace   func(title string, text string) error
}

// NewOpenAICompatibleLLM creates an OpenAI Chat Completions-compatible adapter.
func NewOpenAICompatibleLLM(name, baseURL, modelName, apiKey string) *OpenAICompatibleLLM {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = strings.TrimSpace(os.Getenv("OPENAI_BASE_URL"))
	}
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		modelName = strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	}

	client := openai.NewClient(
		option.WithAPIKey(apiKey),
		option.WithBaseURL(baseURL),
		option.WithHTTPClient(newStreamingHTTPClient()),
		option.WithHeader("User-Agent", "ofive-ai-sidecar"),
	)

	return &OpenAICompatibleLLM{
		name:    ifEmpty(name, "openai-compatible"),
		baseURL: baseURL,
		model:   modelName,
		apiKey:  apiKey,
		client:  client,
	}
}

// Name returns the configured provider identifier.
func (o *OpenAICompatibleLLM) Name() string { return o.name }

// SetTraceEmitter configures a debug trace sink for raw request/response logging.
func (o *OpenAICompatibleLLM) SetTraceEmitter(trace func(title string, text string) error) {
	o.trace = trace
}

// GenerateContent implements model.LLM.
func (o *OpenAICompatibleLLM) GenerateContent(
	ctx context.Context,
	req *model.LLMRequest,
	_ bool,
) iter.Seq2[*model.LLMResponse, error] {
	return func(yield func(*model.LLMResponse, error) bool) {
		requestModel := o.resolveRequestModel(req.Model)
		if strings.TrimSpace(requestModel) == "" {
			yield(nil, fmt.Errorf("openai-compatible model is required; refresh the model list and save a supported model first"))
			return
		}

		params := openai.ChatCompletionNewParams{
			Messages: buildOpenAIMessages(req),
			Model:    shared.ChatModel(requestModel),
		}
		params.Tools = buildOpenAITools(req)
		if len(params.Tools) > 0 {
			params.ToolChoice = openai.ChatCompletionToolChoiceOptionUnionParam{
				OfAuto: openai.String("auto"),
			}
		}
		applyOpenAIRequestConfig(&params, req)

		body, err := json.Marshal(params)
		if err != nil {
			yield(nil, err)
			return
		}
		if err := o.emitTrace("Model HTTP request", prettyJSON(body)); err != nil {
			yield(nil, err)
			return
		}

		stream := o.client.Chat.Completions.NewStreaming(ctx, params)
		raw, err := o.streamResponse(stream, yield)
		if traceErr := o.emitTrace("Model HTTP response", raw); traceErr != nil {
			yield(nil, traceErr)
			return
		}
		if err != nil {
			yield(nil, err)
		}
	}
}

type openAIStream interface {
	Next() bool
	Current() openai.ChatCompletionChunk
	Err() error
}

func (o *OpenAICompatibleLLM) streamResponse(
	stream openAIStream,
	yield func(*model.LLMResponse, error) bool,
) (string, error) {
	state := openAIStreamState{
		toolCalls: make(map[int]*openAIStreamToolCall),
	}
	var raw strings.Builder
	var emitted bool

	for stream.Next() {
		chunk := stream.Current()
		if chunk.RawJSON() != "" {
			raw.WriteString(chunk.RawJSON())
			raw.WriteByte('\n')
		} else if encoded, err := json.Marshal(chunk); err == nil {
			raw.Write(encoded)
			raw.WriteByte('\n')
		}

		if chunk.Usage.PromptTokens > 0 {
			state.promptTokens = int(chunk.Usage.PromptTokens)
		}
		if chunk.Usage.CompletionTokens > 0 {
			state.completionTokens = int(chunk.Usage.CompletionTokens)
		}
		if chunk.Usage.TotalTokens > 0 {
			state.totalTokens = int(chunk.Usage.TotalTokens)
		}

		textUpdated := false
		for _, choice := range chunk.Choices {
			if choice.Delta.Content != "" {
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
			if !yield(buildOpenAILLMResponse(state.snapshotMessage(), state.finishReason, state.promptTokens, state.completionTokens, state.totalTokens, false), nil) {
				return raw.String(), nil
			}
		}
	}

	if err := stream.Err(); err != nil {
		return raw.String(), err
	}

	if !emitted || strings.TrimSpace(state.text.String()) != "" || len(state.toolCalls) > 0 {
		yield(buildOpenAILLMResponse(state.snapshotMessage(), state.finishReason, state.promptTokens, state.completionTokens, state.totalTokens, true), nil)
	}
	return raw.String(), nil
}

func (o *OpenAICompatibleLLM) emitTrace(title string, text string) error {
	if o.trace == nil || strings.TrimSpace(text) == "" {
		return nil
	}
	return o.trace(title, text)
}

func (o *OpenAICompatibleLLM) resolveRequestModel(requestModel string) string {
	configuredModel := strings.TrimSpace(o.model)
	if configuredModel != "" {
		return configuredModel
	}

	trimmedRequestModel := strings.TrimSpace(requestModel)
	if trimmedRequestModel == "" {
		return ""
	}
	if trimmedRequestModel == strings.TrimSpace(o.name) {
		return ""
	}

	return trimmedRequestModel
}

func applyOpenAIRequestConfig(params *openai.ChatCompletionNewParams, req *model.LLMRequest) {
	if params == nil || req == nil || req.Config == nil {
		return
	}

	if req.Config.Temperature != nil {
		params.Temperature = openai.Float(float64(*req.Config.Temperature))
	}
	if req.Config.TopP != nil {
		params.TopP = openai.Float(float64(*req.Config.TopP))
	}
	if req.Config.MaxOutputTokens > 0 {
		params.MaxTokens = openai.Int(int64(req.Config.MaxOutputTokens))
	}
	if len(req.Config.StopSequences) > 0 {
		params.Stop = openai.ChatCompletionNewParamsStopUnion{
			OfStringArray: req.Config.StopSequences,
		}
	}
	if req.Config.PresencePenalty != nil {
		params.PresencePenalty = openai.Float(float64(*req.Config.PresencePenalty))
	}
	if req.Config.FrequencyPenalty != nil {
		params.FrequencyPenalty = openai.Float(float64(*req.Config.FrequencyPenalty))
	}
	if req.Config.Seed != nil {
		params.Seed = openai.Int(int64(*req.Config.Seed))
	}
	if req.Config.ResponseMIMEType == "application/json" {
		responseFormat := shared.NewResponseFormatJSONObjectParam()
		params.ResponseFormat = openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONObject: &responseFormat,
		}
	}
}

func buildOpenAIMessages(req *model.LLMRequest) []openai.ChatCompletionMessageParamUnion {
	if req == nil {
		return nil
	}

	messages := make([]openai.ChatCompletionMessageParamUnion, 0, len(req.Contents)+1)
	if req.Config != nil && req.Config.SystemInstruction != nil {
		if systemText := extractText(req.Config.SystemInstruction); systemText != "" {
			messages = append(messages, openai.SystemMessage(systemText))
		}
	}

	state := &toolCallHistoryState{}
	for _, content := range req.Contents {
		messages = append(messages, convertContentToOpenAIMessages(content, state)...)
	}
	return messages
}

func convertContentToOpenAIMessages(
	content *genai.Content,
	state *toolCallHistoryState,
) []openai.ChatCompletionMessageParamUnion {
	if content == nil {
		return nil
	}

	role := mapRole(string(content.Role))
	messages := make([]openai.ChatCompletionMessageParamUnion, 0, len(content.Parts))
	var textBuilder bytes.Buffer
	flushText := func() {
		if textBuilder.Len() == 0 {
			return
		}
		text := textBuilder.String()
		textBuilder.Reset()
		switch role {
		case "assistant":
			messages = append(messages, openai.AssistantMessage(text))
		case "system":
			messages = append(messages, openai.SystemMessage(text))
		default:
			messages = append(messages, openai.UserMessage(text))
		}
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
			messages = append(messages, openai.ChatCompletionMessageParamUnion{
				OfAssistant: &openai.ChatCompletionAssistantMessageParam{
					ToolCalls: []openai.ChatCompletionMessageToolCallParam{{
						ID: toolCallID,
						Function: openai.ChatCompletionMessageToolCallFunctionParam{
							Name:      part.FunctionCall.Name,
							Arguments: marshalJSONObject(part.FunctionCall.Args),
						},
					}},
				},
			})
			continue
		}

		if part.FunctionResponse != nil {
			toolCallID := state.resolveResponse(part.FunctionResponse.ID)
			messages = append(messages, openai.ToolMessage(
				marshalJSONObject(part.FunctionResponse.Response),
				toolCallID,
			))
		}
	}

	flushText()
	return messages
}

func buildOpenAITools(req *model.LLMRequest) []openai.ChatCompletionToolParam {
	if req == nil || req.Config == nil || len(req.Config.Tools) == 0 {
		return nil
	}

	tools := make([]openai.ChatCompletionToolParam, 0)
	for _, tool := range req.Config.Tools {
		if tool == nil || len(tool.FunctionDeclarations) == 0 {
			continue
		}
		for _, declaration := range tool.FunctionDeclarations {
			if declaration == nil || strings.TrimSpace(declaration.Name) == "" {
				continue
			}
			tools = append(tools, openai.ChatCompletionToolParam{
				Function: shared.FunctionDefinitionParam{
					Name:        declaration.Name,
					Description: openai.String(declaration.Description),
					Parameters:  buildOpenAIFunctionParameters(declaration),
				},
			})
		}
	}

	if len(tools) == 0 {
		return nil
	}
	return tools
}

func buildOpenAIFunctionParameters(declaration *genai.FunctionDeclaration) shared.FunctionParameters {
	parameters, ok := buildToolParameters(declaration).(map[string]any)
	if !ok || parameters == nil {
		return shared.FunctionParameters{"type": "object", "properties": map[string]any{}}
	}
	return shared.FunctionParameters(parameters)
}

type openAIChatResponseMessage struct {
	Content   string
	ToolCalls []openAIToolCallRef
}

type openAIToolCallRef struct {
	ID        string
	Type      string
	Name      string
	Arguments string
}

type openAIStreamToolCall struct {
	id        string
	typ       string
	name      string
	arguments strings.Builder
}

type openAIStreamState struct {
	text             strings.Builder
	toolCalls        map[int]*openAIStreamToolCall
	finishReason     string
	promptTokens     int
	completionTokens int
	totalTokens      int
}

func (s *openAIStreamState) mergeToolCalls(toolCalls []openai.ChatCompletionChunkChoiceDeltaToolCall) {
	for fallbackIndex, toolCall := range toolCalls {
		index := int(toolCall.Index)
		if index < 0 {
			index = fallbackIndex
		}
		accumulator, ok := s.toolCalls[index]
		if !ok {
			accumulator = &openAIStreamToolCall{}
			s.toolCalls[index] = accumulator
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

func (s *openAIStreamState) snapshotMessage() openAIChatResponseMessage {
	message := openAIChatResponseMessage{Content: s.text.String()}
	if len(s.toolCalls) == 0 {
		return message
	}

	indices := make([]int, 0, len(s.toolCalls))
	for index := range s.toolCalls {
		indices = append(indices, index)
	}
	sort.Ints(indices)

	message.ToolCalls = make([]openAIToolCallRef, 0, len(indices))
	for _, index := range indices {
		toolCall := s.toolCalls[index]
		if toolCall == nil || strings.TrimSpace(toolCall.name) == "" {
			continue
		}
		message.ToolCalls = append(message.ToolCalls, openAIToolCallRef{
			ID:        toolCall.id,
			Type:      ifEmpty(toolCall.typ, "function"),
			Name:      toolCall.name,
			Arguments: toolCall.arguments.String(),
		})
	}
	return message
}

func buildOpenAIResponseParts(message openAIChatResponseMessage) []*genai.Part {
	parts := make([]*genai.Part, 0, len(message.ToolCalls)+1)
	if strings.TrimSpace(message.Content) != "" {
		parts = append(parts, genai.NewPartFromText(message.Content))
	}

	state := &toolCallHistoryState{}
	for _, toolCall := range message.ToolCalls {
		if strings.TrimSpace(toolCall.Name) == "" {
			continue
		}
		args := map[string]any{}
		if strings.TrimSpace(toolCall.Arguments) != "" {
			if err := json.Unmarshal([]byte(toolCall.Arguments), &args); err != nil {
				parts = append(parts, genai.NewPartFromText(toolCall.Arguments))
				continue
			}
		}
		parts = append(parts, &genai.Part{
			FunctionCall: &genai.FunctionCall{
				ID:   state.registerCall(toolCall.ID),
				Name: toolCall.Name,
				Args: args,
			},
		})
	}
	return parts
}

func buildOpenAILLMResponse(
	message openAIChatResponseMessage,
	finishReason string,
	promptTokens int,
	completionTokens int,
	totalTokens int,
	turnComplete bool,
) *model.LLMResponse {
	parts := buildOpenAIResponseParts(message)
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
