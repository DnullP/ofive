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
