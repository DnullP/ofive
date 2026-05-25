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

const maxOpenAICompatibleStreamRetries = 2

// OpenAICompatibleLLM implements ADK's model.LLM through OpenAI Chat Completions.
type OpenAICompatibleLLM struct {
	name                 string
	providerLabel        string
	baseURL              string
	model                string
	apiKey               string
	includeInstructions  bool
	missingModelHintName string
	client               openai.Client
	trace                func(title string, text string) error
}

// NewOpenAICompatibleLLM creates an OpenAI Chat Completions-compatible adapter.
func NewOpenAICompatibleLLM(name, baseURL, modelName, apiKey string) *OpenAICompatibleLLM {
	return newOpenAICompatibleLLM(openAICompatibleConfig{
		name:                 ifEmpty(name, "openai-compatible"),
		providerLabel:        "openai-compatible",
		baseURL:              baseURL,
		modelName:            modelName,
		apiKey:               apiKey,
		defaultBaseURL:       "https://api.openai.com/v1",
		modelEnv:             "OPENAI_MODEL",
		baseURLEnv:           "OPENAI_BASE_URL",
		apiKeyEnv:            "OPENAI_API_KEY",
		missingModelHintName: "openai-compatible",
	})
}

// NewCodexCompatibleLLM creates a Codex/agent-compatible adapter backed by a
// Chat Completions-shaped endpoint that also requires top-level instructions.
func NewCodexCompatibleLLM(name, baseURL, modelName, apiKey string) *OpenAICompatibleLLM {
	return newOpenAICompatibleLLM(openAICompatibleConfig{
		name:                 ifEmpty(name, "codex-compatible"),
		providerLabel:        "codex-compatible",
		baseURL:              baseURL,
		modelName:            modelName,
		apiKey:               apiKey,
		defaultBaseURL:       "https://www.api-for-ai.com/v1",
		modelEnv:             "CODEX_MODEL",
		baseURLEnv:           "CODEX_BASE_URL",
		apiKeyEnv:            "CODEX_API_KEY",
		includeInstructions:  true,
		missingModelHintName: "codex-compatible",
	})
}

type openAICompatibleConfig struct {
	name                 string
	providerLabel        string
	baseURL              string
	modelName            string
	apiKey               string
	defaultBaseURL       string
	modelEnv             string
	baseURLEnv           string
	apiKeyEnv            string
	includeInstructions  bool
	missingModelHintName string
}

func newOpenAICompatibleLLM(config openAICompatibleConfig) *OpenAICompatibleLLM {
	baseURL := strings.TrimSpace(config.baseURL)
	if baseURL == "" {
		baseURL = strings.TrimSpace(os.Getenv(config.baseURLEnv))
	}
	if baseURL == "" {
		baseURL = config.defaultBaseURL
	}
	modelName := strings.TrimSpace(config.modelName)
	if modelName == "" {
		modelName = strings.TrimSpace(os.Getenv(config.modelEnv))
	}
	apiKey := strings.TrimSpace(config.apiKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv(config.apiKeyEnv))
	}

	client := openai.NewClient(
		option.WithAPIKey(apiKey),
		option.WithBaseURL(baseURL),
		option.WithHTTPClient(newStreamingHTTPClient()),
		option.WithHeader("User-Agent", "ofive-ai-sidecar"),
	)

	return &OpenAICompatibleLLM{
		name:                 ifEmpty(config.name, "openai-compatible"),
		providerLabel:        ifEmpty(config.providerLabel, "openai-compatible"),
		baseURL:              baseURL,
		model:                modelName,
		apiKey:               apiKey,
		includeInstructions:  config.includeInstructions,
		missingModelHintName: ifEmpty(config.missingModelHintName, "openai-compatible"),
		client:               client,
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
			yield(nil, fmt.Errorf("%s model is required; refresh the model list and save a supported model first", o.missingModelHintName))
			return
		}

		params := openai.ChatCompletionNewParams{
			Messages: buildOpenAIMessages(req),
			Model:    shared.ChatModel(requestModel),
		}
		o.applyProviderSpecificParams(&params, req)
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

		var rawAttempts []string
		for attempt := 0; attempt <= maxOpenAICompatibleStreamRetries; attempt++ {
			stream := o.client.Chat.Completions.NewStreaming(ctx, params)
			allowEmptyTailRecovery := attempt == maxOpenAICompatibleStreamRetries
			result := o.streamResponse(stream, yield, allowEmptyTailRecovery)
			rawAttempts = append(rawAttempts, formatOpenAIStreamAttempt(attempt+1, result.Raw))

			if result.Err == nil {
				if traceErr := o.emitTrace("Model HTTP response", strings.Join(rawAttempts, "\n")); traceErr != nil {
					yield(nil, traceErr)
				}
				return
			}

			if shouldRetryOpenAIStream(ctx, result.Err, result.Emitted) &&
				attempt < maxOpenAICompatibleStreamRetries {
				if err := o.emitTrace(
					"Model HTTP retry",
					fmt.Sprintf(
						"attempt=%d next_attempt=%d error=%s",
						attempt+1,
						attempt+2,
						result.Err.Error(),
					),
				); err != nil {
					yield(nil, err)
					return
				}
				continue
			}

			raw := strings.Join(rawAttempts, "\n")
			if traceErr := o.emitTrace("Model HTTP response", raw); traceErr != nil {
				yield(nil, traceErr)
				return
			}
			yield(nil, o.wrapStreamError(requestModel, raw, result.Err))
			return
		}
	}
}

type openAIStream interface {
	Next() bool
	Current() openai.ChatCompletionChunk
	Err() error
}

type openAIStreamResult struct {
	Raw     string
	Err     error
	Emitted bool
}

func (o *OpenAICompatibleLLM) streamResponse(
	stream openAIStream,
	yield func(*model.LLMResponse, error) bool,
	allowEmptyTailRecovery bool,
) openAIStreamResult {
	state := openAIStreamState{
		toolCalls: make(map[int]*openAIStreamToolCall),
	}
	var raw strings.Builder
	var emitted bool

	for stream.Next() {
		chunk := stream.Current()
		state.receivedChunks++
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
				return openAIStreamResult{Raw: raw.String(), Emitted: emitted}
			}
		}
	}

	rawText := raw.String()
	if err := stream.Err(); err != nil {
		if !allowEmptyTailRecovery || !isRecoverableOpenAIEmptyTailError(err, rawText, state) {
			return openAIStreamResult{Raw: rawText, Err: err, Emitted: emitted}
		}
	}

	if !emitted || strings.TrimSpace(state.text.String()) != "" || len(state.toolCalls) > 0 {
		emitted = true
		yield(buildOpenAILLMResponse(state.snapshotMessage(), state.finishReason, state.promptTokens, state.completionTokens, state.totalTokens, true), nil)
	}
	return openAIStreamResult{Raw: rawText, Emitted: emitted}
}

func (o *OpenAICompatibleLLM) emitTrace(title string, text string) error {
	if o.trace == nil || strings.TrimSpace(text) == "" {
		return nil
	}
	return o.trace(title, text)
}

func (o *OpenAICompatibleLLM) wrapStreamError(model string, raw string, err error) error {
	if err == nil {
		return nil
	}
	summary := summarizeOpenAIStreamRaw(raw, 800)
	if summary == "" {
		return fmt.Errorf("%s stream failed for model %s: %w", o.providerLabel, model, err)
	}
	return fmt.Errorf(
		"%s stream failed for model %s: %w; response_tail=%q",
		o.providerLabel,
		model,
		err,
		summary,
	)
}

func summarizeOpenAIStreamRaw(raw string, limit int) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || limit <= 0 {
		return ""
	}
	if len(trimmed) <= limit {
		return trimmed
	}
	return trimmed[len(trimmed)-limit:]
}

func formatOpenAIStreamAttempt(attempt int, raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fmt.Sprintf("[attempt %d] <empty response>", attempt)
	}
	return fmt.Sprintf("[attempt %d]\n%s", attempt, trimmed)
}

func shouldRetryOpenAIStream(ctx context.Context, err error, emitted bool) bool {
	if err == nil || emitted {
		return false
	}
	if ctx != nil && ctx.Err() != nil {
		return false
	}
	return isRetryableOpenAIStreamError(err)
}

func isRetryableOpenAIStreamError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	for _, fragment := range []string{
		"unexpected end of json input",
		"unexpected eof",
		"connection reset",
		"connection refused",
		"broken pipe",
		"stream closed",
		"server closed",
	} {
		if strings.Contains(message, fragment) {
			return true
		}
	}
	return strings.TrimSpace(message) == "eof"
}

func isRecoverableOpenAIEmptyTailError(err error, raw string, state openAIStreamState) bool {
	if err == nil {
		return false
	}
	if !strings.Contains(strings.ToLower(err.Error()), "unexpected end of json input") {
		return false
	}
	if strings.TrimSpace(raw) == "" {
		return false
	}
	if state.receivedChunks == 0 {
		return false
	}
	return strings.TrimSpace(state.text.String()) == "" && len(state.toolCalls) == 0
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

func (o *OpenAICompatibleLLM) applyProviderSpecificParams(params *openai.ChatCompletionNewParams, req *model.LLMRequest) {
	if params == nil || req == nil || req.Config == nil || req.Config.SystemInstruction == nil {
		return
	}
	if !o.includeInstructions {
		return
	}
	systemText := extractText(req.Config.SystemInstruction)
	if systemText == "" {
		return
	}
	params.SetExtraFields(map[string]any{"instructions": systemText})
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
	receivedChunks   int
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
