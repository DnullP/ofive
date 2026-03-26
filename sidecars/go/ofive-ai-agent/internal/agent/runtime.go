// Package agentruntime provides the ADK-backed runtime used by the Go sidecar.
package agentruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync/atomic"

	"google.golang.org/adk/agent"
	"google.golang.org/adk/agent/llmagent"
	"google.golang.org/adk/model"
	"google.golang.org/genai"

	"google.golang.org/adk/runner"
	"google.golang.org/adk/session"
	"google.golang.org/adk/tool/toolconfirmation"

	"ofive/sidecars/go/ofive-ai-agent/internal/capabilities"
	"ofive/sidecars/go/ofive-ai-agent/internal/llms"
)

const (
	appName   = "ofive-ai-sidecar"
	agentName = "ofive_helper_agent"
)

var markdownPathPattern = regexp.MustCompile(`([A-Za-z0-9_./-]+\.md)`)

// VendorConfig contains the vendor-specific model selection and field values.
type VendorConfig struct {
	VendorID    string
	Model       string
	FieldValues map[string]string
}

// ToolDescriptor contains one AI-visible capability projected by Rust.
type ToolDescriptor struct {
	CapabilityID         string
	Name                 string
	Description          string
	InputSchemaJSON      string
	OutputSchemaJSON     string
	RiskLevel            string
	RequiresConfirmation bool
	APIVersion           string
}

// HistoryEntry contains one persisted user/assistant text message used to restore context.
type HistoryEntry struct {
	Role string
	Text string
}

// CapabilityBridgeConfig contains callback settings for Rust capability execution.
type CapabilityBridgeConfig struct {
	CallbackURL              string
	CallbackToken            string
	PersistenceCallbackURL   string
	PersistenceCallbackToken string
	MCPServerURL             string
	MCPAuthToken             string
	Tools                    []ToolDescriptor
}

// Runtime wraps shared ADK session state for requests handled by the sidecar.
type Runtime struct {
	sessionService session.Service
}

// StreamChunk represents one streaming chunk emitted by the sidecar.
type StreamChunk struct {
	EventType                string
	AgentName                string
	DeltaText                string
	AccumulatedText          string
	DebugTitle               string
	DebugText                string
	ConfirmationID           string
	ConfirmationHint         string
	ConfirmationToolName     string
	ConfirmationToolArgsJSON string
	ErrorText                string
	Done                     bool
}

type pendingToolConfirmation struct {
	ID           string
	Hint         string
	ToolName     string
	ToolArgsJSON string
}

// DebugTraceEvent represents one raw trace emitted during a model-backed turn.
type DebugTraceEvent struct {
	Title string
	Text  string
}

// New creates the ADK runtime used by the sidecar gRPC service.
func New() (*Runtime, error) {
	sessionService := session.InMemoryService()

	return &Runtime{
		sessionService: sessionService,
	}, nil
}

// AgentName returns the sidecar-level agent name used for health reporting.
func (r *Runtime) AgentName() string {
	return agentName
}

// EnsureSession creates the requested session if it does not exist yet.
func (r *Runtime) EnsureSession(ctx context.Context, userID, sessionID string) error {
	_, err := r.sessionService.Get(ctx, &session.GetRequest{
		AppName:   appName,
		UserID:    userID,
		SessionID: sessionID,
	})
	if err == nil {
		return nil
	}

	_, err = r.sessionService.Create(ctx, &session.CreateRequest{
		AppName:   appName,
		UserID:    userID,
		SessionID: sessionID,
	})
	if err != nil {
		return fmt.Errorf("create session %s: %w", sessionID, err)
	}

	return nil
}

// Chat runs one turn and returns the final text output together with the effective agent name.
func (r *Runtime) Chat(
	ctx context.Context,
	userID string,
	sessionID string,
	message string,
	vendorConfig VendorConfig,
	bridgeConfig CapabilityBridgeConfig,
	trace func(DebugTraceEvent) error,
) (string, string, error) {
	if err := r.EnsureSession(ctx, userID, sessionID); err != nil {
		return "", "", err
	}

	if responseText, agentDisplayName, handled, err := tryHandleExplicitPersistenceCommand(
		ctx,
		sessionID,
		message,
		bridgeConfig,
	); handled {
		return responseText, agentDisplayName, err
	}

	if responseText, agentDisplayName, handled, err := tryHandleExplicitCapabilityCommand(
		ctx,
		message,
		bridgeConfig,
	); handled {
		return responseText, agentDisplayName, err
	}

	if strings.TrimSpace(vendorConfig.VendorID) == "" || vendorConfig.VendorID == "mock-echo" {
		if canUseCapabilityPlanning(bridgeConfig) {
			responseText, err := executeCapabilityPlanningLoop(
				ctx,
				message,
				bridgeConfig,
				func(_ context.Context, prompt string) (string, error) {
					if err := emitDebugTrace(trace, DebugTraceEvent{
						Title: "Mock model request",
						Text:  prompt,
					}); err != nil {
						return "", err
					}
					response := mockToolPlanningResponse(prompt, bridgeConfig)
					if err := emitDebugTrace(trace, DebugTraceEvent{
						Title: "Mock model response",
						Text:  response,
					}); err != nil {
						return "", err
					}
					return response, nil
				},
			)
			if err != nil {
				return "", "", err
			}
			return responseText, "mock-echo", nil
		}

		return mockEchoResponse(message), "mock-echo", nil
	}

	adkAgent, agentDisplayName, err := r.buildAgent(ctx, vendorConfig, bridgeConfig, trace)
	if err != nil {
		return "", "", err
	}

	runnerInstance, err := runner.New(runner.Config{
		AppName:        appName,
		Agent:          adkAgent,
		SessionService: r.sessionService,
	})
	if err != nil {
		return "", "", fmt.Errorf("create adk runner: %w", err)
	}

	respond := func(turnCtx context.Context, prompt string) (string, error) {
		return runADKTurn(turnCtx, runnerInstance, adkAgent, userID, sessionID, prompt)
	}

	var responseText string
	if canUseCapabilityPlanning(bridgeConfig) {
		responseText, err = executeCapabilityPlanningLoop(
			ctx,
			message,
			bridgeConfig,
			respond,
		)
	} else {
		responseText, err = respond(ctx, message)
	}
	if err != nil {
		return "", "", err
	}

	return responseText, agentDisplayName, nil
}

// StreamChat runs one turn through ADK and emits chunked output.
func (r *Runtime) StreamChat(
	ctx context.Context,
	userID string,
	sessionID string,
	message string,
	history []HistoryEntry,
	vendorConfig VendorConfig,
	bridgeConfig CapabilityBridgeConfig,
	emit func(StreamChunk) error,
) error {
	trace := func(event DebugTraceEvent) error {
		return emit(StreamChunk{
			EventType:  "debug",
			DebugTitle: event.Title,
			DebugText:  event.Text,
		})
	}

	if err := r.EnsureSession(ctx, userID, sessionID); err != nil {
		return err
	}
	if err := r.seedSessionHistory(ctx, userID, sessionID, history); err != nil {
		return err
	}

	if responseText, agentDisplayName, handled, err := tryHandleExplicitPersistenceCommand(
		ctx,
		sessionID,
		message,
		bridgeConfig,
	); handled {
		if err != nil {
			return err
		}
		return emitChunkedTextResponse(responseText, agentDisplayName, emit)
	}

	if responseText, agentDisplayName, handled, err := tryHandleExplicitCapabilityCommand(
		ctx,
		message,
		bridgeConfig,
	); handled {
		if err != nil {
			return err
		}
		return emitChunkedTextResponse(responseText, agentDisplayName, emit)
	}

	if confirmation, responseText, handled, err := tryHandleExplicitMockConfirmationCommand(
		ctx,
		sessionID,
		message,
		bridgeConfig,
	); handled {
		if err != nil {
			return err
		}
		return emit(StreamChunk{
			EventType:                "confirmation",
			AgentName:                mockConfirmationAgentName,
			AccumulatedText:          responseText,
			ConfirmationID:           confirmation.ID,
			ConfirmationHint:         confirmation.Hint,
			ConfirmationToolName:     confirmation.ToolName,
			ConfirmationToolArgsJSON: confirmation.ToolArgsJSON,
			Done:                     true,
		})
	}

	if strings.TrimSpace(vendorConfig.VendorID) == "" || vendorConfig.VendorID == "mock-echo" {
		responseText, agentDisplayName, err := r.Chat(
			ctx,
			userID,
			sessionID,
			message,
			vendorConfig,
			bridgeConfig,
			trace,
		)
		if err != nil {
			return err
		}
		return emitChunkedTextResponse(responseText, agentDisplayName, emit)
	}

	adkAgent, agentDisplayName, err := r.buildAgent(ctx, vendorConfig, bridgeConfig, trace)
	if err != nil {
		return err
	}

	runnerInstance, err := runner.New(runner.Config{
		AppName:        appName,
		Agent:          adkAgent,
		SessionService: r.sessionService,
	})
	if err != nil {
		return fmt.Errorf("create adk runner: %w", err)
	}

	return streamADKContent(
		ctx,
		runnerInstance,
		adkAgent,
		agentDisplayName,
		userID,
		sessionID,
		bridgeConfig,
		genai.NewContentFromText(message, genai.RoleUser),
		emit,
	)
}

func (r *Runtime) seedSessionHistory(
	ctx context.Context,
	userID string,
	sessionID string,
	history []HistoryEntry,
) error {
	if len(history) == 0 {
		return nil
	}

	response, err := r.sessionService.Get(ctx, &session.GetRequest{
		AppName:   appName,
		UserID:    userID,
		SessionID: sessionID,
	})
	if err != nil {
		return fmt.Errorf("load session %s for history seed: %w", sessionID, err)
	}
	if response.Session.Events().Len() > 0 {
		return nil
	}

	for index, item := range history {
		text := strings.TrimSpace(item.Text)
		if text == "" {
			continue
		}

		contentRole := genai.Role(genai.RoleUser)
		author := "user"
		if strings.TrimSpace(item.Role) == "assistant" {
			contentRole = genai.Role(genai.RoleModel)
			author = agentName
		}

		event := session.NewEvent(fmt.Sprintf("history-seed-%d", index+1))
		event.Author = author
		event.LLMResponse = model.LLMResponse{
			Content:      genai.NewContentFromText(text, contentRole),
			TurnComplete: true,
		}

		if err := r.sessionService.AppendEvent(ctx, response.Session, event); err != nil {
			return fmt.Errorf("append seeded history event %d: %w", index+1, err)
		}
	}

	return nil
}

// StreamConfirmation resumes one ADK session by submitting a tool confirmation response.
func (r *Runtime) StreamConfirmation(
	ctx context.Context,
	userID string,
	sessionID string,
	confirmationID string,
	confirmed bool,
	vendorConfig VendorConfig,
	bridgeConfig CapabilityBridgeConfig,
	emit func(StreamChunk) error,
) error {
	trace := func(event DebugTraceEvent) error {
		return emit(StreamChunk{
			EventType:  "debug",
			DebugTitle: event.Title,
			DebugText:  event.Text,
		})
	}

	if err := r.EnsureSession(ctx, userID, sessionID); err != nil {
		return err
	}

	persistedConfirmation, persistenceEnabled, err := loadPersistedPendingConfirmation(
		ctx,
		sessionID,
		confirmationID,
		bridgeConfig,
	)
	if err != nil {
		return err
	}
	if persistenceEnabled && persistedConfirmation == nil {
		return fmt.Errorf(
			"pending confirmation %s not found in host persistence",
			strings.TrimSpace(confirmationID),
		)
	}
	if persistedConfirmation != nil {
		if err := emitDebugTrace(trace, DebugTraceEvent{
			Title: "Restored pending confirmation",
			Text: fmt.Sprintf(
				"confirmationId=%s tool=%s",
				persistedConfirmation.ConfirmationID,
				persistedConfirmation.ToolName,
			),
		}); err != nil {
			return err
		}
	}

	if strings.TrimSpace(vendorConfig.VendorID) == "" ||
		strings.TrimSpace(vendorConfig.VendorID) == "mock-echo" {
		if err := streamMockConfirmationResponse(
			confirmed,
			persistedConfirmation,
			emit,
		); err != nil {
			return err
		}

		return deletePersistedPendingConfirmation(
			ctx,
			sessionID,
			confirmationID,
			bridgeConfig,
		)
	}

	adkAgent, agentDisplayName, err := r.buildAgent(ctx, vendorConfig, bridgeConfig, trace)
	if err != nil {
		return err
	}

	runnerInstance, err := runner.New(runner.Config{
		AppName:        appName,
		Agent:          adkAgent,
		SessionService: r.sessionService,
	})
	if err != nil {
		return fmt.Errorf("create adk runner: %w", err)
	}

	content := &genai.Content{
		Role: genai.RoleUser,
		Parts: []*genai.Part{{
			FunctionResponse: &genai.FunctionResponse{
				ID:       strings.TrimSpace(confirmationID),
				Name:     toolconfirmation.FunctionCallName,
				Response: map[string]any{"confirmed": confirmed},
			},
		}},
	}

	if err := streamADKContent(
		ctx,
		runnerInstance,
		adkAgent,
		agentDisplayName,
		userID,
		sessionID,
		bridgeConfig,
		content,
		emit,
	); err != nil {
		return err
	}

	return deletePersistedPendingConfirmation(
		ctx,
		sessionID,
		confirmationID,
		bridgeConfig,
	)
}

func emitChunkedTextResponse(
	responseText string,
	agentDisplayName string,
	emit func(StreamChunk) error,
) error {
	chunks := splitIntoChunks(responseText, 18)
	accumulated := ""
	for _, chunk := range chunks {
		accumulated += chunk
		if err := emit(StreamChunk{
			EventType:       "delta",
			AgentName:       agentDisplayName,
			DeltaText:       chunk,
			AccumulatedText: accumulated,
			Done:            false,
		}); err != nil {
			return err
		}
	}

	return emit(StreamChunk{
		EventType:       "done",
		AgentName:       agentDisplayName,
		DeltaText:       "",
		AccumulatedText: responseText,
		Done:            true,
	})
}

func streamADKContent(
	ctx context.Context,
	runnerInstance *runner.Runner,
	adkAgent agent.Agent,
	agentDisplayName string,
	userID string,
	sessionID string,
	bridgeConfig CapabilityBridgeConfig,
	content *genai.Content,
	emit func(StreamChunk) error,
) error {
	var responseText string
	var confirmation *pendingToolConfirmation

	for event, err := range runnerInstance.Run(ctx, userID, sessionID, content, agent.RunConfig{}) {
		if err != nil {
			return fmt.Errorf("run adk turn: %w", err)
		}
		if event == nil || event.Author != adkAgent.Name() || event.LLMResponse.Content == nil {
			continue
		}

		if pending := extractPendingToolConfirmation(event.LLMResponse.Content); pending != nil {
			confirmation = pending
		}

		var parts []string
		for _, part := range event.LLMResponse.Content.Parts {
			if part != nil && strings.TrimSpace(part.Text) != "" {
				parts = append(parts, part.Text)
			}
		}
		if len(parts) > 0 {
			responseText = strings.Join(parts, "\n")
		}
	}

	if confirmation != nil {
		if err := savePendingConfirmation(ctx, sessionID, *confirmation, bridgeConfig); err != nil {
			return err
		}

		return emit(StreamChunk{
			EventType:                "confirmation",
			AgentName:                agentDisplayName,
			AccumulatedText:          responseText,
			ConfirmationID:           confirmation.ID,
			ConfirmationHint:         confirmation.Hint,
			ConfirmationToolName:     confirmation.ToolName,
			ConfirmationToolArgsJSON: confirmation.ToolArgsJSON,
			Done:                     true,
		})
	}

	if strings.TrimSpace(responseText) == "" {
		return fmt.Errorf("adk returned empty response")
	}

	return emitChunkedTextResponse(responseText, agentDisplayName, emit)
}

func extractPendingToolConfirmation(content *genai.Content) *pendingToolConfirmation {
	if content == nil {
		return nil
	}

	for _, part := range content.Parts {
		if part == nil || part.FunctionCall == nil {
			continue
		}
		if part.FunctionCall.Name != toolconfirmation.FunctionCallName {
			continue
		}

		originalCall, err := toolconfirmation.OriginalCallFrom(part.FunctionCall)
		if err != nil || originalCall == nil {
			return &pendingToolConfirmation{
				ID:   strings.TrimSpace(part.FunctionCall.ID),
				Hint: extractToolConfirmationHint(part.FunctionCall),
			}
		}

		return &pendingToolConfirmation{
			ID:           strings.TrimSpace(part.FunctionCall.ID),
			Hint:         extractToolConfirmationHint(part.FunctionCall),
			ToolName:     strings.TrimSpace(originalCall.Name),
			ToolArgsJSON: marshalConfirmationArgs(originalCall.Args),
		}
	}

	return nil
}

func extractToolConfirmationHint(functionCall *genai.FunctionCall) string {
	if functionCall == nil || functionCall.Args == nil {
		return ""
	}
	toolConfirmationRaw, ok := functionCall.Args["toolConfirmation"].(map[string]any)
	if !ok {
		return ""
	}
	hint, _ := toolConfirmationRaw["hint"].(string)
	return strings.TrimSpace(hint)
}

func marshalConfirmationArgs(args map[string]any) string {
	if len(args) == 0 {
		return "{}"
	}
	encoded, err := json.MarshalIndent(args, "", "  ")
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

// splitIntoChunks breaks a string into deterministic UTF-8 safe chunks.
func splitIntoChunks(value string, chunkSize int) []string {
	if chunkSize <= 0 {
		return []string{value}
	}

	runes := []rune(value)
	if len(runes) == 0 {
		return []string{""}
	}

	chunks := make([]string, 0, (len(runes)+chunkSize-1)/chunkSize)
	for start := 0; start < len(runes); start += chunkSize {
		end := start + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[start:end]))
	}

	return chunks
}

func (r *Runtime) buildAgent(
	ctx context.Context,
	vendorConfig VendorConfig,
	bridgeConfig CapabilityBridgeConfig,
	trace func(DebugTraceEvent) error,
) (agent.Agent, string, error) {
	_ = ctx

	switch strings.TrimSpace(vendorConfig.VendorID) {
	case "minimax-anthropic":
		llm := llms.NewMinimaxLLM(
			"minimax-anthropic",
			vendorConfig.FieldValues["endpoint"],
			vendorConfig.Model,
			vendorConfig.FieldValues["apiKey"],
		)
		llm.SetTraceEmitter(func(title string, text string) error {
			return emitDebugTrace(trace, DebugTraceEvent{Title: title, Text: text})
		})

		toolsets, err := buildMCPToolsets(bridgeConfig)
		if err != nil {
			return nil, "", err
		}

		var modelRequestSequence atomic.Int32

		adkAgent, err := llmagent.New(llmagent.Config{
			Name:        agentName,
			Description: "AI assistant for ofive desktop notes.",
			Instruction: buildAgentInstruction(bridgeConfig),
			Model:       llm,
			Toolsets:    toolsets,
			BeforeModelCallbacks: []llmagent.BeforeModelCallback{
				func(_ agent.CallbackContext, llmRequest *model.LLMRequest) (*model.LLMResponse, error) {
					requestIndex := modelRequestSequence.Add(1)
					if err := emitDebugTrace(trace, DebugTraceEvent{
						Title: fmt.Sprintf("Model request #%d", requestIndex),
						Text:  formatModelRequest(llmRequest),
					}); err != nil {
						return nil, err
					}
					return nil, nil
				},
			},
		})
		if err != nil {
			return nil, "", fmt.Errorf("create minimax llm agent: %w", err)
		}

		return adkAgent, llm.Name(), nil
	case "baidu-qianfan":
		llm := llms.NewBaiduLLM(
			"baidu-qianfan",
			vendorConfig.FieldValues["endpoint"],
			vendorConfig.Model,
			vendorConfig.FieldValues["appId"],
			vendorConfig.FieldValues["authToken"],
		)
		llm.SetTraceEmitter(func(title string, text string) error {
			return emitDebugTrace(trace, DebugTraceEvent{Title: title, Text: text})
		})

		toolsets, err := buildMCPToolsets(bridgeConfig)
		if err != nil {
			return nil, "", err
		}

		var modelRequestSequence atomic.Int32

		adkAgent, err := llmagent.New(llmagent.Config{
			Name:        agentName,
			Description: "AI assistant for ofive desktop notes.",
			Instruction: buildAgentInstruction(bridgeConfig),
			Model:       llm,
			Toolsets:    toolsets,
			BeforeModelCallbacks: []llmagent.BeforeModelCallback{
				func(_ agent.CallbackContext, llmRequest *model.LLMRequest) (*model.LLMResponse, error) {
					requestIndex := modelRequestSequence.Add(1)
					if err := emitDebugTrace(trace, DebugTraceEvent{
						Title: fmt.Sprintf("Model request #%d", requestIndex),
						Text:  formatModelRequest(llmRequest),
					}); err != nil {
						return nil, err
					}
					return nil, nil
				},
			},
		})
		if err != nil {
			return nil, "", fmt.Errorf("create baidu llm agent: %w", err)
		}

		return adkAgent, llm.Name(), nil
	default:
		return nil, "", fmt.Errorf("unsupported vendor: %s", vendorConfig.VendorID)
	}
}

func mockEchoResponse(message string) string {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return "[ADK] empty input"
	}
	return fmt.Sprintf("[ADK] %s", trimmed)
}

func canUseCapabilityPlanning(bridgeConfig CapabilityBridgeConfig) bool {
	if strings.TrimSpace(bridgeConfig.MCPServerURL) != "" {
		return false
	}
	_, ok := capabilityClientFromBridge(bridgeConfig)
	return ok && len(bridgeConfig.Tools) > 0
}

func runADKTurn(
	ctx context.Context,
	runnerInstance *runner.Runner,
	adkAgent agent.Agent,
	userID string,
	sessionID string,
	prompt string,
) (string, error) {
	content := genai.NewContentFromText(prompt, genai.RoleUser)
	var responseText string

	for event, err := range runnerInstance.Run(ctx, userID, sessionID, content, agent.RunConfig{}) {
		if err != nil {
			return "", fmt.Errorf("run adk turn: %w", err)
		}
		if event == nil || event.Author != adkAgent.Name() || event.LLMResponse.Content == nil {
			continue
		}

		var parts []string
		for _, part := range event.LLMResponse.Content.Parts {
			if part != nil && strings.TrimSpace(part.Text) != "" {
				parts = append(parts, part.Text)
			}
		}
		if len(parts) > 0 {
			responseText = strings.Join(parts, "\n")
		}
	}

	if strings.TrimSpace(responseText) == "" {
		return "", fmt.Errorf("adk returned empty response")
	}

	return responseText, nil
}

func buildAgentInstruction(bridgeConfig CapabilityBridgeConfig) string {
	baseInstruction := "You are the AI assistant inside ofive. Answer clearly, concisely, and stay grounded in the user's request."
	if len(bridgeConfig.Tools) == 0 {
		return baseInstruction
	}

	toolLines := make([]string, 0, len(bridgeConfig.Tools))
	for _, tool := range bridgeConfig.Tools {
		toolLines = append(toolLines, fmt.Sprintf(
			"- capabilityId=%s name=%s risk=%s confirmation=%t description=%s",
			tool.CapabilityID,
			tool.Name,
			tool.RiskLevel,
			tool.RequiresConfirmation,
			strings.TrimSpace(tool.Description),
		))
	}

	return baseInstruction + "\n\n" +
		"When the user asks about local vault content, notes, outlines, backlinks, search results, or graph data, you must use the provided tools instead of guessing or claiming you cannot access local files. " +
		"Never invent tools, parameters, or file contents. If the user's request would require writing, renaming, deleting, or any other modification but no such executable tool is listed, explicitly say that the current assistant session only has non-mutating tools available and do not claim success. " +
		"After tool results are available, answer directly and stay grounded in those results. Available tools:\n" + strings.Join(toolLines, "\n")
}

func mockToolPlanningResponse(prompt string, bridgeConfig CapabilityBridgeConfig) string {
	trimmedPrompt := strings.TrimSpace(prompt)
	if strings.Contains(trimmedPrompt, "Tool result JSON:") {
		return "我已经读取到目标 Markdown 文件，内容如下：\n\n" + extractToolResultJSON(trimmedPrompt)
	}

	if capabilityID, input, ok := mockPlanCapabilityCall(trimmedPrompt, bridgeConfig.Tools); ok {
		return fmt.Sprintf(
			"%s\n%s\n%s",
			plannedCapabilityCallStartTag,
			mustMarshalJSON(map[string]any{
				"capabilityId": capabilityID,
				"input":        input,
			}),
			plannedCapabilityCallEndTag,
		)
	}

	return mockEchoResponse(prompt)
}

func mockPlanCapabilityCall(prompt string, tools []ToolDescriptor) (string, map[string]any, bool) {
	if _, err := resolveCapabilityID("vault.read_markdown_file", tools); err != nil {
		return "", nil, false
	}

	lowerPrompt := strings.ToLower(prompt)
	if !strings.Contains(lowerPrompt, "read") &&
		!strings.Contains(prompt, "读取") &&
		!strings.Contains(prompt, "打开") &&
		!strings.Contains(prompt, "查看") {
		return "", nil, false
	}

	match := markdownPathPattern.FindStringSubmatch(prompt)
	if len(match) < 2 {
		return "", nil, false
	}

	return "vault.read_markdown_file", map[string]any{
		"relativePath": match[1],
	}, true
}

func extractToolResultJSON(prompt string) string {
	marker := "Tool result JSON:"
	index := strings.Index(prompt, marker)
	if index < 0 {
		return "{}"
	}

	result := strings.TrimSpace(prompt[index+len(marker):])
	if instructionIndex := strings.Index(result, "\n\nContinue helping the user."); instructionIndex >= 0 {
		return strings.TrimSpace(result[:instructionIndex])
	}

	return result
}

func mustMarshalJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}

	return string(encoded)
}

func emitDebugTrace(trace func(DebugTraceEvent) error, event DebugTraceEvent) error {
	if trace == nil {
		return nil
	}
	if strings.TrimSpace(event.Title) == "" || strings.TrimSpace(event.Text) == "" {
		return nil
	}
	return trace(event)
}

func formatModelRequest(request *model.LLMRequest) string {
	if request == nil {
		return "{}"
	}

	payload := map[string]any{
		"model":    request.Model,
		"contents": formatGenAIContents(request.Contents),
	}
	if request.Config != nil {
		payload["config"] = map[string]any{
			"systemInstruction": formatGenAIContent(request.Config.SystemInstruction),
			"maxOutputTokens":   request.Config.MaxOutputTokens,
			"stopSequences":     request.Config.StopSequences,
			"responseMimeType":  request.Config.ResponseMIMEType,
		}
	}

	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Sprintf("marshal llm request failed: %v", err)
	}
	return string(encoded)
}

func formatGenAIContents(contents []*genai.Content) []map[string]any {
	formatted := make([]map[string]any, 0, len(contents))
	for _, content := range contents {
		if content == nil {
			continue
		}
		formatted = append(formatted, formatGenAIContent(content))
	}
	return formatted
}

func formatGenAIContent(content *genai.Content) map[string]any {
	if content == nil {
		return map[string]any{}
	}

	parts := make([]string, 0, len(content.Parts))
	for _, part := range content.Parts {
		if part == nil || strings.TrimSpace(part.Text) == "" {
			continue
		}
		parts = append(parts, part.Text)
	}

	return map[string]any{
		"role":  content.Role,
		"parts": parts,
	}
}

func capabilityClientFromBridge(config CapabilityBridgeConfig) (closableCapabilityCaller, bool) {
	if strings.TrimSpace(config.MCPServerURL) != "" {
		client, err := newMCPCapabilityClient(context.Background(), config)
		if err != nil {
			return nil, false
		}
		return client, true
	}

	if strings.TrimSpace(config.CallbackURL) == "" || strings.TrimSpace(config.CallbackToken) == "" {
		return nil, false
	}

	return capabilities.NewClient(config.CallbackURL, config.CallbackToken), true
}
