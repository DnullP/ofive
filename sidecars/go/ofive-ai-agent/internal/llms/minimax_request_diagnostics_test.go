package llms

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/adk/model"
	"google.golang.org/genai"
)

func TestMinimaxGenerateContentSkipsThinkingWhenToolResultsArePresent(t *testing.T) {
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
				Parts: []*genai.Part{
					{
						Text:             "需要读取目录。",
						Thought:          true,
						ThoughtSignature: []byte("sig-1"),
					},
					{
						FunctionCall: &genai.FunctionCall{
							ID:   "call-1",
							Name: "vault.search_markdown_files",
							Args: map[string]any{"query": ""},
						},
					},
				},
			},
			{
				Role: genai.RoleUser,
				Parts: []*genai.Part{{
					FunctionResponse: &genai.FunctionResponse{
						ID:       "call-1",
						Name:     "vault.search_markdown_files",
						Response: map[string]any{"output": []string{"a.md"}},
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

	if capturedRequest.Thinking != nil {
		t.Fatalf("expected thinking config to be skipped for tool result follow-up, got %+v", capturedRequest.Thinking)
	}
	if len(capturedRequest.Messages) != 3 {
		t.Fatalf("expected tool call history to stay intact, got %+v", capturedRequest.Messages)
	}
	if capturedRequest.Messages[1].Content[0].Type != "thinking" ||
		capturedRequest.Messages[1].Content[1].Type != "tool_use" {
		t.Fatalf("expected assistant thinking + tool_use blocks to be preserved, got %+v", capturedRequest.Messages[1])
	}
	if capturedRequest.Messages[2].Content[0].Type != "tool_result" {
		t.Fatalf("expected user tool_result to be preserved, got %+v", capturedRequest.Messages[2])
	}
}

func TestMinimaxGenerateContentEmitsRequestSummaryTrace(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M2.7","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()

	llm := NewMinimaxLLM("minimax-anthropic", server.URL, "MiniMax-M2.7", "test-key")
	var summary string
	llm.SetTraceEmitter(func(title string, text string) error {
		if title == "Model request summary" {
			summary = text
		}
		return nil
	})
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

	for _, fragment := range []string{
		"model=MiniMax-M2.7",
		"messages=1",
		"thinking=true",
		"message[0] role=user blocks=text",
	} {
		if !strings.Contains(summary, fragment) {
			t.Fatalf("expected summary to contain %q, got %q", fragment, summary)
		}
	}
}

func TestSummarizeMinimaxRequestIncludesToolResultShape(t *testing.T) {
	t.Parallel()

	summary := summarizeMinimaxRequest(minimaxChatRequest{
		Model:     "MiniMax-M2.7",
		MaxTokens: 4096,
		Stream:    true,
		Messages: []minimaxMessage{
			{
				Role: "assistant",
				Content: []minimaxContentBlock{
					{Type: "tool_use", ID: "call-1", Name: "vault.search_markdown_files"},
				},
			},
			{
				Role: "user",
				Content: []minimaxContentBlock{
					{Type: "tool_result", ToolUseID: "call-1", Content: `{"output":["a.md"]}`},
				},
			},
		},
	})

	for _, fragment := range []string{
		"message[0] role=assistant blocks=tool_use",
		"tool_use_ids=call-1",
		"message[1] role=user blocks=tool_result",
		"tool_result_ids=call-1",
		"tool_result_bytes=19",
	} {
		if !strings.Contains(summary, fragment) {
			t.Fatalf("expected summary to contain %q, got %q", fragment, summary)
		}
	}
}
