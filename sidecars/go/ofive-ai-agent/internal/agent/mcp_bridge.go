package agentruntime

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"google.golang.org/adk/tool"
	"google.golang.org/adk/tool/mcptoolset"

	"ofive/sidecars/go/ofive-ai-agent/internal/capabilities"
)

type closableCapabilityCaller interface {
	capabilityCaller
	Close() error
}

type mcpCapabilityClient struct {
	session *mcp.ClientSession
}

func newMCPCapabilityClient(ctx context.Context, config CapabilityBridgeConfig) (*mcpCapabilityClient, error) {
	transport := &mcp.StreamableClientTransport{
		Endpoint:   strings.TrimSpace(config.MCPServerURL),
		HTTPClient: newMCPHTTPClient(config.MCPAuthToken),
	}
	client := mcp.NewClient(&mcp.Implementation{
		Name:    appName,
		Version: "0.1.0",
	}, nil)
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		return nil, fmt.Errorf("connect mcp server: %w", err)
	}
	return &mcpCapabilityClient{session: session}, nil
}

func (c *mcpCapabilityClient) Call(ctx context.Context, capabilityID string, input any) (*capabilities.CallResult, error) {
	result, err := c.session.CallTool(ctx, &mcp.CallToolParams{
		Name:      capabilityIDToToolName(capabilityID),
		Arguments: input,
	})
	if err != nil {
		return nil, err
	}

	callResult := &capabilities.CallResult{
		SchemaVersion: "2026-03-17",
		CapabilityID:  capabilityID,
		Success:       !result.IsError,
		Output:        map[string]any{},
	}
	if result.StructuredContent != nil {
		callResult.Output = result.StructuredContent
	}
	if result.IsError {
		callResult.Error = extractMCPErrorText(result)
	}
	return callResult, nil
}

func (c *mcpCapabilityClient) Close() error {
	if c == nil || c.session == nil {
		return nil
	}
	return c.session.Close()
}

func buildMCPToolsets(config CapabilityBridgeConfig) ([]tool.Toolset, error) {
	if strings.TrimSpace(config.MCPServerURL) == "" {
		return nil, nil
	}

	requireConfirmationByName := make(map[string]bool, len(config.Tools))
	for _, item := range config.Tools {
		requireConfirmationByName[item.Name] = item.RequiresConfirmation
	}

	mcpToolset, err := mcptoolset.New(mcptoolset.Config{
		Transport: &mcp.StreamableClientTransport{
			Endpoint:   strings.TrimSpace(config.MCPServerURL),
			HTTPClient: newMCPHTTPClient(config.MCPAuthToken),
		},
		RequireConfirmationProvider: func(name string, _ any) bool {
			return requireConfirmationByName[name]
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create mcp toolset: %w", err)
	}

	return []tool.Toolset{mcpToolset}, nil
}

func capabilityIDToToolName(capabilityID string) string {
	return strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(capabilityID, ".", "_"), "-", "_"))
}

func newMCPHTTPClient(authToken string) *http.Client {
	return &http.Client{
		Transport: &mcpAuthTransport{
			base:      http.DefaultTransport,
			authToken: strings.TrimSpace(authToken),
		},
	}
}

type mcpAuthTransport struct {
	base      http.RoundTripper
	authToken string
}

func (t *mcpAuthTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	cloned := request.Clone(request.Context())
	if t.authToken != "" {
		cloned.Header.Set("Authorization", "Bearer "+t.authToken)
		cloned.Header.Set("X-Ofive-Sidecar-Token", t.authToken)
	}
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	return base.RoundTrip(cloned)
}

func extractMCPErrorText(result *mcp.CallToolResult) string {
	if result == nil {
		return "mcp tool call failed"
	}
	var builder strings.Builder
	for _, content := range result.Content {
		textContent, ok := content.(*mcp.TextContent)
		if !ok {
			continue
		}
		builder.WriteString(textContent.Text)
	}
	if builder.Len() == 0 {
		return "mcp tool call failed"
	}
	return builder.String()
}