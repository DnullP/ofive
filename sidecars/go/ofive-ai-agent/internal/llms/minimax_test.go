package llms

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/adk/model"
	"google.golang.org/genai"
)

func TestMinimaxGenerateContentUsesConfiguredVendorModel(t *testing.T) {
	t.Parallel()

	var capturedRequest minimaxChatRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()

		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if err := json.Unmarshal(body, &capturedRequest); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if apiKey := request.Header.Get("x-api-key"); apiKey != "test-key" {
			t.Fatalf("unexpected x-api-key header: %q", apiKey)
		}
		if version := request.Header.Get("anthropic-version"); version != minimaxAnthropicVersion {
			t.Fatalf("unexpected anthropic-version header: %q", version)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M2.7","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()

	llm := NewMinimaxLLM("minimax-anthropic", server.URL, "MiniMax-M2.7", "test-key")
	request := &model.LLMRequest{
		Model: "minimax-anthropic",
		Contents: []*genai.Content{
			genai.NewContentFromText("你好", genai.RoleUser),
		},
	}

	for _, err := range collectResponses(llm.GenerateContent(context.Background(), request, false)) {
		if err != nil {
			t.Fatalf("GenerateContent returned error: %v", err)
		}
	}

	if capturedRequest.Model != "MiniMax-M2.7" {
		t.Fatalf("expected configured model to be sent, got %q", capturedRequest.Model)
	}
	if len(capturedRequest.Messages) != 1 || capturedRequest.Messages[0].Role != "user" {
		t.Fatalf("unexpected messages payload: %+v", capturedRequest.Messages)
	}
	if got := capturedRequest.Messages[0].Content[0].Text; got != "你好" {
		t.Fatalf("expected text content to be forwarded, got %q", got)
	}
	if !capturedRequest.Stream {
		t.Fatal("expected minimax adapter to enable vendor streaming")
	}
	if capturedRequest.Thinking == nil {
		t.Fatal("expected minimax m2 request to enable thinking")
	}
	if capturedRequest.Thinking.Type != "enabled" {
		t.Fatalf("unexpected thinking type: %q", capturedRequest.Thinking.Type)
	}
	if capturedRequest.Thinking.BudgetTokens <= 0 || capturedRequest.Thinking.BudgetTokens >= capturedRequest.MaxTokens {
		t.Fatalf(
			"expected thinking budget to be positive and below max_tokens, got budget=%d max=%d",
			capturedRequest.Thinking.BudgetTokens,
			capturedRequest.MaxTokens,
		)
	}
}

func TestMinimaxGenerateContentSkipsThinkingWhenMaxTokensTooLow(t *testing.T) {
	t.Parallel()

	var capturedRequest minimaxChatRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()

		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if err := json.Unmarshal(body, &capturedRequest); err != nil {
			t.Fatalf("decode request body: %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M2.7","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()

	llm := NewMinimaxLLM("minimax-anthropic", server.URL, "MiniMax-M2.7", "test-key")
	request := &model.LLMRequest{
		Model: "minimax-anthropic",
		Contents: []*genai.Content{
			genai.NewContentFromText("你好", genai.RoleUser),
		},
		Config: &genai.GenerateContentConfig{
			MaxOutputTokens: 512,
		},
	}

	for _, err := range collectResponses(llm.GenerateContent(context.Background(), request, false)) {
		if err != nil {
			t.Fatalf("GenerateContent returned error: %v", err)
		}
	}

	if capturedRequest.MaxTokens != 512 {
		t.Fatalf("expected configured max tokens to be sent, got %d", capturedRequest.MaxTokens)
	}
	if capturedRequest.Thinking != nil {
		t.Fatalf("expected thinking to be skipped for low max_tokens, got %+v", capturedRequest.Thinking)
	}
}

func TestMinimaxGenerateContentStreamsVendorResponseIntoMultipleYields(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("event: message_start\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"MiniMax-M2.7\",\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_start\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_delta\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"first part \"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_delta\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"second part\"}}\n\n"))
		_, _ = writer.Write([]byte("event: message_delta\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":2}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_stop\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"content_block_stop\",\"index\":0}\n\n"))
		_, _ = writer.Write([]byte("event: message_stop\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"message_stop\"}\n\n"))
	}))
	defer server.Close()

	llm := NewMinimaxLLM("minimax-anthropic", server.URL, "MiniMax-M2.7", "test-key")
	request := &model.LLMRequest{
		Model: "minimax-anthropic",
		Contents: []*genai.Content{
			genai.NewContentFromText("你好", genai.RoleUser),
		},
	}

	responses := make([]*model.LLMResponse, 0)
	for response, err := range llm.GenerateContent(context.Background(), request, false) {
		if err != nil {
			t.Fatalf("GenerateContent returned error: %v", err)
		}
		responses = append(responses, response)
	}

	if len(responses) != 3 {
		t.Fatalf("expected two incremental responses plus final completion, got %d", len(responses))
	}
	if responses[0].Content.Parts[0].Text != "first part " {
		t.Fatalf("expected first incremental text, got %+v", responses[0].Content)
	}
	if responses[1].Content.Parts[0].Text != "first part second part" {
		t.Fatalf("expected accumulated text on second chunk, got %+v", responses[1].Content)
	}
	if !responses[2].TurnComplete || responses[2].Content.Parts[0].Text != "first part second part" {
		t.Fatalf("expected final completed response, got %+v", responses[2])
	}
}

func TestNewMinimaxLLMUsesStreamingHTTPClient(t *testing.T) {
	t.Parallel()

	llm := NewMinimaxLLM("minimax-anthropic", "https://example.com", "MiniMax-M2.7", "test-key")

	if llm.client == nil {
		t.Fatal("expected minimax client to be initialized")
	}
	if llm.client.Timeout != 0 {
		t.Fatalf("expected minimax streaming client to avoid total timeout, got %s", llm.client.Timeout)
	}
}

func TestMinimaxGenerateContentParsesThinkingBlocks(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M2.7","content":[{"type":"thinking","thinking":"step one","signature":"sig-1"},{"type":"text","text":"final answer"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()

	llm := NewMinimaxLLM("minimax-anthropic", server.URL, "MiniMax-M2.7", "test-key")
	request := &model.LLMRequest{
		Model: "minimax-anthropic",
		Contents: []*genai.Content{
			genai.NewContentFromText("你好", genai.RoleUser),
		},
	}

	var responses []*model.LLMResponse
	for response, err := range llm.GenerateContent(context.Background(), request, false) {
		if err != nil {
			t.Fatalf("GenerateContent returned error: %v", err)
		}
		responses = append(responses, response)
	}

	if len(responses) != 1 {
		t.Fatalf("expected one response, got %d", len(responses))
	}
	if len(responses[0].Content.Parts) != 2 {
		t.Fatalf("expected thinking + text parts, got %+v", responses[0].Content)
	}
	if !responses[0].Content.Parts[0].Thought || responses[0].Content.Parts[0].Text != "step one" {
		t.Fatalf("expected first part to be thinking, got %+v", responses[0].Content.Parts[0])
	}
	if string(responses[0].Content.Parts[0].ThoughtSignature) != "sig-1" {
		t.Fatalf("unexpected thought signature: %q", string(responses[0].Content.Parts[0].ThoughtSignature))
	}
	if responses[0].Content.Parts[1].Text != "final answer" {
		t.Fatalf("expected second part to be final text, got %+v", responses[0].Content.Parts[1])
	}
}

func TestBuildMinimaxMessagesPreservesThinkingBlocks(t *testing.T) {
	t.Parallel()

	_, messages := buildMinimaxMessages(&model.LLMRequest{
		Contents: []*genai.Content{
			genai.NewContentFromText("问题", genai.RoleUser),
			{
				Role: genai.RoleModel,
				Parts: []*genai.Part{
					{
						Text:             "先推理",
						Thought:          true,
						ThoughtSignature: []byte("sig-1"),
					},
					genai.NewPartFromText("再回答"),
				},
			},
		},
	})

	if len(messages) != 2 {
		t.Fatalf("expected user + assistant messages, got %+v", messages)
	}
	assistant := messages[1]
	if len(assistant.Content) != 2 {
		t.Fatalf("expected thinking + text blocks, got %+v", assistant.Content)
	}
	if assistant.Content[0].Type != "thinking" || assistant.Content[0].Thinking != "先推理" {
		t.Fatalf("expected first block to be thinking, got %+v", assistant.Content[0])
	}
	if assistant.Content[0].Signature != "sig-1" {
		t.Fatalf("unexpected thinking signature: %q", assistant.Content[0].Signature)
	}
	if assistant.Content[1].Type != "text" || assistant.Content[1].Text != "再回答" {
		t.Fatalf("expected second block to be text, got %+v", assistant.Content[1])
	}
}

func TestMinimaxGenerateContentStreamsThinkingDeltas(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("event: message_start\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"MiniMax-M2.7\",\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_start\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\",\"signature\":\"\"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_delta\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"step one\"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_delta\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"sig-1\"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_stop\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"content_block_stop\",\"index\":0}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_start\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_delta\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"answer\"}}\n\n"))
		_, _ = writer.Write([]byte("event: content_block_stop\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"content_block_stop\",\"index\":1}\n\n"))
		_, _ = writer.Write([]byte("event: message_stop\n"))
		_, _ = writer.Write([]byte("data: {\"type\":\"message_stop\"}\n\n"))
	}))
	defer server.Close()

	llm := NewMinimaxLLM("minimax-anthropic", server.URL, "MiniMax-M2.7", "test-key")
	request := &model.LLMRequest{
		Model: "minimax-anthropic",
		Contents: []*genai.Content{
			genai.NewContentFromText("你好", genai.RoleUser),
		},
	}

	responses := make([]*model.LLMResponse, 0)
	for response, err := range llm.GenerateContent(context.Background(), request, false) {
		if err != nil {
			t.Fatalf("GenerateContent returned error: %v", err)
		}
		responses = append(responses, response)
	}

	if len(responses) != 3 {
		t.Fatalf("expected thinking, text, and final completion responses, got %d", len(responses))
	}
	if !responses[0].Content.Parts[0].Thought || responses[0].Content.Parts[0].Text != "step one" {
		t.Fatalf("expected first streamed response to be thinking, got %+v", responses[0].Content)
	}
	if responses[1].Content.Parts[1].Text != "answer" {
		t.Fatalf("expected second streamed response to include answer text, got %+v", responses[1].Content)
	}
	if !responses[2].TurnComplete {
		t.Fatalf("expected final streamed response to be complete, got %+v", responses[2])
	}
}

func TestMinimaxGenerateContentSendsToolsAndToolMessages(t *testing.T) {
	t.Parallel()

	var capturedRequest minimaxChatRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()

		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if err := json.Unmarshal(body, &capturedRequest); err != nil {
			t.Fatalf("decode request body: %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M2.7","content":[{"type":"text","text":"done"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()

	llm := NewMinimaxLLM("minimax-anthropic", server.URL, "MiniMax-M2.7", "test-key")
	request := &model.LLMRequest{
		Model: "minimax-anthropic",
		Contents: []*genai.Content{
			genai.NewContentFromText("列出笔记", genai.RoleUser),
			{
				Role: genai.RoleModel,
				Parts: []*genai.Part{{
					FunctionCall: &genai.FunctionCall{
						ID:   "call-1",
						Name: "vault.search_markdown_files",
						Args: map[string]any{"query": ""},
					},
				}},
			},
			{
				Role: genai.RoleUser,
				Parts: []*genai.Part{{
					FunctionResponse: &genai.FunctionResponse{
						ID:       "call-1",
						Name:     "vault.search_markdown_files",
						Response: map[string]any{"output": []string{"a.md", "b.md"}},
					},
				}},
			},
		},
		Config: &genai.GenerateContentConfig{
			Tools: []*genai.Tool{{
				FunctionDeclarations: []*genai.FunctionDeclaration{{
					Name:        "vault.search_markdown_files",
					Description: "Search markdown files in the vault.",
					Parameters: &genai.Schema{
						Type: genai.TypeObject,
						Properties: map[string]*genai.Schema{
							"query": {Type: genai.TypeString},
						},
					},
				}},
			}},
		},
	}

	for _, err := range collectResponses(llm.GenerateContent(context.Background(), request, false)) {
		if err != nil {
			t.Fatalf("GenerateContent returned error: %v", err)
		}
	}

	if len(capturedRequest.Tools) != 1 {
		t.Fatalf("expected one tool declaration, got %+v", capturedRequest.Tools)
	}
	if capturedRequest.ToolChoice == nil || capturedRequest.ToolChoice.Type != "auto" {
		t.Fatalf("expected tool choice auto, got %+v", capturedRequest.ToolChoice)
	}
	if len(capturedRequest.Messages) != 3 {
		t.Fatalf("expected 3 messages, got %+v", capturedRequest.Messages)
	}
	if capturedRequest.Messages[1].Role != "assistant" || capturedRequest.Messages[1].Content[0].Type != "tool_use" {
		t.Fatalf("expected assistant tool_use message, got %+v", capturedRequest.Messages[1])
	}
	if capturedRequest.Messages[2].Role != "user" || capturedRequest.Messages[2].Content[0].ToolUseID != "call-1" {
		t.Fatalf("expected user tool_result message, got %+v", capturedRequest.Messages[2])
	}
	parameters, ok := capturedRequest.Tools[0].InputSchema.(map[string]any)
	if !ok || parameters["type"] != "object" {
		t.Fatalf("expected JSON schema object parameters, got %#v", capturedRequest.Tools[0].InputSchema)
	}
}

func TestMinimaxGenerateContentParsesToolCalls(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M2.7","content":[{"type":"tool_use","id":"call-1","name":"vault.search_markdown_files","input":{"query":""}}],"stop_reason":"tool_use","usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()

	llm := NewMinimaxLLM("minimax-anthropic", server.URL, "MiniMax-M2.7", "test-key")
	request := &model.LLMRequest{
		Model: "minimax-anthropic",
		Contents: []*genai.Content{
			genai.NewContentFromText("看看有哪些笔记", genai.RoleUser),
		},
	}

	var responses []*model.LLMResponse
	for response, err := range llm.GenerateContent(context.Background(), request, false) {
		if err != nil {
			t.Fatalf("GenerateContent returned error: %v", err)
		}
		responses = append(responses, response)
	}

	if len(responses) != 1 {
		t.Fatalf("expected one response, got %d", len(responses))
	}
	if len(responses[0].Content.Parts) != 1 || responses[0].Content.Parts[0].FunctionCall == nil {
		t.Fatalf("expected function call part, got %+v", responses[0].Content)
	}
	functionCall := responses[0].Content.Parts[0].FunctionCall
	if functionCall.ID != "call-1" || functionCall.Name != "vault.search_markdown_files" {
		t.Fatalf("unexpected function call parsed: %+v", functionCall)
	}
	if functionCall.Args["query"] != "" {
		t.Fatalf("unexpected function call args: %+v", functionCall.Args)
	}
}

func TestMinimaxGenerateContentSynthesizesBlankToolCallIDsInHistory(t *testing.T) {
	t.Parallel()

	var capturedRequest minimaxChatRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()

		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if err := json.Unmarshal(body, &capturedRequest); err != nil {
			t.Fatalf("decode request body: %v", err)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M2.7","content":[{"type":"text","text":"done"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()

	llm := NewMinimaxLLM("minimax-anthropic", server.URL, "MiniMax-M2.7", "test-key")
	request := &model.LLMRequest{
		Model: "minimax-anthropic",
		Contents: []*genai.Content{
			genai.NewContentFromText("创建文件", genai.RoleUser),
			{
				Role: genai.RoleModel,
				Parts: []*genai.Part{{
					FunctionCall: &genai.FunctionCall{
						ID:   "",
						Name: "vault.create_markdown_file",
						Args: map[string]any{"relativePath": "New.md"},
					},
				}},
			},
			{
				Role: genai.RoleUser,
				Parts: []*genai.Part{{
					FunctionResponse: &genai.FunctionResponse{
						ID:       "",
						Name:     "vault.create_markdown_file",
						Response: map[string]any{"output": "ok"},
					},
				}},
			},
		},
	}

	for _, err := range collectResponses(llm.GenerateContent(context.Background(), request, false)) {
		if err != nil {
			t.Fatalf("GenerateContent returned error: %v", err)
		}
	}

	if len(capturedRequest.Messages) != 3 {
		t.Fatalf("expected 3 messages, got %+v", capturedRequest.Messages)
	}
	toolCallID := capturedRequest.Messages[1].Content[0].ID
	if toolCallID == "" {
		t.Fatalf("expected synthesized tool call id, got %+v", capturedRequest.Messages[1])
	}
	if capturedRequest.Messages[2].Content[0].ToolUseID != toolCallID {
		t.Fatalf("expected tool response to reuse synthesized id, got call=%q response=%q", toolCallID, capturedRequest.Messages[2].Content[0].ToolUseID)
	}
	if toolCallID != "tool-call-1" {
		t.Fatalf("expected deterministic synthesized id, got %q", toolCallID)
	}
}

func TestMinimaxGenerateContentSynthesizesBlankResponseToolCallIDs(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M2.7","content":[{"type":"tool_use","id":"","name":"vault.search_markdown_files","input":{"query":""}}],"stop_reason":"tool_use","usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()

	llm := NewMinimaxLLM("minimax-anthropic", server.URL, "MiniMax-M2.7", "test-key")
	request := &model.LLMRequest{
		Model: "minimax-anthropic",
		Contents: []*genai.Content{
			genai.NewContentFromText("看看有哪些笔记", genai.RoleUser),
		},
	}

	var responses []*model.LLMResponse
	for response, err := range llm.GenerateContent(context.Background(), request, false) {
		if err != nil {
			t.Fatalf("GenerateContent returned error: %v", err)
		}
		responses = append(responses, response)
	}

	if len(responses) != 1 {
		t.Fatalf("expected one response, got %d", len(responses))
	}
	functionCall := responses[0].Content.Parts[0].FunctionCall
	if functionCall == nil {
		t.Fatalf("expected function call part, got %+v", responses[0].Content)
	}
	if functionCall.ID != "tool-call-1" {
		t.Fatalf("expected synthesized tool call id, got %q", functionCall.ID)
	}
	if functionCall.Name != "vault.search_markdown_files" {
		t.Fatalf("unexpected function call parsed: %+v", functionCall)
	}
}

func TestBuildToolParametersSanitizesNullableSchemaForMinimax(t *testing.T) {
	t.Parallel()

	parameters := buildMinimaxTools(&model.LLMRequest{
		Config: &genai.GenerateContentConfig{
			Tools: []*genai.Tool{{
				FunctionDeclarations: []*genai.FunctionDeclaration{{
					Name: "vault.create_markdown_file",
					ParametersJsonSchema: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"relativePath": map[string]any{"type": "string"},
							"content":      map[string]any{"type": []any{"string", "null"}},
						},
						"required": []any{"relativePath"},
					},
				}},
			}},
		},
	})

	if len(parameters) != 1 {
		t.Fatalf("expected one tool, got %+v", parameters)
	}
	parameterObject, ok := parameters[0].InputSchema.(map[string]any)
	if !ok {
		t.Fatalf("expected sanitized parameters object, got %#v", parameters[0].InputSchema)
	}
	properties, ok := parameterObject["properties"].(map[string]any)
	if !ok {
		t.Fatalf("expected properties map, got %#v", parameterObject["properties"])
	}
	contentProperty, ok := properties["content"].(map[string]any)
	if !ok {
		t.Fatalf("expected content property object, got %#v", properties["content"])
	}
	if contentProperty["type"] != "string" {
		t.Fatalf("expected null union to collapse to string, got %#v", contentProperty["type"])
	}
}

func TestBuildMinimaxMessagesPrunesUnmatchedToolUseBeforeLaterMessages(t *testing.T) {
	t.Parallel()

	_, messages := buildMinimaxMessages(&model.LLMRequest{
		Contents: []*genai.Content{
			genai.NewContentFromText("初始请求", genai.RoleUser),
			{
				Role: genai.RoleModel,
				Parts: []*genai.Part{
					genai.NewPartFromText("需要两个确认。"),
					{
						FunctionCall: &genai.FunctionCall{
							ID:   "tool-call-1",
							Name: "adk_request_confirmation",
							Args: map[string]any{},
						},
					},
					{
						FunctionCall: &genai.FunctionCall{
							ID:   "tool-call-2",
							Name: "adk_request_confirmation",
							Args: map[string]any{},
						},
					},
				},
			},
			{
				Role: genai.RoleUser,
				Parts: []*genai.Part{{
					FunctionResponse: &genai.FunctionResponse{
						ID:       "tool-call-1",
						Name:     "adk_request_confirmation",
						Response: map[string]any{"confirmed": true},
					},
				}},
			},
			genai.NewContentFromText("第一个已完成，第二个还没确认。", genai.RoleModel),
			genai.NewContentFromText("继续新的问题", genai.RoleUser),
		},
	})

	if len(messages) != 5 {
		t.Fatalf("expected 5 normalized messages, got %+v", messages)
	}

	assistantConfirmation := messages[1]
	if assistantConfirmation.Role != "assistant" {
		t.Fatalf("expected assistant confirmation message, got %+v", assistantConfirmation)
	}
	if len(assistantConfirmation.Content) != 2 {
		t.Fatalf("expected text + one matched tool_use after pruning, got %+v", assistantConfirmation.Content)
	}
	if assistantConfirmation.Content[1].Type != "tool_use" || assistantConfirmation.Content[1].ID != "tool-call-1" {
		t.Fatalf("expected only matched tool-call-1 to remain, got %+v", assistantConfirmation.Content)
	}

	toolResultMessage := messages[2]
	if len(toolResultMessage.Content) != 1 || toolResultMessage.Content[0].ToolUseID != "tool-call-1" {
		t.Fatalf("expected only tool-call-1 result to remain, got %+v", toolResultMessage.Content)
	}

	for _, message := range messages {
		for _, block := range message.Content {
			if block.Type == "tool_use" && block.ID == "tool-call-2" {
				t.Fatalf("expected unmatched tool-call-2 to be pruned, got %+v", messages)
			}
		}
	}
}

func TestBuildMinimaxMessagesDropsOrphanToolResultMessages(t *testing.T) {
	t.Parallel()

	_, messages := buildMinimaxMessages(&model.LLMRequest{
		Contents: []*genai.Content{
			genai.NewContentFromText("问题", genai.RoleUser),
			{
				Role: genai.RoleUser,
				Parts: []*genai.Part{{
					FunctionResponse: &genai.FunctionResponse{
						ID:       "orphan-call",
						Name:     "vault_read_markdown_file",
						Response: map[string]any{"output": "ignored"},
					},
				}},
			},
			genai.NewContentFromText("后续正常问题", genai.RoleUser),
		},
	})

	if len(messages) != 2 {
		t.Fatalf("expected orphan tool result message to be removed, got %+v", messages)
	}
	for _, message := range messages {
		if isMinimaxToolResultOnlyMessage(message) {
			t.Fatalf("expected no orphan tool result messages, got %+v", messages)
		}
	}
}
