package llms

import (
	"fmt"
	"os"
	"strings"
)

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func resolveMinimaxMessagesEndpoint(endpoint string) string {
	return resolveAnthropicMessagesEndpoint(endpoint, "https://api.minimaxi.com/anthropic")
}

func resolveAnthropicMessagesEndpoint(endpoint string, defaultEndpoint string) string {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		trimmed = defaultEndpoint
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

func minimaxMessagesContainToolResults(messages []minimaxMessage) bool {
	for _, message := range messages {
		for _, block := range message.Content {
			if block.Type == "tool_result" {
				return true
			}
		}
	}
	return false
}

func summarizeMinimaxRequest(payload minimaxChatRequest) string {
	var builder strings.Builder
	fmt.Fprintf(
		&builder,
		"model=%s messages=%d tools=%d stream=%t max_tokens=%d thinking=%t",
		payload.Model,
		len(payload.Messages),
		len(payload.Tools),
		payload.Stream,
		payload.MaxTokens,
		payload.Thinking != nil,
	)

	for messageIndex, message := range payload.Messages {
		blockTypes := make([]string, 0, len(message.Content))
		toolUseNames := make([]string, 0)
		toolUseIDs := make([]string, 0)
		toolResultIDs := make([]string, 0)
		toolResultCount := 0
		toolResultBytes := 0
		textBytes := 0
		thinkingBytes := 0
		for _, block := range message.Content {
			blockTypes = append(blockTypes, strings.TrimSpace(block.Type))
			switch block.Type {
			case "tool_use":
				if name := strings.TrimSpace(block.Name); name != "" {
					toolUseNames = append(toolUseNames, name)
				}
				if id := strings.TrimSpace(block.ID); id != "" {
					toolUseIDs = append(toolUseIDs, id)
				}
			case "tool_result":
				toolResultCount++
				toolResultBytes += len(block.Content)
				if id := strings.TrimSpace(block.ToolUseID); id != "" {
					toolResultIDs = append(toolResultIDs, id)
				}
			case "text":
				textBytes += len(block.Text)
			case "thinking":
				thinkingBytes += len(block.Thinking)
			}
		}
		fmt.Fprintf(
			&builder,
			"\nmessage[%d] role=%s blocks=%s tool_uses=%d tool_use_names=%s tool_use_ids=%s tool_results=%d tool_result_ids=%s tool_result_bytes=%d text_bytes=%d thinking_bytes=%d",
			messageIndex,
			message.Role,
			strings.Join(blockTypes, ","),
			len(toolUseIDs),
			strings.Join(toolUseNames, ","),
			strings.Join(toolUseIDs, ","),
			toolResultCount,
			strings.Join(toolResultIDs, ","),
			toolResultBytes,
			textBytes,
			thinkingBytes,
		)
	}

	return builder.String()
}
