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
		client:   newStreamingHTTPClient(),
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
			Stream:    true,
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
		payload.Thinking = buildMinimaxThinkingConfig(payload.Model, payload.MaxTokens)

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

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
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
			if err := json.Unmarshal(raw, &parsed); err == nil && parsed.Error != nil {
				yield(nil, fmt.Errorf("minimax api error: type=%s message=%s", parsed.Error.Type, parsed.Error.Message))
				return
			}
			yield(nil, fmt.Errorf("minimax api error: status=%d body=%s", resp.StatusCode, string(raw)))
			return
		}

		if isEventStreamContentType(resp.Header.Get("Content-Type")) {
			raw, err := m.streamResponse(resp.Body, yield)
			if traceErr := m.emitTrace("Model HTTP response", raw); traceErr != nil {
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

		yield(buildMinimaxLLMResponse(parsed.Content, parsed.StopReason, parsed.Usage.InputTokens, parsed.Usage.OutputTokens, true), nil)
	}
}

func (m *MinimaxLLM) streamResponse(
	body io.Reader,
	yield func(*model.LLMResponse, error) bool,
) (string, error) {
	state := minimaxStreamState{
		blocks: make(map[int]*minimaxStreamBlock),
	}
	var emitted bool
	var completed bool

	yieldIncrement := func(response *model.LLMResponse) bool {
		return yieldMinimaxStreamResponse(response, yield)
	}

	raw, err := consumeSSEStream(body, func(event sseEvent) error {
		data := strings.TrimSpace(event.Data)
		if data == "" {
			return nil
		}

		var header struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal([]byte(data), &header); err != nil {
			return err
		}

		switch header.Type {
		case "message_start":
			var payload struct {
				Message struct {
					Usage struct {
						InputTokens  int `json:"input_tokens"`
						OutputTokens int `json:"output_tokens"`
					} `json:"usage"`
				} `json:"message"`
			}
			if err := json.Unmarshal([]byte(data), &payload); err != nil {
				return err
			}
			state.inputTokens = payload.Message.Usage.InputTokens
			state.outputTokens = payload.Message.Usage.OutputTokens
		case "content_block_start":
			var payload struct {
				Index        int                 `json:"index"`
				ContentBlock minimaxContentBlock `json:"content_block"`
			}
			if err := json.Unmarshal([]byte(data), &payload); err != nil {
				return err
			}
			state.ensureBlock(payload.Index).block = payload.ContentBlock
		case "content_block_delta":
			var payload struct {
				Index int `json:"index"`
				Delta struct {
					Type        string `json:"type"`
					Text        string `json:"text"`
					Thinking    string `json:"thinking"`
					Signature   string `json:"signature"`
					PartialJSON string `json:"partial_json"`
				} `json:"delta"`
			}
			if err := json.Unmarshal([]byte(data), &payload); err != nil {
				return err
			}
			block := state.ensureBlock(payload.Index)
			switch payload.Delta.Type {
			case "thinking_delta":
				block.block.Type = "thinking"
				block.block.Thinking += payload.Delta.Thinking
				if payload.Delta.Signature != "" {
					block.block.Signature += payload.Delta.Signature
				}
				if strings.TrimSpace(block.block.Thinking) != "" {
					emitted = true
					if !yieldIncrement(buildMinimaxLLMResponse(state.snapshot(), state.stopReason, state.inputTokens, state.outputTokens, false)) {
						return io.EOF
					}
				}
			case "signature_delta":
				block.block.Type = "thinking"
				block.block.Signature += payload.Delta.Signature
			case "text_delta":
				block.block.Type = "text"
				block.block.Text += payload.Delta.Text
				if strings.TrimSpace(block.block.Text) != "" {
					emitted = true
					if !yieldIncrement(buildMinimaxLLMResponse(state.snapshot(), state.stopReason, state.inputTokens, state.outputTokens, false)) {
						return io.EOF
					}
				}
			case "input_json_delta":
				block.inputJSON.WriteString(payload.Delta.PartialJSON)
			}
		case "content_block_stop":
			var payload struct {
				Index int `json:"index"`
			}
			if err := json.Unmarshal([]byte(data), &payload); err != nil {
				return err
			}
			state.finalizeBlock(payload.Index)
		case "message_delta":
			var payload struct {
				Delta struct {
					StopReason string `json:"stop_reason"`
				} `json:"delta"`
				Usage struct {
					OutputTokens int `json:"output_tokens"`
				} `json:"usage"`
			}
			if err := json.Unmarshal([]byte(data), &payload); err != nil {
				return err
			}
			if strings.TrimSpace(payload.Delta.StopReason) != "" {
				state.stopReason = payload.Delta.StopReason
			}
			if payload.Usage.OutputTokens > 0 {
				state.outputTokens = payload.Usage.OutputTokens
			}
		case "error":
			var payload struct {
				Error struct {
					Type    string `json:"type"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal([]byte(data), &payload); err != nil {
				return err
			}
			return fmt.Errorf("minimax api error: type=%s message=%s", payload.Error.Type, payload.Error.Message)
		case "message_stop":
			state.finalizeAll()
			if !yield(buildMinimaxLLMResponse(state.snapshot(), state.stopReason, state.inputTokens, state.outputTokens, true), nil) {
				return io.EOF
			}
			emitted = true
			completed = true
		}

		return nil
	})
	if err != nil && err != io.EOF {
		return raw, err
	}
	if err == io.EOF {
		return raw, nil
	}

	state.finalizeAll()
	if !completed && (!emitted || len(state.snapshot()) > 0) {
		yield(buildMinimaxLLMResponse(state.snapshot(), state.stopReason, state.inputTokens, state.outputTokens, true), nil)
	}
	return raw, nil
}

func yieldMinimaxStreamResponse(
	response *model.LLMResponse,
	yield func(*model.LLMResponse, error) bool,
) bool {
	if response == nil {
		return true
	}
	next := cloneMinimaxLLMResponse(response)
	next.Partial = true
	return yield(next, nil)
}

func cloneMinimaxLLMResponse(response *model.LLMResponse) *model.LLMResponse {
	if response == nil {
		return nil
	}
	next := *response
	if response.Content != nil {
		content := *response.Content
		content.Parts = cloneGenAIParts(response.Content.Parts)
		next.Content = &content
	}
	return &next
}

func cloneGenAIParts(parts []*genai.Part) []*genai.Part {
	if len(parts) == 0 {
		return nil
	}
	cloned := make([]*genai.Part, 0, len(parts))
	for _, part := range parts {
		if part == nil {
			cloned = append(cloned, nil)
			continue
		}
		next := *part
		if part.FunctionCall != nil {
			functionCall := *part.FunctionCall
			functionCall.Args = cloneStringAnyMap(part.FunctionCall.Args)
			next.FunctionCall = &functionCall
		}
		if part.FunctionResponse != nil {
			functionResponse := *part.FunctionResponse
			functionResponse.Response = cloneStringAnyMap(part.FunctionResponse.Response)
			next.FunctionResponse = &functionResponse
		}
		cloned = append(cloned, &next)
	}
	return cloned
}

func cloneStringAnyMap(value map[string]any) map[string]any {
	if len(value) == 0 {
		return nil
	}
	cloned := make(map[string]any, len(value))
	for key, item := range value {
		cloned[key] = item
	}
	return cloned
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

func shouldEnableMinimaxThinking(model string) bool {
	normalized := strings.ToLower(strings.TrimSpace(model))
	return strings.Contains(normalized, "minimax-m2")
}

func buildMinimaxThinkingConfig(model string, maxTokens int) *minimaxThinkingConfig {
	if !shouldEnableMinimaxThinking(model) || maxTokens <= 1024 {
		return nil
	}

	budget := maxTokens / 2
	if budget > 2048 {
		budget = 2048
	}
	if budget < 1024 {
		budget = 1024
	}
	if budget >= maxTokens {
		budget = maxTokens - 1
	}

	return &minimaxThinkingConfig{
		Type:         "enabled",
		BudgetTokens: budget,
	}
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

	return systemPrompt, normalizeMinimaxMessages(messages)
}

type minimaxPendingToolUseRef struct {
	messageIndex int
	blockIndex   int
}

func normalizeMinimaxMessages(messages []minimaxMessage) []minimaxMessage {
	if len(messages) == 0 {
		return nil
	}

	normalized := make([]minimaxMessage, 0, len(messages))
	pendingRefs := make(map[string]minimaxPendingToolUseRef)
	pendingOrder := make([]string, 0)

	prunePendingToolUses := func() {
		for _, toolUseID := range pendingOrder {
			ref, ok := pendingRefs[toolUseID]
			if !ok {
				continue
			}
			if ref.messageIndex < 0 || ref.messageIndex >= len(normalized) {
				continue
			}
			message := &normalized[ref.messageIndex]
			if ref.blockIndex < 0 || ref.blockIndex >= len(message.Content) {
				continue
			}
			message.Content[ref.blockIndex] = minimaxContentBlock{}
		}
		pendingRefs = make(map[string]minimaxPendingToolUseRef)
		pendingOrder = pendingOrder[:0]
	}

	for _, message := range messages {
		if len(pendingRefs) > 0 {
			if message.Role == "user" && isMinimaxToolResultOnlyMessage(message) {
				filteredContent := make([]minimaxContentBlock, 0, len(message.Content))
				for _, block := range message.Content {
					toolUseID := strings.TrimSpace(block.ToolUseID)
					if block.Type != "tool_result" || toolUseID == "" {
						continue
					}
					if _, ok := pendingRefs[toolUseID]; !ok {
						continue
					}
					delete(pendingRefs, toolUseID)
					filteredContent = append(filteredContent, block)
				}
				if len(filteredContent) > 0 {
					message.Content = filteredContent
					normalized = append(normalized, message)
				}
				if len(pendingRefs) == 0 {
					pendingOrder = pendingOrder[:0]
				}
				continue
			}

			prunePendingToolUses()
			normalized = compactMinimaxMessages(normalized)
		}

		if message.Role == "user" && isMinimaxToolResultOnlyMessage(message) {
			continue
		}

		messageIndex := len(normalized)
		normalized = append(normalized, message)
		for blockIndex, block := range message.Content {
			if block.Type != "tool_use" {
				continue
			}
			toolUseID := strings.TrimSpace(block.ID)
			if toolUseID == "" {
				continue
			}
			pendingRefs[toolUseID] = minimaxPendingToolUseRef{
				messageIndex: messageIndex,
				blockIndex:   blockIndex,
			}
			pendingOrder = append(pendingOrder, toolUseID)
		}
	}

	if len(pendingRefs) > 0 {
		prunePendingToolUses()
	}

	return compactMinimaxMessages(normalized)
}

func compactMinimaxMessages(messages []minimaxMessage) []minimaxMessage {
	compacted := make([]minimaxMessage, 0, len(messages))
	for _, message := range messages {
		filteredContent := make([]minimaxContentBlock, 0, len(message.Content))
		for _, block := range message.Content {
			if strings.TrimSpace(block.Type) == "" {
				continue
			}
			filteredContent = append(filteredContent, block)
		}
		if len(filteredContent) == 0 {
			continue
		}
		message.Content = filteredContent
		compacted = append(compacted, message)
	}
	return compacted
}

func isMinimaxToolResultOnlyMessage(message minimaxMessage) bool {
	if message.Role != "user" || len(message.Content) == 0 {
		return false
	}
	for _, block := range message.Content {
		if block.Type != "tool_result" {
			return false
		}
	}
	return true
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
		if part.Thought && part.Text != "" {
			message.Content = append(message.Content, minimaxContentBlock{
				Type:      "thinking",
				Thinking:  part.Text,
				Signature: string(part.ThoughtSignature),
			})
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
		case "thinking":
			if strings.TrimSpace(block.Thinking) != "" {
				parts = append(parts, &genai.Part{
					Text:             block.Thinking,
					Thought:          true,
					ThoughtSignature: []byte(block.Signature),
				})
			}
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

func buildMinimaxLLMResponse(
	content []minimaxContentBlock,
	stopReason string,
	inputTokens int,
	outputTokens int,
	turnComplete bool,
) *model.LLMResponse {
	parts := buildMinimaxResponseParts(content)
	if len(parts) == 0 {
		parts = []*genai.Part{genai.NewPartFromText("")}
	}

	return &model.LLMResponse{
		Content: &genai.Content{
			Role:  genai.RoleModel,
			Parts: parts,
		},
		FinishReason: mapMinimaxFinishReason(stopReason),
		UsageMetadata: &genai.GenerateContentResponseUsageMetadata{
			PromptTokenCount:     int32(inputTokens),
			CandidatesTokenCount: int32(outputTokens),
			TotalTokenCount:      int32(inputTokens + outputTokens),
		},
		TurnComplete: turnComplete,
	}
}

type minimaxStreamBlock struct {
	block     minimaxContentBlock
	inputJSON strings.Builder
	complete  bool
}

type minimaxStreamState struct {
	blocks       map[int]*minimaxStreamBlock
	stopReason   string
	inputTokens  int
	outputTokens int
}

func (s *minimaxStreamState) ensureBlock(index int) *minimaxStreamBlock {
	if block, ok := s.blocks[index]; ok {
		return block
	}
	block := &minimaxStreamBlock{}
	s.blocks[index] = block
	return block
}

func (s *minimaxStreamState) finalizeBlock(index int) {
	block, ok := s.blocks[index]
	if !ok {
		return
	}
	if block.block.Type == "tool_use" && block.inputJSON.Len() > 0 {
		var args map[string]any
		if err := json.Unmarshal([]byte(block.inputJSON.String()), &args); err == nil {
			block.block.Input = args
		}
	}
	block.complete = true
}

func (s *minimaxStreamState) finalizeAll() {
	for index := range s.blocks {
		s.finalizeBlock(index)
	}
}

func (s *minimaxStreamState) snapshot() []minimaxContentBlock {
	if len(s.blocks) == 0 {
		return nil
	}
	indices := make([]int, 0, len(s.blocks))
	for index := range s.blocks {
		indices = append(indices, index)
	}
	sort.Ints(indices)

	blocks := make([]minimaxContentBlock, 0, len(indices))
	for _, index := range indices {
		block := s.blocks[index]
		if block == nil {
			continue
		}
		if block.block.Type == "tool_use" && !block.complete {
			continue
		}
		blocks = append(blocks, block.block)
	}
	return blocks
}

type minimaxChatRequest struct {
	Model         string                 `json:"model"`
	System        string                 `json:"system,omitempty"`
	Messages      []minimaxMessage       `json:"messages"`
	Tools         []minimaxTool          `json:"tools,omitempty"`
	ToolChoice    *minimaxToolChoice     `json:"tool_choice,omitempty"`
	Thinking      *minimaxThinkingConfig `json:"thinking,omitempty"`
	MaxTokens     int                    `json:"max_tokens"`
	Stream        bool                   `json:"stream,omitempty"`
	Temperature   *float32               `json:"temperature,omitempty"`
	TopP          *float32               `json:"top_p,omitempty"`
	StopSequences []string               `json:"stop_sequences,omitempty"`
}

type minimaxThinkingConfig struct {
	Type         string `json:"type"`
	BudgetTokens int    `json:"budget_tokens,omitempty"`
}

type minimaxMessage struct {
	Role    string                `json:"role"`
	Content []minimaxContentBlock `json:"content"`
}

type minimaxContentBlock struct {
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	Thinking  string `json:"thinking,omitempty"`
	Signature string `json:"signature,omitempty"`
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
