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

func TestGenerateContentUsesConfiguredVendorModel(t *testing.T) {
	t.Parallel()

	var capturedRequest baiduChatRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()

		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}

		if err := json.Unmarshal(body, &capturedRequest); err != nil {
			t.Fatalf("decode request body: %v", err)
		}

		if authorization := request.Header.Get("Authorization"); authorization != "Bearer test-token" {
			t.Fatalf("unexpected authorization header: %q", authorization)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"as-test","choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	defer server.Close()

	llm := NewBaiduLLM(
		"baidu-qianfan",
		server.URL,
		"deepseek-v3.1-250821",
		"",
		"test-token",
	)

	request := &model.LLMRequest{
		Model: "baidu-qianfan",
		Contents: []*genai.Content{
			genai.NewContentFromText("你好", genai.RoleUser),
		},
	}

	for _, err := range collectResponses(llm.GenerateContent(context.Background(), request, false)) {
		if err != nil {
			t.Fatalf("GenerateContent returned error: %v", err)
		}
	}

	if capturedRequest.Model != "deepseek-v3.1-250821" {
		t.Fatalf("expected configured model to be sent, got %q", capturedRequest.Model)
	}

	if len(capturedRequest.Messages) != 1 || capturedRequest.Messages[0].Role != "user" {
		t.Fatalf("unexpected messages payload: %+v", capturedRequest.Messages)
	}
}

func TestGenerateContentSendsToolsAndToolMessages(t *testing.T) {
	t.Parallel()

	var capturedRequest baiduChatRequest
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
		_, _ = writer.Write([]byte(`{"id":"as-test","choices":[{"message":{"content":"done"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	defer server.Close()

	llm := NewBaiduLLM("baidu-qianfan", server.URL, "deepseek-v3.1-250821", "", "test-token")
	request := &model.LLMRequest{
		Model: "baidu-qianfan",
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
	if capturedRequest.ToolChoice != "auto" {
		t.Fatalf("expected tool choice auto, got %q", capturedRequest.ToolChoice)
	}
	if len(capturedRequest.Messages) != 3 {
		t.Fatalf("expected 3 messages, got %+v", capturedRequest.Messages)
	}
	if capturedRequest.Messages[1].Role != "assistant" || len(capturedRequest.Messages[1].ToolCalls) != 1 {
		t.Fatalf("expected assistant tool call message, got %+v", capturedRequest.Messages[1])
	}
	if capturedRequest.Messages[2].Role != "tool" || capturedRequest.Messages[2].ToolCallID != "call-1" {
		t.Fatalf("expected tool response message, got %+v", capturedRequest.Messages[2])
	}
	parameters, ok := capturedRequest.Tools[0].Function.Parameters.(map[string]any)
	if !ok || parameters["type"] != "object" {
		t.Fatalf("expected JSON schema object parameters, got %#v", capturedRequest.Tools[0].Function.Parameters)
	}
}

func TestGenerateContentParsesToolCalls(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"as-test","choices":[{"message":{"role":"assistant","content":"","tool_calls":[{"id":"call-1","type":"function","function":{"name":"vault.search_markdown_files","arguments":"{\"query\":\"\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	defer server.Close()

	llm := NewBaiduLLM("baidu-qianfan", server.URL, "deepseek-v3.1-250821", "", "test-token")
	request := &model.LLMRequest{
		Model: "baidu-qianfan",
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

func TestGenerateContentSynthesizesBlankToolCallIDsInHistory(t *testing.T) {
	t.Parallel()

	var capturedRequest baiduChatRequest
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
		_, _ = writer.Write([]byte(`{"id":"as-test","choices":[{"message":{"content":"done"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	defer server.Close()

	llm := NewBaiduLLM("baidu-qianfan", server.URL, "deepseek-v3.1-250821", "", "test-token")
	request := &model.LLMRequest{
		Model: "baidu-qianfan",
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
	toolCallID := capturedRequest.Messages[1].ToolCalls[0].ID
	if toolCallID == "" {
		t.Fatalf("expected synthesized tool call id, got %+v", capturedRequest.Messages[1])
	}
	if capturedRequest.Messages[2].ToolCallID != toolCallID {
		t.Fatalf("expected tool response to reuse synthesized id, got call=%q response=%q", toolCallID, capturedRequest.Messages[2].ToolCallID)
	}
	if toolCallID != "tool-call-1" {
		t.Fatalf("expected deterministic synthesized id, got %q", toolCallID)
	}
	}

func TestGenerateContentSynthesizesBlankResponseToolCallIDs(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"as-test","choices":[{"message":{"role":"assistant","content":"","tool_calls":[{"id":"","type":"function","function":{"name":"vault.search_markdown_files","arguments":"{\"query\":\"\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	defer server.Close()

	llm := NewBaiduLLM("baidu-qianfan", server.URL, "deepseek-v3.1-250821", "", "test-token")
	request := &model.LLMRequest{
		Model: "baidu-qianfan",
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

func TestBuildToolParametersSanitizesNullableSchemaForBaidu(t *testing.T) {
	t.Parallel()

	parameters := buildToolParameters(&genai.FunctionDeclaration{
		Name: "vault.create_markdown_file",
		ParametersJsonSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"relativePath": map[string]any{"type": "string"},
				"content": map[string]any{"type": []any{"string", "null"}},
			},
			"required": []any{"relativePath"},
		},
	})

	parameterObject, ok := parameters.(map[string]any)
	if !ok {
		t.Fatalf("expected sanitized parameters object, got %#v", parameters)
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

func TestBuildToolParametersDropsNonDraftSevenFields(t *testing.T) {
	t.Parallel()

	parameters := buildToolParameters(&genai.FunctionDeclaration{
		Name: "test_tool",
		Parameters: &genai.Schema{
			Type:             genai.TypeObject,
			PropertyOrdering: []string{"query"},
			Properties: map[string]*genai.Schema{
				"query": {
					Type: genai.TypeString,
					Nullable: func() *bool {
						value := true
						return &value
					}(),
				},
			},
		},
	})

	parameterObject, ok := parameters.(map[string]any)
	if !ok {
		t.Fatalf("expected sanitized parameters object, got %#v", parameters)
	}
	if _, exists := parameterObject["propertyOrdering"]; exists {
		t.Fatalf("expected propertyOrdering to be removed, got %#v", parameterObject)
	}
	properties, ok := parameterObject["properties"].(map[string]any)
	if !ok {
		t.Fatalf("expected properties map, got %#v", parameterObject["properties"])
	}
	queryProperty := properties["query"].(map[string]any)
	if _, exists := queryProperty["nullable"]; exists {
		t.Fatalf("expected nullable to be removed, got %#v", queryProperty)
	}
}

func collectResponses(sequence func(func(*model.LLMResponse, error) bool)) []error {
	var errors []error
	sequence(func(_ *model.LLMResponse, err error) bool {
		errors = append(errors, err)
		return true
	})
	return errors
}