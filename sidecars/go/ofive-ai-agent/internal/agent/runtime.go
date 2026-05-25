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
	"google.golang.org/adk/tool"
	"google.golang.org/adk/tool/toolconfirmation"

	"ofive/sidecars/go/ofive-ai-agent/internal/capabilities"
	"ofive/sidecars/go/ofive-ai-agent/internal/llms"
)

const (
	appName   = "ofive-ai-sidecar"
	agentName = "ofive_helper_agent"

	maxEmptyToolResponseContinuationAttempts = 2
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

// AgentSkillFile contains one user-created skill file supplied by the Rust host.
type AgentSkillFile struct {
	SkillName    string
	RelativePath string
	Content      string
}

// HistoryEntry contains one persisted user/assistant text message used to restore context.
type HistoryEntry struct {
	Role              string
	Text              string
	ReasoningText     string
	ContentBlocks     []HistoryContentBlock
	InterruptedByUser bool
}

// HistoryContentBlock preserves protocol-level message blocks for vendor-compatible history replay.
type HistoryContentBlock struct {
	Kind       string `json:"kind"`
	Text       string `json:"text,omitempty"`
	Signature  string `json:"signature,omitempty"`
	ToolUseID  string `json:"toolUseId,omitempty"`
	ToolName   string `json:"toolName,omitempty"`
	InputJSON  string `json:"inputJson,omitempty"`
	ResultJSON string `json:"resultJson,omitempty"`
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
	AgentSkillFiles          []AgentSkillFile
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
	ReasoningDeltaText       string
	ReasoningAccumulatedText string
	HistoryContentBlocksJSON string
	DebugTitle               string
	DebugLevel               string
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

type streamADKState struct {
	responseText         string
	emittedText          string
	latestResponseText   string
	reasoningText        string
	emittedReasoningText string
	latestReasoningText  string
	historyContentBlocks []HistoryContentBlock
	confirmation         *pendingToolConfirmation
}

// DebugTraceEvent represents one raw trace emitted during a model-backed turn.
type DebugTraceEvent struct {
	Level string
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
	history []HistoryEntry,
	vendorConfig VendorConfig,
	bridgeConfig CapabilityBridgeConfig,
	contextSnapshotJSON string,
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
		trace,
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

	adkAgent, agentDisplayName, err := r.buildAgent(
		ctx,
		vendorConfig,
		bridgeConfig,
		buildRuntimeExtraInstruction(history, contextSnapshotJSON),
		trace,
	)
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
	contextSnapshotJSON string,
	emit func(StreamChunk) error,
) error {
	trace := func(event DebugTraceEvent) error {
		return emit(StreamChunk{
			EventType:  "debug",
			DebugLevel: normalizeDebugLevel(event.Level),
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
		trace,
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
			history,
			vendorConfig,
			bridgeConfig,
			contextSnapshotJSON,
			trace,
		)
		if err != nil {
			return err
		}
		return emitChunkedTextResponse(responseText, agentDisplayName, emit)
	}

	adkAgent, agentDisplayName, err := r.buildAgent(
		ctx,
		vendorConfig,
		bridgeConfig,
		buildRuntimeExtraInstruction(history, contextSnapshotJSON),
		trace,
	)
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
		content := historyEntryToGenAIContent(item)
		if content == nil || len(content.Parts) == 0 {
			continue
		}

		author := "user"
		if strings.TrimSpace(item.Role) == "assistant" {
			author = agentName
		}

		event := session.NewEvent(fmt.Sprintf("history-seed-%d", index+1))
		event.Author = author
		event.LLMResponse = model.LLMResponse{
			Content:      content,
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
			DebugLevel: normalizeDebugLevel(event.Level),
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

	if shouldUseLegacyManagedConfirmationFlow(vendorConfig.VendorID, bridgeConfig) && persistedConfirmation != nil {
		if err := streamManagedCapabilityConfirmationResponse(
			ctx,
			confirmed,
			persistedConfirmation,
			bridgeConfig,
			trace,
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

	adkAgent, agentDisplayName, err := r.buildAgent(
		ctx,
		vendorConfig,
		bridgeConfig,
		"",
		trace,
	)
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

	state, streamErr := streamADKContentWithState(
		ctx,
		runnerInstance,
		adkAgent,
		agentDisplayName,
		userID,
		sessionID,
		bridgeConfig,
		content,
		emit,
	)
	if streamErr != nil {
		if clearErr := clearCompletedPendingConfirmationAfterStreamFailure(
			ctx,
			sessionID,
			confirmationID,
			confirmed,
			bridgeConfig,
			state,
			emit,
		); clearErr != nil {
			return fmt.Errorf("%w; additionally failed to clear completed pending confirmation: %v", streamErr, clearErr)
		}
		return streamErr
	}

	return deletePersistedPendingConfirmation(
		ctx,
		sessionID,
		confirmationID,
		bridgeConfig,
	)
}

func clearCompletedPendingConfirmationAfterStreamFailure(
	ctx context.Context,
	sessionID string,
	confirmationID string,
	confirmed bool,
	bridgeConfig CapabilityBridgeConfig,
	state *streamADKState,
	emit func(StreamChunk) error,
) error {
	if !shouldClearCompletedPendingConfirmation(confirmed, state) {
		return nil
	}
	if err := deletePersistedPendingConfirmation(ctx, sessionID, confirmationID, bridgeConfig); err != nil {
		return err
	}
	return emitDebugTrace(emitDebugEvent(emit), DebugTraceEvent{
		Level: "warn",
		Title: "Cleared completed pending confirmation",
		Text: fmt.Sprintf(
			"confirmationId=%s already produced a tool result before the follow-up model stream failed",
			strings.TrimSpace(confirmationID),
		),
	})
}

func shouldClearCompletedPendingConfirmation(confirmed bool, state *streamADKState) bool {
	if !confirmed || state == nil {
		return false
	}
	for _, block := range state.historyContentBlocks {
		if strings.TrimSpace(block.Kind) != "tool-result" {
			continue
		}
		toolName := strings.TrimSpace(block.ToolName)
		if toolName != "" && toolName != toolconfirmation.FunctionCallName {
			return true
		}
	}
	return false
}

func historyEntryToGenAIContent(entry HistoryEntry) *genai.Content {
	parts := historyContentBlocksToParts(entry.ContentBlocks)
	if len(parts) == 0 {
		if strings.TrimSpace(entry.ReasoningText) != "" {
			parts = append(parts, &genai.Part{
				Text:    entry.ReasoningText,
				Thought: true,
			})
		}
		if strings.TrimSpace(entry.Text) != "" {
			parts = append(parts, genai.NewPartFromText(entry.Text))
		}
	}
	if len(parts) == 0 {
		return nil
	}

	role := genai.RoleUser
	if strings.TrimSpace(entry.Role) == "assistant" {
		role = genai.RoleModel
	}

	return &genai.Content{
		Role:  role,
		Parts: parts,
	}
}

func historyContentBlocksToParts(blocks []HistoryContentBlock) []*genai.Part {
	parts := make([]*genai.Part, 0, len(blocks))
	for _, block := range blocks {
		switch strings.TrimSpace(block.Kind) {
		case "thinking":
			if strings.TrimSpace(block.Text) == "" {
				continue
			}
			parts = append(parts, &genai.Part{
				Text:             block.Text,
				Thought:          true,
				ThoughtSignature: []byte(block.Signature),
			})
		case "text":
			if strings.TrimSpace(block.Text) == "" {
				continue
			}
			parts = append(parts, genai.NewPartFromText(block.Text))
		case "tool-use":
			args := map[string]any{}
			if strings.TrimSpace(block.InputJSON) != "" {
				_ = json.Unmarshal([]byte(block.InputJSON), &args)
			}
			parts = append(parts, &genai.Part{FunctionCall: &genai.FunctionCall{
				ID:   block.ToolUseID,
				Name: block.ToolName,
				Args: args,
			}})
		case "tool-result":
			response := map[string]any{}
			if strings.TrimSpace(block.ResultJSON) != "" {
				_ = json.Unmarshal([]byte(block.ResultJSON), &response)
			}
			parts = append(parts, &genai.Part{FunctionResponse: &genai.FunctionResponse{
				ID:       block.ToolUseID,
				Name:     block.ToolName,
				Response: response,
			}})
		}
	}
	return parts
}

func buildHistoryContentBlocksFromParts(parts []*genai.Part) []HistoryContentBlock {
	blocks := make([]HistoryContentBlock, 0, len(parts))
	for _, part := range parts {
		if part == nil {
			continue
		}
		if part.FunctionCall != nil {
			blocks = append(blocks, HistoryContentBlock{
				Kind:      "tool-use",
				ToolUseID: strings.TrimSpace(part.FunctionCall.ID),
				ToolName:  strings.TrimSpace(part.FunctionCall.Name),
				InputJSON: marshalJSONObject(part.FunctionCall.Args),
			})
			continue
		}
		if part.FunctionResponse != nil {
			blocks = append(blocks, HistoryContentBlock{
				Kind:       "tool-result",
				ToolUseID:  strings.TrimSpace(part.FunctionResponse.ID),
				ToolName:   strings.TrimSpace(part.FunctionResponse.Name),
				ResultJSON: marshalJSONObject(part.FunctionResponse.Response),
			})
			continue
		}
		if strings.TrimSpace(part.Text) == "" {
			continue
		}
		if part.Thought {
			blocks = append(blocks, HistoryContentBlock{
				Kind:      "thinking",
				Text:      part.Text,
				Signature: string(part.ThoughtSignature),
			})
			continue
		}
		blocks = append(blocks, HistoryContentBlock{
			Kind: "text",
			Text: part.Text,
		})
	}
	return blocks
}

func marshalHistoryContentBlocks(blocks []HistoryContentBlock) string {
	if len(blocks) == 0 {
		return ""
	}
	encoded, err := json.Marshal(blocks)
	if err != nil {
		return ""
	}
	return string(encoded)
}

// marshalJSONObject normalizes tool payload maps into stable JSON strings.
func marshalJSONObject(value map[string]any) string {
	if len(value) == 0 {
		return ""
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(encoded)
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
		HistoryContentBlocksJSON: marshalHistoryContentBlocks([]HistoryContentBlock{{
			Kind: "text",
			Text: responseText,
		}}),
		Done: true,
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
	_, err := streamADKContentWithState(
		ctx,
		runnerInstance,
		adkAgent,
		agentDisplayName,
		userID,
		sessionID,
		bridgeConfig,
		content,
		emit,
	)
	return err
}

func streamADKContentWithState(
	ctx context.Context,
	runnerInstance *runner.Runner,
	adkAgent agent.Agent,
	agentDisplayName string,
	userID string,
	sessionID string,
	bridgeConfig CapabilityBridgeConfig,
	content *genai.Content,
	emit func(StreamChunk) error,
) (*streamADKState, error) {
	state := &streamADKState{}

	if err := runADKContentTurn(
		ctx,
		runnerInstance,
		adkAgent,
		agentDisplayName,
		userID,
		sessionID,
		content,
		state,
		emit,
	); err != nil {
		return state, err
	}

	for attempt := 1; shouldContinueEmptyToolResponse(state) &&
		attempt <= maxEmptyToolResponseContinuationAttempts; attempt++ {
		if err := emitDebugTrace(emitDebugEvent(emit), DebugTraceEvent{
			Level: "warn",
			Title: "Recovering empty response after tool activity",
			Text:  "model stream ended after tool results without final assistant text; requesting continuation",
		}); err != nil {
			return state, err
		}
		recoveryContent := genai.NewContentFromText(
			buildEmptyToolResponseContinuationPrompt(content, state.historyContentBlocks),
			genai.RoleUser,
		)
		if err := runADKContentTurn(
			ctx,
			runnerInstance,
			adkAgent,
			agentDisplayName,
			userID,
			sessionID,
			recoveryContent,
			state,
			emit,
		); err != nil {
			return state, err
		}
	}

	return state, finishStreamADKContent(ctx, sessionID, bridgeConfig, agentDisplayName, state, emit)
}

func runADKContentTurn(
	ctx context.Context,
	runnerInstance *runner.Runner,
	adkAgent agent.Agent,
	agentDisplayName string,
	userID string,
	sessionID string,
	content *genai.Content,
	state *streamADKState,
	emit func(StreamChunk) error,
) error {
	for event, err := range runnerInstance.Run(ctx, userID, sessionID, content, agent.RunConfig{
		StreamingMode: agent.StreamingModeSSE,
	}) {
		if err != nil {
			_ = emitDebugTrace(emitDebugEvent(emit), DebugTraceEvent{
				Level: "error",
				Title: "ADK run failed",
				Text:  err.Error(),
			})
			return fmt.Errorf("run adk turn: %w", err)
		}
		if event == nil || event.Author != adkAgent.Name() || event.LLMResponse.Content == nil {
			continue
		}

		if err := processADKEventContent(
			agentDisplayName,
			event.LLMResponse.Content,
			state,
			emit,
		); err != nil {
			return err
		}
	}
	return nil
}

func finishStreamADKContent(
	ctx context.Context,
	sessionID string,
	bridgeConfig CapabilityBridgeConfig,
	agentDisplayName string,
	state *streamADKState,
	emit func(StreamChunk) error,
) error {
	if state == nil {
		state = &streamADKState{}
	}

	if state.confirmation != nil {
		if err := savePendingConfirmation(ctx, sessionID, *state.confirmation, bridgeConfig); err != nil {
			_ = emitDebugTrace(emitDebugEvent(emit), DebugTraceEvent{
				Level: "error",
				Title: "Persist pending confirmation failed",
				Text:  err.Error(),
			})
			return err
		}

		return emit(StreamChunk{
			EventType:                "confirmation",
			AgentName:                agentDisplayName,
			AccumulatedText:          state.responseText,
			ReasoningAccumulatedText: state.reasoningText,
			HistoryContentBlocksJSON: marshalHistoryContentBlocks(state.historyContentBlocks),
			ConfirmationID:           state.confirmation.ID,
			ConfirmationHint:         state.confirmation.Hint,
			ConfirmationToolName:     state.confirmation.ToolName,
			ConfirmationToolArgsJSON: state.confirmation.ToolArgsJSON,
			Done:                     true,
		})
	}

	if strings.TrimSpace(state.responseText) == "" {
		if fallbackText := emptyADKToolResponseFallbackText(state.historyContentBlocks); fallbackText != "" {
			_ = emitDebugTrace(emitDebugEvent(emit), DebugTraceEvent{
				Level: "warn",
				Title: "ADK returned empty response after tool activity",
				Text:  "model stream completed with tool protocol blocks but without assistant text",
			})
			state.responseText = fallbackText
			state.historyContentBlocks = mergeHistoryContentBlocks(state.historyContentBlocks, []HistoryContentBlock{{
				Kind: "text",
				Text: fallbackText,
			}})
		} else {
			_ = emitDebugTrace(emitDebugEvent(emit), DebugTraceEvent{
				Level: "error",
				Title: "ADK returned empty response",
				Text:  "model stream completed without assistant text",
			})
			return fmt.Errorf("adk returned empty response")
		}
	}

	return emit(StreamChunk{
		EventType:                "done",
		AgentName:                agentDisplayName,
		DeltaText:                "",
		AccumulatedText:          state.responseText,
		ReasoningAccumulatedText: state.reasoningText,
		HistoryContentBlocksJSON: marshalHistoryContentBlocks(state.historyContentBlocks),
		Done:                     true,
	})
}

func processADKEventContent(
	agentDisplayName string,
	content *genai.Content,
	state *streamADKState,
	emit func(StreamChunk) error,
) error {
	if content == nil || state == nil {
		return nil
	}

	if pending := extractPendingToolConfirmation(content); pending != nil {
		state.confirmation = pending
	}

	for _, toolInfo := range extractToolSuccessDebugEvents(content) {
		if err := emitDebugTrace(emitDebugEvent(emit), toolInfo); err != nil {
			return err
		}
	}

	for _, toolError := range extractToolFailureDebugEvents(content) {
		if err := emitDebugTrace(emitDebugEvent(emit), toolError); err != nil {
			return err
		}
	}

	nextHistoryContentBlocks := buildHistoryContentBlocksFromParts(content.Parts)
	state.historyContentBlocks = mergeHistoryContentBlocks(
		state.historyContentBlocks,
		nextHistoryContentBlocks,
	)

	var reasoningParts []string
	var textParts []string
	for _, part := range content.Parts {
		if part == nil || strings.TrimSpace(part.Text) == "" {
			continue
		}
		if part.Thought {
			reasoningParts = append(reasoningParts, part.Text)
			continue
		}
		textParts = append(textParts, part.Text)
	}
	if len(reasoningParts) == 0 && len(textParts) == 0 {
		return nil
	}

	if isToolOnlyHistoryContentBlocks(nextHistoryContentBlocks) {
		return nil
	}

	if len(reasoningParts) > 0 {
		state.reasoningText, state.latestReasoningText = mergeStreamEventText(
			state.reasoningText,
			state.latestReasoningText,
			strings.Join(reasoningParts, "\n"),
		)
		if err := emitStreamTextDelta(
			agentDisplayName,
			state.reasoningText,
			&state.emittedReasoningText,
			true,
			emit,
		); err != nil {
			return err
		}
	}

	if len(textParts) == 0 {
		return nil
	}

	state.responseText, state.latestResponseText = mergeStreamEventText(
		state.responseText,
		state.latestResponseText,
		strings.Join(textParts, "\n"),
	)
	return emitStreamTextDelta(
		agentDisplayName,
		state.responseText,
		&state.emittedText,
		false,
		emit,
	)
}

func mergeHistoryContentBlocks(
	current []HistoryContentBlock,
	next []HistoryContentBlock,
) []HistoryContentBlock {
	if len(next) == 0 {
		return current
	}

	replaceVisibleKinds := map[string]bool{}
	for _, block := range next {
		switch strings.TrimSpace(block.Kind) {
		case "thinking", "text":
			replaceVisibleKinds[strings.TrimSpace(block.Kind)] = true
		}
	}

	merged := make([]HistoryContentBlock, 0, len(current)+len(next))
	for _, block := range current {
		if replaceVisibleKinds[strings.TrimSpace(block.Kind)] {
			continue
		}
		merged = append(merged, block)
	}

	for _, block := range next {
		if hasMatchingHistoryContentBlock(merged, block) {
			continue
		}
		merged = append(merged, block)
	}
	return merged
}

func hasMatchingHistoryContentBlock(blocks []HistoryContentBlock, target HistoryContentBlock) bool {
	for _, block := range blocks {
		if block.Kind == target.Kind &&
			block.Text == target.Text &&
			block.Signature == target.Signature &&
			block.ToolUseID == target.ToolUseID &&
			block.ToolName == target.ToolName &&
			block.InputJSON == target.InputJSON &&
			block.ResultJSON == target.ResultJSON {
			return true
		}
	}
	return false
}

func emptyADKToolResponseFallbackText(blocks []HistoryContentBlock) string {
	if !hasToolHistoryContentBlock(blocks) {
		return ""
	}
	details := summarizeToolActivityForUser(blocks)
	if hasToolResultHistoryContentBlock(blocks) {
		if details != "" {
			return "工具调用已返回，但模型没有返回最终回复。\n\n已记录的工具结果：\n" + details + "\n\n请重试这条消息，或根据上述结果继续补全未完成的步骤。"
		}
		return "工具调用已返回，但模型没有返回最终回复。请重试这条消息，或继续补全未完成的步骤。"
	}
	if details != "" {
		return "模型发起了工具调用，但没有返回最终回复。\n\n已记录的工具调用：\n" + details + "\n\n请重试这条消息，或继续补全未完成的步骤。"
	}
	return "模型发起了工具调用，但没有返回最终回复。请重试这条消息，或继续补全未完成的步骤。"
}

func hasToolHistoryContentBlock(blocks []HistoryContentBlock) bool {
	for _, block := range blocks {
		switch strings.TrimSpace(block.Kind) {
		case "tool-use", "tool-result":
			return true
		}
	}
	return false
}

func hasToolResultHistoryContentBlock(blocks []HistoryContentBlock) bool {
	for _, block := range blocks {
		if strings.TrimSpace(block.Kind) == "tool-result" {
			return true
		}
	}
	return false
}

func shouldContinueEmptyToolResponse(state *streamADKState) bool {
	return state != nil &&
		state.confirmation == nil &&
		strings.TrimSpace(state.responseText) == "" &&
		hasToolResultHistoryContentBlock(state.historyContentBlocks)
}

func buildEmptyToolResponseContinuationPrompt(
	originalContent *genai.Content,
	blocks []HistoryContentBlock,
) string {
	var builder strings.Builder
	builder.WriteString("上一轮已经执行了工具，但模型没有生成最终回复。请继续完成同一个用户请求。\n")
	builder.WriteString("如果任务还没完成，请继续使用可用工具完成它；如果已经完成，请直接给出简洁的最终回复，说明创建或修改了哪些内容。不要重复已经成功完成的工具调用，除非为了验证或继续完成任务确有必要。")

	if originalText := contentTextForPrompt(originalContent); originalText != "" {
		builder.WriteString("\n\n原始用户请求：\n")
		builder.WriteString(originalText)
	}
	if toolSummary := summarizeToolActivityForPrompt(blocks, 8); toolSummary != "" {
		builder.WriteString("\n\n已记录的工具活动：\n")
		builder.WriteString(toolSummary)
	}

	return builder.String()
}

func contentTextForPrompt(content *genai.Content) string {
	if content == nil {
		return ""
	}
	parts := make([]string, 0, len(content.Parts))
	for _, part := range content.Parts {
		if part == nil || strings.TrimSpace(part.Text) == "" {
			continue
		}
		parts = append(parts, strings.TrimSpace(part.Text))
	}
	return strings.Join(parts, "\n")
}

func summarizeToolActivityForPrompt(blocks []HistoryContentBlock, limit int) string {
	summaries := summarizeToolActivity(blocks, limit)
	if len(summaries) == 0 {
		return ""
	}
	return "- " + strings.Join(summaries, "\n- ")
}

func summarizeToolActivityForUser(blocks []HistoryContentBlock) string {
	summaries := summarizeToolActivity(blocks, 6)
	if len(summaries) == 0 {
		return ""
	}
	return "- " + strings.Join(summaries, "\n- ")
}

func summarizeToolActivity(blocks []HistoryContentBlock, limit int) []string {
	if limit <= 0 {
		return nil
	}

	calls := map[string]HistoryContentBlock{}
	summaries := make([]string, 0)
	for _, block := range blocks {
		switch strings.TrimSpace(block.Kind) {
		case "tool-use":
			if strings.TrimSpace(block.ToolUseID) != "" {
				calls[strings.TrimSpace(block.ToolUseID)] = block
			}
		case "tool-result":
			summary := summarizeToolResultBlock(block, calls[strings.TrimSpace(block.ToolUseID)])
			if summary == "" {
				continue
			}
			summaries = append(summaries, summary)
		}
	}

	if len(summaries) == 0 {
		for _, block := range blocks {
			if strings.TrimSpace(block.Kind) != "tool-use" {
				continue
			}
			summary := summarizeToolUseBlock(block)
			if summary == "" {
				continue
			}
			summaries = append(summaries, summary)
		}
	}

	if len(summaries) <= limit {
		return summaries
	}
	return append(summaries[:limit], fmt.Sprintf("还有 %d 条工具活动未显示", len(summaries)-limit))
}

func summarizeToolUseBlock(block HistoryContentBlock) string {
	toolName := strings.TrimSpace(block.ToolName)
	if toolName == "" {
		toolName = "tool"
	}
	if input := summarizeJSONValue(block.InputJSON); input != "" {
		return fmt.Sprintf("%s 调用参数：%s", toolName, input)
	}
	return fmt.Sprintf("%s 已调用", toolName)
}

func summarizeToolResultBlock(result HistoryContentBlock, call HistoryContentBlock) string {
	toolName := strings.TrimSpace(result.ToolName)
	if toolName == "" {
		toolName = strings.TrimSpace(call.ToolName)
	}
	if toolName == "" {
		toolName = "tool"
	}

	input := summarizeJSONValue(call.InputJSON)
	output := summarizeJSONValue(result.ResultJSON)
	switch {
	case input != "" && output != "":
		return fmt.Sprintf("%s 参数：%s；结果：%s", toolName, input, output)
	case output != "":
		return fmt.Sprintf("%s 结果：%s", toolName, output)
	case input != "":
		return fmt.Sprintf("%s 参数：%s", toolName, input)
	default:
		return fmt.Sprintf("%s 已返回结果", toolName)
	}
}

func summarizeJSONValue(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}

	var value any
	if err := json.Unmarshal([]byte(trimmed), &value); err == nil {
		if summary := summarizeDecodedJSONValue(value); summary != "" {
			return summary
		}
	}
	return truncateSingleLine(trimmed, 160)
}

func summarizeDecodedJSONValue(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		return summarizeJSONObject(typed)
	case []any:
		return fmt.Sprintf("%d 项", len(typed))
	case string:
		return truncateSingleLine(typed, 120)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case float64:
		return fmt.Sprintf("%g", typed)
	default:
		return ""
	}
}

func summarizeJSONObject(object map[string]any) string {
	parts := make([]string, 0)
	for _, key := range []string{
		"success",
		"capabilityId",
		"relativePath",
		"relativeDirectoryPath",
		"path",
		"title",
		"name",
		"query",
		"ok",
	} {
		if value, ok := object[key]; ok {
			if summary := summarizeDecodedJSONValue(value); summary != "" {
				parts = append(parts, fmt.Sprintf("%s=%s", key, summary))
			}
		}
	}

	if output, ok := object["output"]; ok {
		if summary := summarizeToolOutput(output); summary != "" {
			parts = append(parts, "output="+summary)
		}
	}
	if errValue, ok := object["error"]; ok {
		if summary := summarizeDecodedJSONValue(errValue); summary != "" {
			parts = append(parts, "error="+summary)
		}
	}

	if len(parts) == 0 {
		encoded, err := json.Marshal(object)
		if err != nil {
			return ""
		}
		return truncateSingleLine(string(encoded), 160)
	}
	return truncateSingleLine(strings.Join(parts, ", "), 160)
}

func summarizeToolOutput(value any) string {
	switch typed := value.(type) {
	case []any:
		if len(typed) == 0 {
			return "0 项"
		}
		paths := make([]string, 0, min(len(typed), 3))
		for _, item := range typed {
			object, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if path, ok := object["relativePath"].(string); ok && strings.TrimSpace(path) != "" {
				paths = append(paths, strings.TrimSpace(path))
				continue
			}
			if title, ok := object["title"].(string); ok && strings.TrimSpace(title) != "" {
				paths = append(paths, strings.TrimSpace(title))
			}
		}
		if len(paths) == 0 {
			return fmt.Sprintf("%d 项", len(typed))
		}
		extra := ""
		if len(typed) > len(paths) {
			extra = fmt.Sprintf(" 等 %d 项", len(typed))
		}
		return strings.Join(paths, ", ") + extra
	case map[string]any:
		return summarizeJSONObject(typed)
	default:
		return summarizeDecodedJSONValue(value)
	}
}

func truncateSingleLine(value string, limit int) string {
	normalized := strings.Join(strings.Fields(value), " ")
	if limit <= 0 || len(normalized) <= limit {
		return normalized
	}
	if limit <= 3 {
		return normalized[:limit]
	}
	return normalized[:limit-3] + "..."
}

func isToolOnlyHistoryContentBlocks(blocks []HistoryContentBlock) bool {
	if len(blocks) == 0 {
		return false
	}
	for _, block := range blocks {
		switch strings.TrimSpace(block.Kind) {
		case "tool-use", "tool-result":
			continue
		default:
			return false
		}
	}
	return true
}

func mergeStreamEventText(current string, latestSegment string, next string) (string, string) {
	if strings.TrimSpace(next) == "" {
		return current, latestSegment
	}
	if current == "" {
		return next, next
	}
	if next == current || strings.HasPrefix(next, current) {
		return next, next
	}
	if strings.HasPrefix(current, next) {
		return current, latestSegment
	}
	if latestSegment != "" {
		if next == latestSegment {
			return current, latestSegment
		}
		if strings.HasPrefix(next, latestSegment) {
			return current + strings.TrimPrefix(next, latestSegment), next
		}
		if strings.HasPrefix(latestSegment, next) {
			return current, latestSegment
		}
	}
	return current + "\n" + next, next
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

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func (r *Runtime) buildAgent(
	ctx context.Context,
	vendorConfig VendorConfig,
	bridgeConfig CapabilityBridgeConfig,
	extraInstruction string,
	trace func(DebugTraceEvent) error,
) (agent.Agent, string, error) {
	var llm traceableLLM
	var providerLabel string

	switch strings.TrimSpace(vendorConfig.VendorID) {
	case "anthropic-compatible":
		llm = llms.NewAnthropicCompatibleLLM(
			"anthropic-compatible",
			vendorConfig.FieldValues["endpoint"],
			vendorConfig.Model,
			vendorConfig.FieldValues["apiKey"],
			vendorConfig.FieldValues["anthropicVersion"],
		)
		providerLabel = "anthropic-compatible"
	case "minimax-anthropic":
		llm = llms.NewMinimaxLLMWithAnthropicVersion(
			"minimax-anthropic",
			vendorConfig.FieldValues["endpoint"],
			vendorConfig.Model,
			vendorConfig.FieldValues["apiKey"],
			vendorConfig.FieldValues["anthropicVersion"],
		)
		providerLabel = "minimax"
	case "openai-compatible":
		llm = llms.NewOpenAICompatibleLLM(
			"openai-compatible",
			firstNonEmptyString(vendorConfig.FieldValues["baseUrl"], vendorConfig.FieldValues["endpoint"]),
			vendorConfig.Model,
			vendorConfig.FieldValues["apiKey"],
		)
		providerLabel = "openai-compatible"
	case "codex-compatible":
		llm = llms.NewCodexCompatibleLLM(
			"codex-compatible",
			firstNonEmptyString(vendorConfig.FieldValues["baseUrl"], vendorConfig.FieldValues["endpoint"]),
			vendorConfig.Model,
			vendorConfig.FieldValues["apiKey"],
		)
		providerLabel = "codex-compatible"
	case "baidu-qianfan":
		llm = llms.NewBaiduLLM(
			"baidu-qianfan",
			vendorConfig.FieldValues["endpoint"],
			vendorConfig.Model,
			vendorConfig.FieldValues["appId"],
			vendorConfig.FieldValues["authToken"],
		)
		providerLabel = "baidu"
	default:
		return nil, "", fmt.Errorf("unsupported vendor: %s", vendorConfig.VendorID)
	}

	return r.buildADKAgent(ctx, llm, providerLabel, bridgeConfig, extraInstruction, trace)
}

type traceableLLM interface {
	model.LLM
	SetTraceEmitter(func(title string, text string) error)
}

func (r *Runtime) buildADKAgent(
	ctx context.Context,
	llm traceableLLM,
	providerLabel string,
	bridgeConfig CapabilityBridgeConfig,
	extraInstruction string,
	trace func(DebugTraceEvent) error,
) (agent.Agent, string, error) {
	llm.SetTraceEmitter(func(title string, text string) error {
		return emitDebugTrace(trace, DebugTraceEvent{
			Level: inferLLMTraceLevel(title, text),
			Title: title,
			Text:  text,
		})
	})

	toolsets, err := buildAgentToolsets(ctx, bridgeConfig)
	if err != nil {
		return nil, "", err
	}

	var modelRequestSequence atomic.Int32

	adkAgent, err := llmagent.New(llmagent.Config{
		Name:        agentName,
		Description: "AI assistant for ofive desktop notes.",
		Instruction: buildAgentInstruction(bridgeConfig, extraInstruction),
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
		return nil, "", fmt.Errorf("create %s llm agent: %w", providerLabel, err)
	}

	return adkAgent, llm.Name(), nil
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

func shouldUseLegacyManagedConfirmationFlow(
	vendorID string,
	bridgeConfig CapabilityBridgeConfig,
) bool {
	trimmedVendorID := strings.TrimSpace(vendorID)
	if trimmedVendorID != "" && trimmedVendorID != "mock-echo" {
		return false
	}
	return canUseCapabilityPlanning(bridgeConfig)
}

// buildAgentToolsets combines embedded skills, managed capability tools, and
// optional MCP tools into the ADK toolset list for one agent turn.
func buildAgentToolsets(
	ctx context.Context,
	bridgeConfig CapabilityBridgeConfig,
) ([]tool.Toolset, error) {
	managedToolsets, err := buildCapabilityToolsets(bridgeConfig)
	if err != nil {
		return nil, err
	}

	mcpToolsets, err := buildMCPToolsets(bridgeConfig)
	if err != nil {
		return nil, err
	}

	combinedToolsets := append([]tool.Toolset{}, managedToolsets...)
	combinedToolsets = append(combinedToolsets, mcpToolsets...)
	if len(combinedToolsets) == 0 {
		return nil, nil
	}

	skillToolsets, err := buildSkillToolsets(ctx, bridgeConfig.AgentSkillFiles)
	if err != nil {
		return nil, err
	}

	return append(skillToolsets, combinedToolsets...), nil
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

func buildAgentInstruction(
	bridgeConfig CapabilityBridgeConfig,
	extraInstruction string,
) string {
	baseInstruction := "You are the AI assistant inside ofive. Answer clearly, concisely, and stay grounded in the user's request."
	if strings.TrimSpace(extraInstruction) != "" {
		baseInstruction += "\n\n" + strings.TrimSpace(extraInstruction)
	}
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
	managedToolCallGuidance := "Use the provided native function tools directly whenever they are available. Do not write " +
		plannedCapabilityCallStartTag + " blocks in normal answers. Legacy fallback only: when native function calling is not available, respond with exactly one " +
		plannedCapabilityCallStartTag + " ... " + plannedCapabilityCallEndTag +
		" block and no extra text. The block JSON shape is {\"capabilityId\":\"vault.read_markdown_file\",\"input\":{...}}. " +
		"Use capabilityId from the available tools list. For confirmation=true tools, still emit the block; ofive will ask the user before the managed CLI tool is executed. "
	skillAndRoutingGuidance := "If a relevant skill is available, load it before executing a multi-step workflow. " +
		"Prefer ofive managed capability tools for local vault files, notes, canvases, and workspace state. " +
		"Use MCP tools for external integrations or user-provided remote systems, and keep mixed workflows on the correct side of that boundary. "

	return baseInstruction + "\n\n" +
		managedToolCallGuidance +
		skillAndRoutingGuidance +
		"Confirmation requests are single-flight: request at most one confirmation-required tool call at a time. Do not claim that several other write calls are already waiting for approval unless ofive actually emitted those confirmations. Wait for the approved tool result before planning the next mutating tool call. " +
		"When the user asks about local vault content, notes, outlines, backlinks, search results, or graph data, you must use the provided tools instead of guessing or claiming you cannot access local files. " +
		"Never invent tools, parameters, or file contents. If the user's request would require writing, renaming, deleting, or any other modification but no such executable tool is listed, explicitly say that the current assistant session only has non-mutating tools available and do not claim success. " +
		"After tool results are available, answer directly and stay grounded in those results. " +
		"For localized Markdown edits, prefer vault.apply_markdown_patch over whole-file overwrite tools. " +
		"Always read the target file immediately before building a patch, even if you saw older content earlier in the conversation. " +
		"After a Markdown write or patch succeeds, read the target file again before claiming exact final line content or that a specific link/text was fixed. Do not infer final file content from the intended patch or from resolve/search results. " +
		"For canvas edits, always call vault.get_canvas_document first, modify the returned document object, and then send the full document back with vault.save_canvas_document. Do not invent partial node fragments or partial edge fragments. Keep every unchanged node and edge unless you intentionally remove it. Every saved node must still include id, type, x, y, width, and height, and canvas geometry may be floating point. Every saved edge must still include id, fromNode, and toNode, and should preserve existing fromSide, toSide, label, color, and unknown fields unless you intentionally change them. Edge attachment sides are visually important: when you need to control which side of a node a line uses, set fromSide and toSide explicitly with one of top, right, bottom, or left instead of leaving the direction ambiguous. Text nodes need visible content: if a node uses type=text, populate its text field with the actual label or body you want to show, because a text node without text renders as an empty placeholder. Grouping uses xyflow sub-flows rather than geometry inference: if a node belongs to a group, set parentId on the child node to the group node id instead of relying on rectangle overlap or edge topology to imply membership. Group nodes still need x, y, width, and height because of the canvas contract, but treat that rectangle as an initial frame rather than the source of truth for membership. Do not resize or reposition unrelated nodes only to make a group rectangle tightly fit its members. Prefer connecting real content nodes instead of treating the group frame as the semantic endpoint of an edge unless the user explicitly asks for that. " +
		"Canvas example: a group node might be {\"id\":\"node-a\",\"type\":\"group\",\"x\":100,\"y\":220,\"width\":320,\"height\":220,\"label\":\"Worker Node\"}; a grouped text node might be {\"id\":\"kubelet-a\",\"type\":\"text\",\"parentId\":\"node-a\",\"x\":140,\"y\":260,\"width\":180,\"height\":80,\"text\":\"kubelet\"}; and an edge to a pod on the right might be {\"id\":\"edge-a\",\"fromNode\":\"kubelet-a\",\"fromSide\":\"right\",\"toNode\":\"pod-a\",\"toSide\":\"left\"}. In that example, parentId carries the grouping relationship, the child node remains the actual edge endpoint, and the edge side choices match the left-to-right topology. " +
		"For canvas generation or cleanup, derive node ordering from edge endpoint topology before doing cosmetic spacing. If an edge connects node A's left side to node B's right side, place node B to the left of node A; if it connects A's right side to B's left side, place node B to the right of node A; if it connects A's top side to B's bottom side, place node B above node A; if it connects A's bottom side to B's top side, place node B below node A. When choosing fromSide and toSide, follow the nearest topology direction: for a target mainly on the right, prefer source right and target left; for a target mainly on the left, prefer source left and target right; for a target mainly below, prefer source bottom and target top; for a target mainly above, prefer source top and target bottom. Avoid side assignments that fight the intended spatial relationship unless the user explicitly wants that effect. Prefer layouts that satisfy these directional constraints, keep siblings aligned along the same flow axis, and reduce avoidable edge crossings. " +
		"If vault.read_markdown_file returns numberedContent, treat it only as a positioning aid; copy exact source lines from content when building unified diffs, and never include line-number prefixes in the patch body. " +
		"When using vault.apply_markdown_patch, send only relativePath plus a single-file unifiedDiff string. " +
		"The unified diff must include --- and +++ headers that point to the same markdown file as relativePath, followed by one or more standard @@ hunks. " +
		"When composing removed or context lines, copy them verbatim from the latest file read instead of rewriting them into your preferred formatting. " +
		"Preserve blank separator lines in hunks, but they must still carry a diff marker: unchanged blank lines are represented by a single leading space line, added blank lines use +, and removed blank lines use -. Do not emit bare empty hunk lines. For Markdown section edits, adjacent separator lines between a list or paragraph and the next heading or link often matter, so include those blank lines in the hunk when they are part of the edited block. " +
		"If you are replacing one contiguous block, send one @@ hunk for that block instead of rewriting the full file. " +
		"Use standard unified diff markers: unchanged lines start with a space, removed lines start with -, and added lines start with +. " +
		"Valid example: {\"relativePath\":\"notes/guide.md\",\"unifiedDiff\":\"--- a/notes/guide.md\\n+++ b/notes/guide.md\\n@@ -3,3 +3,3 @@\\n alpha\\n-beta\\n+beta patched\\n gamma\"}. " +
		"Valid section-insertion example: {\"relativePath\":\"notes/guide.md\",\"unifiedDiff\":\"--- a/notes/guide.md\\n+++ b/notes/guide.md\\n@@ -5,4 +5,7 @@\\n ## 影响因素\\n - 价格变化\\n - 需求弹性\\n - 市场结构\\n+\\n+## 具体例子\\n+\\n+示例内容\\n \\n [[供需原理]]\"}. " +
		"If a patch fails because of unified diff format or context mismatch, treat that tool result as recoverable: read the file again and build a corrected patch from the latest exact lines instead of reusing the failed hunk. " +
		"Do not switch to vault.save_markdown_file as a fallback unless the user explicitly asked for a whole-file rewrite or explicitly approved replacing the full file content. Available tools:\n" + strings.Join(toolLines, "\n")
}

func buildConversationStateInstruction(history []HistoryEntry) string {
	for index := len(history) - 1; index >= 0; index-- {
		entry := history[index]
		if strings.TrimSpace(entry.Role) != "assistant" || !entry.InterruptedByUser {
			continue
		}

		return "Conversation state note: the latest assistant response in the restored history was explicitly interrupted by the user before it finished. Treat that response as incomplete. If the user asks why it stopped or why it has no ending, explain that it was manually interrupted by the user rather than naturally completed or silently truncated."
	}

	return ""
}

func buildRuntimeExtraInstruction(history []HistoryEntry, contextSnapshotJSON string) string {
	parts := make([]string, 0, 2)
	if conversationStateInstruction := buildConversationStateInstruction(history); strings.TrimSpace(conversationStateInstruction) != "" {
		parts = append(parts, conversationStateInstruction)
	}

	if trimmedContext := strings.TrimSpace(contextSnapshotJSON); trimmedContext != "" {
		parts = append(parts,
			"Current ofive runtime context snapshot (JSON). Treat this as UI context only; use tools for authoritative file contents before answering about vault data:\n"+trimmedContext,
		)
	}

	return strings.Join(parts, "\n\n")
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
	event.Level = normalizeDebugLevel(event.Level)
	return trace(event)
}

func emitDebugEvent(emit func(StreamChunk) error) func(DebugTraceEvent) error {
	return func(event DebugTraceEvent) error {
		return emit(StreamChunk{
			EventType:  "debug",
			DebugLevel: normalizeDebugLevel(event.Level),
			DebugTitle: event.Title,
			DebugText:  event.Text,
		})
	}
}

func extractToolFailureDebugEvents(content *genai.Content) []DebugTraceEvent {
	if content == nil {
		return nil
	}

	events := make([]DebugTraceEvent, 0)
	for _, part := range content.Parts {
		if part == nil || part.FunctionResponse == nil {
			continue
		}

		failureText, ok := extractToolFailureText(part.FunctionResponse.Response)
		if !ok {
			continue
		}

		toolName := strings.TrimSpace(part.FunctionResponse.Name)
		if toolName == "" {
			toolName = "unknown-tool"
		}

		events = append(events, DebugTraceEvent{
			Level: "error",
			Title: "Capability call failed",
			Text:  fmt.Sprintf("capability=%s error=%s", toolName, failureText),
		})
	}

	return events
}

func extractToolSuccessDebugEvents(content *genai.Content) []DebugTraceEvent {
	if content == nil {
		return nil
	}

	events := make([]DebugTraceEvent, 0)
	for _, part := range content.Parts {
		if part == nil || part.FunctionResponse == nil {
			continue
		}

		toolName := strings.TrimSpace(part.FunctionResponse.Name)
		if toolName == "" || toolName == toolconfirmation.FunctionCallName {
			continue
		}
		if _, failed := extractToolFailureText(part.FunctionResponse.Response); failed {
			continue
		}

		events = append(events, DebugTraceEvent{
			Level: "info",
			Title: "Capability call completed",
			Text: fmt.Sprintf(
				"capability=%s output=%s",
				toolName,
				formatToolResponseForDebug(part.FunctionResponse.Response),
			),
		})
	}

	return events
}

func extractToolFailureText(response any) (string, bool) {
	switch value := response.(type) {
	case map[string]any:
		if errorValue, ok := value["error"]; ok {
			if text := stringifyToolFailureValue(errorValue); text != "" {
				return text, true
			}
		}
		if contentValue, ok := value["content"]; ok {
			if text := stringifyToolFailureValue(contentValue); text != "" {
				return text, true
			}
		}
	case string:
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return "", false
		}
		if strings.Contains(strings.ToLower(trimmed), "tool execution failed") {
			return trimmed, true
		}

		var decoded any
		if err := json.Unmarshal([]byte(trimmed), &decoded); err == nil {
			return extractToolFailureText(decoded)
		}
	}

	return "", false
}

func stringifyToolFailureValue(value any) string {
	switch typed := value.(type) {
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return ""
		}
		if strings.Contains(strings.ToLower(trimmed), "tool execution failed") {
			return trimmed
		}

		var decoded any
		if err := json.Unmarshal([]byte(trimmed), &decoded); err == nil {
			if nested, ok := extractToolFailureText(decoded); ok {
				return nested
			}
		}
		return ""
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return stringifyToolFailureValue(string(encoded))
	}
}

func formatToolResponseForDebug(response any) string {
	if response == nil {
		return "null"
	}

	switch value := response.(type) {
	case string:
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return "\"\""
		}
		return trimmed
	default:
		encoded, err := json.Marshal(response)
		if err != nil {
			return "{}"
		}
		return string(encoded)
	}
}

func normalizeDebugLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "error", "warn", "info", "debug":
		return strings.ToLower(strings.TrimSpace(level))
	default:
		return "debug"
	}
}

func inferLLMTraceLevel(title string, text string) string {
	if strings.TrimSpace(title) != "Model HTTP response" {
		return "debug"
	}

	normalizedText := strings.ToLower(text)
	if strings.Contains(normalizedText, "tool execution failed") {
		return "error"
	}

	return "debug"
}

func emitStreamTextDelta(
	agentDisplayName string,
	nextText string,
	emittedText *string,
	reasoning bool,
	emit func(StreamChunk) error,
) error {
	if emittedText == nil {
		return fmt.Errorf("emitted text cursor is required")
	}

	if nextText == *emittedText {
		return nil
	}

	deltaText := nextText
	if strings.HasPrefix(nextText, *emittedText) {
		deltaText = strings.TrimPrefix(nextText, *emittedText)
	}

	*emittedText = nextText
	if deltaText == "" {
		return nil
	}

	return emit(StreamChunk{
		EventType:                "delta",
		AgentName:                agentDisplayName,
		DeltaText:                map[bool]string{true: "", false: deltaText}[reasoning],
		AccumulatedText:          map[bool]string{true: "", false: nextText}[reasoning],
		ReasoningDeltaText:       map[bool]string{true: deltaText, false: ""}[reasoning],
		ReasoningAccumulatedText: map[bool]string{true: nextText, false: ""}[reasoning],
		Done:                     false,
	})
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
