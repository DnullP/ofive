// Package persistence provides the Go sidecar client for the Rust host
// persistence callback contract.
package persistence

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const apiVersion uint32 = 1

// Scope identifies the host storage namespace used by the sidecar.
type Scope string

const (
	// ScopeModulePrivate stores state under the sidecar/module-private namespace.
	ScopeModulePrivate Scope = "module_private"
)

// Action identifies the persistence operation the sidecar is requesting.
type Action string

const (
	// ActionLoad reads one state entry.
	ActionLoad Action = "load"
	// ActionSave writes one state entry.
	ActionSave Action = "save"
	// ActionDelete removes one state entry.
	ActionDelete Action = "delete"
	// ActionList enumerates all state keys for the owner.
	ActionList Action = "list"
)

// ResponseStatus mirrors the Rust host persistence response status.
type ResponseStatus string

const (
	// ResponseStatusOK indicates a successful persistence operation.
	ResponseStatusOK ResponseStatus = "ok"
	// ResponseStatusNotFound indicates the requested state was not found.
	ResponseStatusNotFound ResponseStatus = "not_found"
	// ResponseStatusConflict indicates optimistic concurrency rejected the write.
	ResponseStatusConflict ResponseStatus = "conflict"
	// ResponseStatusError indicates request or platform level failure.
	ResponseStatusError ResponseStatus = "error"
)

// StateDescriptor describes one stored state entry returned by list requests.
type StateDescriptor struct {
	Owner         string `json:"owner"`
	StateKey      string `json:"stateKey"`
	SchemaVersion uint32 `json:"schemaVersion"`
	Revision      string `json:"revision"`
}

// Request matches the Rust persistence callback request contract.
type Request struct {
	APIVersion       uint32 `json:"apiVersion"`
	ModuleID         string `json:"moduleId"`
	RuntimeID        string `json:"runtimeId"`
	SessionID        string `json:"sessionId,omitempty"`
	TaskID           string `json:"taskId,omitempty"`
	TraceID          string `json:"traceId,omitempty"`
	Scope            Scope  `json:"scope"`
	Owner            string `json:"owner"`
	StateKey         string `json:"stateKey,omitempty"`
	SchemaVersion    uint32 `json:"schemaVersion"`
	ExpectedRevision string `json:"expectedRevision,omitempty"`
	Action           Action `json:"action"`
	Payload          any    `json:"payload,omitempty"`
}

// Response matches the Rust persistence callback response contract.
type Response struct {
	Status        ResponseStatus    `json:"status"`
	Owner         string            `json:"owner"`
	StateKey      string            `json:"stateKey,omitempty"`
	SchemaVersion *uint32           `json:"schemaVersion,omitempty"`
	Revision      *string           `json:"revision,omitempty"`
	Payload       any               `json:"payload,omitempty"`
	Items         []StateDescriptor `json:"items,omitempty"`
	ErrorCode     *string           `json:"errorCode,omitempty"`
	ErrorMessage  *string           `json:"errorMessage,omitempty"`
}

// Client calls the Rust-local persistence callback endpoint exposed for one chat turn.
type Client struct {
	callbackURL   string
	callbackToken string
	httpClient    *http.Client
}

// NewClient creates a persistence callback client.
func NewClient(callbackURL, callbackToken string) *Client {
	return &Client{
		callbackURL:   callbackURL,
		callbackToken: callbackToken,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// Close releases client resources.
func (c *Client) Close() error {
	return nil
}

// NewModulePrivateRequest builds a module-private request using the stable host contract.
func NewModulePrivateRequest(
	moduleID string,
	runtimeID string,
	sessionID string,
	traceID string,
	action Action,
	stateKey string,
	schemaVersion uint32,
	expectedRevision string,
	payload any,
) Request {
	return Request{
		APIVersion:       apiVersion,
		ModuleID:         strings.TrimSpace(moduleID),
		RuntimeID:        strings.TrimSpace(runtimeID),
		SessionID:        strings.TrimSpace(sessionID),
		TraceID:          strings.TrimSpace(traceID),
		Scope:            ScopeModulePrivate,
		Owner:            strings.TrimSpace(moduleID),
		StateKey:         strings.TrimSpace(stateKey),
		SchemaVersion:    schemaVersion,
		ExpectedRevision: strings.TrimSpace(expectedRevision),
		Action:           action,
		Payload:          payload,
	}
}

// Execute invokes one host persistence request via the callback endpoint.
func (c *Client) Execute(ctx context.Context, request Request) (*Response, error) {
	requestBody, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("marshal persistence request: %w", err)
	}

	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.callbackURL,
		bytes.NewReader(requestBody),
	)
	if err != nil {
		return nil, fmt.Errorf("create persistence request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("X-Ofive-Sidecar-Token", strings.TrimSpace(c.callbackToken))

	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf("call persistence callback: %w", err)
	}
	defer response.Body.Close()

	rawResponse, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("read persistence callback response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf(
			"persistence callback returned status=%d body=%s",
			response.StatusCode,
			string(rawResponse),
		)
	}

	var result Response
	if err := json.Unmarshal(rawResponse, &result); err != nil {
		return nil, fmt.Errorf("decode persistence callback response: %w", err)
	}

	return &result, nil
}
