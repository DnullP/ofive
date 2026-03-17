package capabilities

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

const sidecarCapabilitySchemaVersion = "2026-03-17"

// Client calls the Rust-local capability callback endpoint exposed for one chat turn.
type Client struct {
	callbackURL   string
	callbackToken string
	httpClient    *http.Client
}

// CallRequest matches the Rust sidecar capability request contract.
type CallRequest struct {
	SchemaVersion string `json:"schemaVersion"`
	CapabilityID  string `json:"capabilityId"`
	Input         any    `json:"input"`
}

// CallResult matches the Rust sidecar capability result contract.
type CallResult struct {
	SchemaVersion string `json:"schemaVersion"`
	CapabilityID  string `json:"capabilityId"`
	Success       bool   `json:"success"`
	Output        any    `json:"output"`
	Error         string `json:"error"`
}

// NewClient creates a capability callback client.
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

// Call invokes one Rust capability via the callback endpoint.
func (c *Client) Call(ctx context.Context, capabilityID string, input any) (*CallResult, error) {
	requestBody, err := json.Marshal(CallRequest{
		SchemaVersion: sidecarCapabilitySchemaVersion,
		CapabilityID:  capabilityID,
		Input:         input,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal capability request: %w", err)
	}

	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.callbackURL,
		bytes.NewReader(requestBody),
	)
	if err != nil {
		return nil, fmt.Errorf("create capability request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("X-Ofive-Sidecar-Token", strings.TrimSpace(c.callbackToken))

	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf("call capability callback: %w", err)
	}
	defer response.Body.Close()

	rawResponse, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("read capability callback response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf(
			"capability callback returned status=%d body=%s",
			response.StatusCode,
			string(rawResponse),
		)
	}

	var result CallResult
	if err := json.Unmarshal(rawResponse, &result); err != nil {
		return nil, fmt.Errorf("decode capability callback response: %w", err)
	}

	return &result, nil
}
