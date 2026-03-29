// Package service exposes the gRPC surface for the Go sidecar.
package service

import (
	"context"
	"fmt"
	"os"
	"strings"

	aiv1 "ofive/sidecars/go/ofive-ai-agent/gen/ofive/aiv1"
	agentruntime "ofive/sidecars/go/ofive-ai-agent/internal/agent"
)

// AIService implements the shared gRPC contract used by the Rust backend.
type AIService struct {
	aiv1.UnimplementedAiAgentServiceServer
	runtime *agentruntime.Runtime
	version string
}

// NewAIService creates a gRPC service backed by the ADK runtime.
func NewAIService(version string) (*AIService, error) {
	runtime, err := agentruntime.New()
	if err != nil {
		return nil, err
	}

	return &AIService{
		runtime: runtime,
		version: version,
	}, nil
}

// Health reports sidecar liveness and metadata.
func (s *AIService) Health(_ context.Context, _ *aiv1.HealthRequest) (*aiv1.HealthResponse, error) {
	return &aiv1.HealthResponse{
		Status:    "ok",
		AgentName: s.runtime.AgentName(),
		Version:   s.version,
		Pid:       int64(os.Getpid()),
	}, nil
}

// Chat runs one agent turn and streams the aggregated text response.
func (s *AIService) Chat(req *aiv1.ChatRequest, stream aiv1.AiAgentService_ChatServer) error {
	ctx := stream.Context()
	sessionID := strings.TrimSpace(req.GetSessionId())
	if sessionID == "" {
		sessionID = "default"
	}

	userID := strings.TrimSpace(req.GetUserId())
	if userID == "" {
		userID = "desktop-user"
	}

	message := strings.TrimSpace(req.GetMessage())
	if message == "" {
		return fmt.Errorf("message is required")
	}

	vendorID := strings.TrimSpace(req.GetVendorId())
	if vendorID == "" {
		vendorID = "mock-echo"
	}

	return s.runtime.StreamChat(ctx, userID, sessionID, message, mapHistoryEntries(req.GetHistory()), agentruntime.VendorConfig{
		VendorID:    vendorID,
		Model:       strings.TrimSpace(req.GetModel()),
		FieldValues: req.GetVendorConfig(),
	}, agentruntime.CapabilityBridgeConfig{
		CallbackURL:              strings.TrimSpace(req.GetCapabilityCallbackUrl()),
		CallbackToken:            strings.TrimSpace(req.GetCapabilityCallbackToken()),
		PersistenceCallbackURL:   strings.TrimSpace(req.GetPersistenceCallbackUrl()),
		PersistenceCallbackToken: strings.TrimSpace(req.GetPersistenceCallbackToken()),
		MCPServerURL:             strings.TrimSpace(req.GetMcpServerUrl()),
		MCPAuthToken:             strings.TrimSpace(req.GetMcpAuthToken()),
		Tools:                    mapToolDescriptors(req.GetTools()),
	}, func(chunk agentruntime.StreamChunk) error {
		return stream.Send(&aiv1.ChatChunk{
			SessionId:                sessionID,
			DeltaText:                chunk.DeltaText,
			AgentName:                chunk.AgentName,
			AccumulatedText:          chunk.AccumulatedText,
			Done:                     chunk.Done,
			EventType:                chunk.EventType,
			Error:                    chunk.ErrorText,
			DebugTitle:               chunk.DebugTitle,
			DebugLevel:               chunk.DebugLevel,
			DebugText:                chunk.DebugText,
			ConfirmationId:           chunk.ConfirmationID,
			ConfirmationHint:         chunk.ConfirmationHint,
			ConfirmationToolName:     chunk.ConfirmationToolName,
			ConfirmationToolArgsJson: chunk.ConfirmationToolArgsJSON,
		})
	})
}

func mapHistoryEntries(items []*aiv1.ChatHistoryEntry) []agentruntime.HistoryEntry {
	history := make([]agentruntime.HistoryEntry, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		history = append(history, agentruntime.HistoryEntry{
			Role: strings.TrimSpace(item.GetRole()),
			Text: item.GetText(),
		})
	}
	return history
}

// SubmitConfirmation resumes one chat session after the user approves or rejects one tool call.
func (s *AIService) SubmitConfirmation(req *aiv1.ConfirmationRequest, stream aiv1.AiAgentService_SubmitConfirmationServer) error {
	ctx := stream.Context()
	sessionID := strings.TrimSpace(req.GetSessionId())
	if sessionID == "" {
		sessionID = "default"
	}

	userID := strings.TrimSpace(req.GetUserId())
	if userID == "" {
		userID = "desktop-user"
	}

	confirmationID := strings.TrimSpace(req.GetConfirmationId())
	if confirmationID == "" {
		return fmt.Errorf("confirmation_id is required")
	}

	vendorID := strings.TrimSpace(req.GetVendorId())
	if vendorID == "" {
		vendorID = "mock-echo"
	}

	return s.runtime.StreamConfirmation(ctx, userID, sessionID, confirmationID, req.GetConfirmed(), agentruntime.VendorConfig{
		VendorID:    vendorID,
		Model:       strings.TrimSpace(req.GetModel()),
		FieldValues: req.GetVendorConfig(),
	}, agentruntime.CapabilityBridgeConfig{
		CallbackURL:              strings.TrimSpace(req.GetCapabilityCallbackUrl()),
		CallbackToken:            strings.TrimSpace(req.GetCapabilityCallbackToken()),
		PersistenceCallbackURL:   strings.TrimSpace(req.GetPersistenceCallbackUrl()),
		PersistenceCallbackToken: strings.TrimSpace(req.GetPersistenceCallbackToken()),
		MCPServerURL:             strings.TrimSpace(req.GetMcpServerUrl()),
		MCPAuthToken:             strings.TrimSpace(req.GetMcpAuthToken()),
		Tools:                    mapToolDescriptors(req.GetTools()),
	}, func(chunk agentruntime.StreamChunk) error {
		return stream.Send(&aiv1.ChatChunk{
			SessionId:                sessionID,
			DeltaText:                chunk.DeltaText,
			AgentName:                chunk.AgentName,
			AccumulatedText:          chunk.AccumulatedText,
			Done:                     chunk.Done,
			EventType:                chunk.EventType,
			Error:                    chunk.ErrorText,
			DebugTitle:               chunk.DebugTitle,
			DebugLevel:               chunk.DebugLevel,
			DebugText:                chunk.DebugText,
			ConfirmationId:           chunk.ConfirmationID,
			ConfirmationHint:         chunk.ConfirmationHint,
			ConfirmationToolName:     chunk.ConfirmationToolName,
			ConfirmationToolArgsJson: chunk.ConfirmationToolArgsJSON,
		})
	})
}

func mapToolDescriptors(items []*aiv1.ToolDescriptor) []agentruntime.ToolDescriptor {
	tools := make([]agentruntime.ToolDescriptor, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		tools = append(tools, agentruntime.ToolDescriptor{
			CapabilityID:         strings.TrimSpace(item.GetCapabilityId()),
			Name:                 strings.TrimSpace(item.GetName()),
			Description:          item.GetDescription(),
			InputSchemaJSON:      item.GetInputSchemaJson(),
			OutputSchemaJSON:     item.GetOutputSchemaJson(),
			RiskLevel:            item.GetRiskLevel(),
			RequiresConfirmation: item.GetRequiresConfirmation(),
			APIVersion:           item.GetApiVersion(),
		})
	}
	return tools
}
