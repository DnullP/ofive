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

func TestOpenAICompatibleGenerateContentSendsToolsAndToolMessages(t *testing.T) {
	t.Parallel()

	var capturedRequest map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()

		if request.URL.Path != "/chat/completions" {
			t.Fatalf("unexpected request path: %s", request.URL.Path)
		}
		if authorization := request.Header.Get("Authorization"); authorization != "Bearer test-key" {
			t.Fatalf("unexpected authorization header: %q", authorization)
		}

		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if err := json.Unmarshal(body, &capturedRequest); err != nil {
			t.Fatalf("decode request body: %v", err)
		}

		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-4.1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"done\"},\"finish_reason\":\"\"}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-4.1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	llm := NewOpenAICompatibleLLM("openai-compatible", server.URL, "gpt-4.1", "test-key")
	request := &model.LLMRequest{
		Model: "openai-compatible",
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

	if capturedRequest["model"] != "gpt-4.1" {
		t.Fatalf("expected configured model, got %#v", capturedRequest["model"])
	}
	if capturedRequest["tool_choice"] != "auto" {
		t.Fatalf("expected tool choice auto, got %#v", capturedRequest["tool_choice"])
	}
	tools, ok := capturedRequest["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("expected one tool declaration, got %#v", capturedRequest["tools"])
	}
	messages, ok := capturedRequest["messages"].([]any)
	if !ok || len(messages) != 3 {
		t.Fatalf("expected 3 messages, got %#v", capturedRequest["messages"])
	}
	assistantMessage, _ := messages[1].(map[string]any)
	toolCalls, _ := assistantMessage["tool_calls"].([]any)
	if assistantMessage["role"] != "assistant" || len(toolCalls) != 1 {
		t.Fatalf("expected assistant tool call message, got %#v", assistantMessage)
	}
	toolMessage, _ := messages[2].(map[string]any)
	if toolMessage["role"] != "tool" || toolMessage["tool_call_id"] != "call-1" {
		t.Fatalf("expected tool response message, got %#v", toolMessage)
	}
}

func TestOpenAICompatibleGenerateContentParsesStreamingToolCalls(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-4.1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"type\":\"function\",\"function\":{\"name\":\"vault.search_markdown_files\",\"arguments\":\"{\\\"query\\\"\"}}]},\"finish_reason\":\"\"}]}\n\n"))
		_, _ = writer.Write([]byte("data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-4.1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\":\\\"\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n"))
		_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	llm := NewOpenAICompatibleLLM("openai-compatible", server.URL, "gpt-4.1", "test-key")
	request := &model.LLMRequest{
		Model: "openai-compatible",
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
		t.Fatalf("expected one final response, got %d", len(responses))
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
