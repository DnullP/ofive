package agentruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	sidecarpersistence "ofive/sidecars/go/ofive-ai-agent/internal/persistence"
)

const (
	persistenceBridgeAgentName = "persistence-bridge"
	sidecarModuleID            = "ai-chat"
	sidecarRuntimeID           = "go-sidecar"
)

type explicitPersistenceCommand struct {
	action           sidecarpersistence.Action
	stateKey         string
	schemaVersion    uint32
	expectedRevision string
	taskID           string
	traceID          string
	payload          any
}

type explicitPersistenceCommandPayload struct {
	StateKey         string `json:"stateKey"`
	SchemaVersion    uint32 `json:"schemaVersion"`
	ExpectedRevision string `json:"expectedRevision"`
	TaskID           string `json:"taskId"`
	TraceID          string `json:"traceId"`
	Payload          any    `json:"payload"`
}

func tryHandleExplicitPersistenceCommand(
	ctx context.Context,
	sessionID string,
	message string,
	bridgeConfig CapabilityBridgeConfig,
) (string, string, bool, error) {
	command, handled, err := parseExplicitPersistenceCommand(message)
	if !handled || err != nil {
		return "", persistenceBridgeAgentName, handled, err
	}

	client, ok := persistenceClientFromBridge(bridgeConfig)
	if !ok {
		return "", persistenceBridgeAgentName, true, fmt.Errorf("persistence bridge is not configured")
	}
	defer client.Close()

	request := sidecarpersistence.NewModulePrivateRequest(
		sidecarModuleID,
		sidecarRuntimeID,
		sessionID,
		command.traceID,
		command.action,
		command.stateKey,
		command.schemaVersion,
		command.expectedRevision,
		command.payload,
	)
	request.TaskID = strings.TrimSpace(command.taskID)

	response, err := client.Execute(ctx, request)
	if err != nil {
		return "", persistenceBridgeAgentName, true, err
	}

	formattedOutput, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		return "", persistenceBridgeAgentName, true, fmt.Errorf("marshal persistence response: %w", err)
	}

	return fmt.Sprintf("[persistence:%s]\n%s", command.action, string(formattedOutput)), persistenceBridgeAgentName, true, nil
}

func parseExplicitPersistenceCommand(message string) (explicitPersistenceCommand, bool, error) {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return explicitPersistenceCommand{}, false, nil
	}

	prefixes := []string{"persist ", "/persist "}
	matchedPrefix := ""
	for _, prefix := range prefixes {
		if strings.HasPrefix(trimmed, prefix) {
			matchedPrefix = prefix
			break
		}
	}
	if matchedPrefix == "" {
		return explicitPersistenceCommand{}, false, nil
	}

	remainder := strings.TrimSpace(strings.TrimPrefix(trimmed, matchedPrefix))
	parts := strings.SplitN(remainder, " ", 2)
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return explicitPersistenceCommand{}, true, fmt.Errorf("persistence command missing action")
	}

	action, err := parsePersistenceAction(parts[0])
	if err != nil {
		return explicitPersistenceCommand{}, true, err
	}

	payload := explicitPersistenceCommandPayload{SchemaVersion: 1}
	if len(parts) == 2 {
		if err := json.Unmarshal([]byte(strings.TrimSpace(parts[1])), &payload); err != nil {
			return explicitPersistenceCommand{}, true, fmt.Errorf("invalid persistence input json: %w", err)
		}
	}
	if payload.SchemaVersion == 0 {
		payload.SchemaVersion = 1
	}

	command := explicitPersistenceCommand{
		action:           action,
		stateKey:         strings.TrimSpace(payload.StateKey),
		schemaVersion:    payload.SchemaVersion,
		expectedRevision: strings.TrimSpace(payload.ExpectedRevision),
		taskID:           strings.TrimSpace(payload.TaskID),
		traceID:          strings.TrimSpace(payload.TraceID),
		payload:          payload.Payload,
	}

	if requiresPersistenceStateKey(action) && command.stateKey == "" {
		return explicitPersistenceCommand{}, true, fmt.Errorf("persistence command requires stateKey")
	}
	if action == sidecarpersistence.ActionSave && command.payload == nil {
		return explicitPersistenceCommand{}, true, fmt.Errorf("persistence save command requires payload")
	}

	return command, true, nil
}

func parsePersistenceAction(raw string) (sidecarpersistence.Action, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case string(sidecarpersistence.ActionLoad):
		return sidecarpersistence.ActionLoad, nil
	case string(sidecarpersistence.ActionSave):
		return sidecarpersistence.ActionSave, nil
	case string(sidecarpersistence.ActionDelete):
		return sidecarpersistence.ActionDelete, nil
	case string(sidecarpersistence.ActionList):
		return sidecarpersistence.ActionList, nil
	default:
		return "", fmt.Errorf("unsupported persistence action: %s", raw)
	}
}

func requiresPersistenceStateKey(action sidecarpersistence.Action) bool {
	return action == sidecarpersistence.ActionLoad ||
		action == sidecarpersistence.ActionSave ||
		action == sidecarpersistence.ActionDelete
}

type closablePersistenceCaller interface {
	Execute(ctx context.Context, request sidecarpersistence.Request) (*sidecarpersistence.Response, error)
	Close() error
}

func persistenceClientFromBridge(config CapabilityBridgeConfig) (closablePersistenceCaller, bool) {
	if strings.TrimSpace(config.PersistenceCallbackURL) == "" ||
		strings.TrimSpace(config.PersistenceCallbackToken) == "" {
		return nil, false
	}

	return sidecarpersistence.NewClient(
		config.PersistenceCallbackURL,
		config.PersistenceCallbackToken,
	), true
}
