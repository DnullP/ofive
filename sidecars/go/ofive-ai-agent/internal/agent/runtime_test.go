package agentruntime

import (
	"context"
	"strings"
	"testing"

	"google.golang.org/adk/session"
	"google.golang.org/adk/tool/toolconfirmation"
	"google.golang.org/genai"
)

func TestEmitStreamTextDeltaReturnsIncrementalSuffix(t *testing.T) {
	t.Parallel()

	emitted := "hello"
	var chunk StreamChunk
	err := emitStreamTextDelta("agent", "hello world", &emitted, false, func(next StreamChunk) error {
		chunk = next
		return nil
	})
	if err != nil {
		t.Fatalf("emitStreamTextDelta returned error: %v", err)
	}
	if chunk.EventType != "delta" {
		t.Fatalf("unexpected event type: %s", chunk.EventType)
	}
	if chunk.DeltaText != " world" {
		t.Fatalf("unexpected delta text: %q", chunk.DeltaText)
	}
	if chunk.AccumulatedText != "hello world" {
		t.Fatalf("unexpected accumulated text: %q", chunk.AccumulatedText)
	}
	if chunk.ReasoningDeltaText != "" || chunk.ReasoningAccumulatedText != "" {
		t.Fatalf("expected no reasoning payload on answer delta, got %+v", chunk)
	}
}

func TestEmitStreamTextDeltaReturnsReasoningSuffix(t *testing.T) {
	t.Parallel()

	emitted := "plan"
	var chunk StreamChunk
	err := emitStreamTextDelta("agent", "plan more", &emitted, true, func(next StreamChunk) error {
		chunk = next
		return nil
	})
	if err != nil {
		t.Fatalf("emitStreamTextDelta returned error: %v", err)
	}
	if chunk.ReasoningDeltaText != " more" {
		t.Fatalf("unexpected reasoning delta text: %q", chunk.ReasoningDeltaText)
	}
	if chunk.ReasoningAccumulatedText != "plan more" {
		t.Fatalf("unexpected reasoning accumulated text: %q", chunk.ReasoningAccumulatedText)
	}
	if chunk.DeltaText != "" || chunk.AccumulatedText != "" {
		t.Fatalf("expected answer payload to stay empty on reasoning delta, got %+v", chunk)
	}
}

func TestMergeStreamEventTextPreservesPreviousTurnReasoning(t *testing.T) {
	t.Parallel()

	first, latest := mergeStreamEventText("", "", "先读取目标笔记")
	if first != "先读取目标笔记" {
		t.Fatalf("unexpected first text: %q", first)
	}
	if latest != "先读取目标笔记" {
		t.Fatalf("unexpected latest segment: %q", latest)
	}

	accumulated, latest := mergeStreamEventText(first, latest, "已经拿到笔记内容")
	if accumulated != "先读取目标笔记\n已经拿到笔记内容" {
		t.Fatalf("expected separate non-prefix reasoning events to be preserved, got %q", accumulated)
	}
	if latest != "已经拿到笔记内容" {
		t.Fatalf("unexpected latest segment: %q", latest)
	}

	prefixUpdate, latest := mergeStreamEventText("标题", "标题", "标题是 A")
	if prefixUpdate != "标题是 A" {
		t.Fatalf("expected prefix update to replace current text, got %q", prefixUpdate)
	}
	if latest != "标题是 A" {
		t.Fatalf("unexpected latest segment: %q", latest)
	}
}

func TestMergeStreamEventTextAppendsOnlyLatestSegmentDelta(t *testing.T) {
	t.Parallel()

	current, latest := mergeStreamEventText("", "", "测试结果如下：\n\n| 工具 | 状态 |")
	current, latest = mergeStreamEventText(current, latest, "测试结果如下：\n\n| 工具 | 状态 | 测试结果 |")
	current, latest = mergeStreamEventText(current, latest, "测试结果如下：\n\n| 工具 | 状态 | 测试结果 |\n| vault_get_markdown_graph | 正常 |")

	expected := "测试结果如下：\n\n| 工具 | 状态 | 测试结果 |\n| vault_get_markdown_graph | 正常 |"
	if current != expected {
		t.Fatalf("expected streaming snapshot updates to extend one answer, got %q", current)
	}
	if latest != expected {
		t.Fatalf("unexpected latest segment: %q", latest)
	}
}

func TestProcessADKEventContentDoesNotDuplicateStreamingSnapshots(t *testing.T) {
	t.Parallel()

	state := &streamADKState{}
	chunks := make([]StreamChunk, 0)
	emit := func(chunk StreamChunk) error {
		chunks = append(chunks, chunk)
		return nil
	}

	for _, text := range []string{
		"测试结果如下：\n\n| 工具 | 状态 |",
		"测试结果如下：\n\n| 工具 | 状态 | 测试结果 |",
		"测试结果如下：\n\n| 工具 | 状态 | 测试结果 |\n| vault_get_markdown_graph | 正常 |",
	} {
		err := processADKEventContent(
			"ofive_helper_agent",
			&genai.Content{
				Role:  genai.RoleModel,
				Parts: []*genai.Part{{Text: text}},
			},
			state,
			emit,
		)
		if err != nil {
			t.Fatalf("processADKEventContent returned error: %v", err)
		}
	}

	expected := "测试结果如下：\n\n| 工具 | 状态 | 测试结果 |\n| vault_get_markdown_graph | 正常 |"
	if state.responseText != expected {
		t.Fatalf("expected response text to avoid duplicate snapshots, got %q", state.responseText)
	}
	if len(chunks) != 3 {
		t.Fatalf("expected three incremental chunks, got %d", len(chunks))
	}
	if chunks[1].DeltaText != " 测试结果 |" {
		t.Fatalf("unexpected second delta: %q", chunks[1].DeltaText)
	}
	if chunks[2].DeltaText != "\n| vault_get_markdown_graph | 正常 |" {
		t.Fatalf("unexpected third delta: %q", chunks[2].DeltaText)
	}
}

func TestNormalizeDebugLevelFallsBackToDebug(t *testing.T) {
	t.Parallel()

	if level := normalizeDebugLevel("mystery"); level != "debug" {
		t.Fatalf("unexpected normalized level: %s", level)
	}
}

func TestInferLLMTraceLevelPromotesToolExecutionFailureResponses(t *testing.T) {
	t.Parallel()

	level := inferLLMTraceLevel(
		"Model HTTP response",
		`{"content":"{\"error\":\"Tool execution failed. Details: capability failed\"}"}`,
	)
	if level != "error" {
		t.Fatalf("expected error level, got %s", level)
	}

	if level := inferLLMTraceLevel("Model HTTP request", "tool execution failed"); level != "debug" {
		t.Fatalf("expected non-response traces to remain debug, got %s", level)
	}
	if level := inferLLMTraceLevel("Model HTTP response", "ok"); level != "debug" {
		t.Fatalf("expected normal response traces to remain debug, got %s", level)
	}
}

func TestExtractToolFailureDebugEventsPromotesFunctionResponseErrors(t *testing.T) {
	t.Parallel()

	events := extractToolFailureDebugEvents(&genai.Content{
		Role: genai.RoleUser,
		Parts: []*genai.Part{{
			FunctionResponse: &genai.FunctionResponse{
				ID:   "call-1",
				Name: "vault_apply_markdown_patch",
				Response: map[string]any{
					"error": `Tool execution failed. Details: {"capabilityId":"vault.apply_markdown_patch","error":"patch hunk 1 未命中目标上下文"}`,
				},
			},
		}},
	})

	if len(events) != 1 {
		t.Fatalf("expected one tool failure event, got %d", len(events))
	}
	if events[0].Level != "error" {
		t.Fatalf("expected error level, got %s", events[0].Level)
	}
	if events[0].Title != "Capability call failed" {
		t.Fatalf("unexpected title: %s", events[0].Title)
	}
	if events[0].Text == "" || events[0].Text == "capability=vault_apply_markdown_patch error=" {
		t.Fatalf("expected failure text, got %q", events[0].Text)
	}
}

func TestExtractToolFailureDebugEventsIgnoresSuccessfulFunctionResponses(t *testing.T) {
	t.Parallel()

	events := extractToolFailureDebugEvents(&genai.Content{
		Role: genai.RoleUser,
		Parts: []*genai.Part{{
			FunctionResponse: &genai.FunctionResponse{
				ID:       "call-1",
				Name:     "vault_read_markdown_file",
				Response: map[string]any{"output": map[string]any{"relativePath": "a.md"}},
			},
		}},
	})

	if len(events) != 0 {
		t.Fatalf("expected no tool failure events, got %d", len(events))
	}
}

func TestExtractToolSuccessDebugEventsPromotesFunctionResponseSuccesses(t *testing.T) {
	t.Parallel()

	events := extractToolSuccessDebugEvents(&genai.Content{
		Role: genai.RoleUser,
		Parts: []*genai.Part{{
			FunctionResponse: &genai.FunctionResponse{
				ID:       "call-1",
				Name:     "vault_read_markdown_file",
				Response: map[string]any{"output": map[string]any{"relativePath": "a.md"}},
			},
		}},
	})

	if len(events) != 1 {
		t.Fatalf("expected one tool success event, got %d", len(events))
	}
	if events[0].Level != "info" {
		t.Fatalf("expected info level, got %s", events[0].Level)
	}
	if events[0].Title != "Capability call completed" {
		t.Fatalf("unexpected title: %s", events[0].Title)
	}
	if events[0].Text == "" || !strings.Contains(events[0].Text, "vault_read_markdown_file") {
		t.Fatalf("expected success text, got %q", events[0].Text)
	}
}

func TestProcessADKEventContentEmitsErrorDebugBeforeAssistantDelta(t *testing.T) {
	t.Parallel()

	state := &streamADKState{}
	chunks := make([]StreamChunk, 0)
	emit := func(chunk StreamChunk) error {
		chunks = append(chunks, chunk)
		return nil
	}

	err := processADKEventContent(
		"ofive_helper_agent",
		&genai.Content{
			Role: genai.RoleUser,
			Parts: []*genai.Part{{
				FunctionResponse: &genai.FunctionResponse{
					ID:   "call-1",
					Name: "vault_apply_markdown_patch",
					Response: map[string]any{
						"error": `Tool execution failed. Details: {"capabilityId":"vault.apply_markdown_patch","error":"patch hunk 1 未命中目标上下文"}`,
					},
				},
			}},
		},
		state,
		emit,
	)
	if err != nil {
		t.Fatalf("processADKEventContent returned error for tool failure content: %v", err)
	}

	err = processADKEventContent(
		"ofive_helper_agent",
		&genai.Content{
			Role:  genai.RoleModel,
			Parts: []*genai.Part{{Text: "补丁失败，我会重新读取文件后再生成新的 patch。"}},
		},
		state,
		emit,
	)
	if err != nil {
		t.Fatalf("processADKEventContent returned error for assistant content: %v", err)
	}

	if len(chunks) != 2 {
		t.Fatalf("expected 2 chunks, got %d", len(chunks))
	}
	if chunks[0].EventType != "debug" {
		t.Fatalf("expected first chunk to be debug, got %s", chunks[0].EventType)
	}
	if chunks[0].DebugLevel != "error" {
		t.Fatalf("expected debug chunk to have error level, got %s", chunks[0].DebugLevel)
	}
	if chunks[0].DebugTitle != "Capability call failed" {
		t.Fatalf("unexpected debug title: %s", chunks[0].DebugTitle)
	}
	if chunks[1].EventType != "delta" {
		t.Fatalf("expected second chunk to be delta, got %s", chunks[1].EventType)
	}
	if chunks[1].AccumulatedText != "补丁失败，我会重新读取文件后再生成新的 patch。" {
		t.Fatalf("unexpected accumulated text: %q", chunks[1].AccumulatedText)
	}
}

func TestProcessADKEventContentEmitsInfoDebugForSuccessfulToolResponse(t *testing.T) {
	t.Parallel()

	state := &streamADKState{}
	chunks := make([]StreamChunk, 0)
	emit := func(chunk StreamChunk) error {
		chunks = append(chunks, chunk)
		return nil
	}

	err := processADKEventContent(
		"ofive_helper_agent",
		&genai.Content{
			Role: genai.RoleUser,
			Parts: []*genai.Part{{
				FunctionResponse: &genai.FunctionResponse{
					ID:       "call-1",
					Name:     "vault_read_markdown_file",
					Response: map[string]any{"output": map[string]any{"relativePath": "a.md"}},
				},
			}},
		},
		state,
		emit,
	)
	if err != nil {
		t.Fatalf("processADKEventContent returned error for tool success content: %v", err)
	}

	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].EventType != "debug" {
		t.Fatalf("expected debug chunk, got %s", chunks[0].EventType)
	}
	if chunks[0].DebugLevel != "info" {
		t.Fatalf("expected info debug level, got %s", chunks[0].DebugLevel)
	}
	if chunks[0].DebugTitle != "Capability call completed" {
		t.Fatalf("unexpected debug title: %s", chunks[0].DebugTitle)
	}
}

func TestCanUseCapabilityPlanningDisabledForMCP(t *testing.T) {
	t.Parallel()

	if canUseCapabilityPlanning(CapabilityBridgeConfig{
		MCPServerURL: "http://127.0.0.1:57874/mcp",
		MCPAuthToken: "test-token",
		Tools: []ToolDescriptor{{
			CapabilityID: "vault.search_markdown_files",
			Name:         "vault_search_markdown_files",
		}},
	}) {
		t.Fatal("expected legacy capability planning to be disabled when MCP is configured")
	}
}

func TestBuildAgentInstructionIncludesPatchShapeGuidance(t *testing.T) {
	t.Parallel()

	instruction := buildAgentInstruction(CapabilityBridgeConfig{
		Tools: []ToolDescriptor{{
			CapabilityID:         "vault.apply_markdown_patch",
			Name:                 "vault_apply_markdown_patch",
			Description:          "Apply patch",
			RiskLevel:            "medium",
			RequiresConfirmation: true,
		}},
	}, "")

	if !strings.Contains(instruction, "single-file unifiedDiff string") {
		t.Fatalf("expected patch shape guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "Use the provided native function tools directly") {
		t.Fatalf("expected native function tool guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "Legacy fallback only") || !strings.Contains(instruction, plannedCapabilityCallStartTag) {
		t.Fatalf("expected legacy managed CLI fallback guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "ofive will ask the user before the managed CLI tool is executed") {
		t.Fatalf("expected managed CLI confirmation guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "--- and +++ headers") {
		t.Fatalf("expected unified diff header guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "adjacent separator lines") {
		t.Fatalf("expected blank-line guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "standard unified diff markers") {
		t.Fatalf("expected diff marker guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "numberedContent") {
		t.Fatalf("expected numberedContent guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "copy them verbatim from the latest file read") {
		t.Fatalf("expected verbatim-copy guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "vault.get_canvas_document first") {
		t.Fatalf("expected canvas read-before-save guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "Do not invent partial node fragments") {
		t.Fatalf("expected canvas full-document guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "partial edge fragments") {
		t.Fatalf("expected canvas edge-fragment guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "Every saved edge must still include id, fromNode, and toNode") {
		t.Fatalf("expected canvas edge field guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "set fromSide and toSide explicitly") {
		t.Fatalf("expected explicit edge-side guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "one of top, right, bottom, or left") {
		t.Fatalf("expected edge-side enum guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "Text nodes need visible content") {
		t.Fatalf("expected text-node content guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "a text node without text renders as an empty placeholder") {
		t.Fatalf("expected empty-text-node warning in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "Grouping uses xyflow sub-flows") {
		t.Fatalf("expected xyflow grouping guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "set parentId on the child node to the group node id") {
		t.Fatalf("expected parentId grouping guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "Canvas example") {
		t.Fatalf("expected explicit canvas example guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "\"type\":\"group\"") {
		t.Fatalf("expected group-node JSON example in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "\"parentId\":\"node-a\"") {
		t.Fatalf("expected parentId JSON example in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "\"text\":\"kubelet\"") {
		t.Fatalf("expected text-node JSON example in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "\"fromSide\":\"right\"") {
		t.Fatalf("expected edge-side JSON example in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "the child node remains the actual edge endpoint") {
		t.Fatalf("expected grouped-child edge-endpoint guidance in canvas example, got %q", instruction)
	}
	if !strings.Contains(instruction, "derive node ordering from edge endpoint topology") {
		t.Fatalf("expected canvas topology ordering guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "node A's left side to node B's right side") {
		t.Fatalf("expected canvas directional endpoint example in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "follow the nearest topology direction") {
		t.Fatalf("expected nearest-topology guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "for a target mainly on the right, prefer source right and target left") {
		t.Fatalf("expected explicit rightward edge-side example in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "reduce avoidable edge crossings") {
		t.Fatalf("expected canvas edge-crossing guidance in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "[[供需原理]]") {
		t.Fatalf("expected section insertion example in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "notes/guide.md") {
		t.Fatalf("expected explicit patch example in instruction, got %q", instruction)
	}
}

func TestBuildConversationStateInstructionIncludesUserInterruptionNote(t *testing.T) {
	t.Parallel()

	instruction := buildConversationStateInstruction([]HistoryEntry{
		{
			Role:              "assistant",
			Text:              "partial answer",
			InterruptedByUser: true,
		},
	})

	if !strings.Contains(instruction, "explicitly interrupted by the user") {
		t.Fatalf("expected interruption note in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "manually interrupted by the user") {
		t.Fatalf("expected cause explanation guidance in instruction, got %q", instruction)
	}
}

func TestBuildRuntimeExtraInstructionIncludesContextSnapshot(t *testing.T) {
	t.Parallel()

	instruction := buildRuntimeExtraInstruction([]HistoryEntry{
		{
			Role:              "assistant",
			Text:              "partial answer",
			InterruptedByUser: true,
		},
	}, `{"schemaVersion":"ofive.ai.runtime-context.v1","activeFile":{"path":"notes/a.md"}}`)

	if !strings.Contains(instruction, "explicitly interrupted by the user") {
		t.Fatalf("expected conversation state note in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "Current ofive runtime context snapshot") {
		t.Fatalf("expected runtime context heading in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, `"path":"notes/a.md"`) {
		t.Fatalf("expected context snapshot JSON in instruction, got %q", instruction)
	}
	if !strings.Contains(instruction, "use tools for authoritative file contents") {
		t.Fatalf("expected tool-authority guidance in instruction, got %q", instruction)
	}
}

func TestBuildAgentToolsetsUsesCallbackBridgeForManagedCapabilities(t *testing.T) {
	t.Parallel()

	toolsets, err := buildAgentToolsets(CapabilityBridgeConfig{
		CallbackURL:   "http://127.0.0.1:9000/capabilities/call",
		CallbackToken: "test-token",
		Tools: []ToolDescriptor{{
			CapabilityID:    "vault.read_markdown_file",
			Name:            "vault_read_markdown_file",
			InputSchemaJSON: `{"type":"object","required":["relativePath"]}`,
		}},
	})
	if err != nil {
		t.Fatalf("buildAgentToolsets returned error: %v", err)
	}
	if len(toolsets) != 1 {
		t.Fatalf("expected one managed capability toolset, got %d", len(toolsets))
	}
	tools, err := toolsets[0].Tools(nil)
	if err != nil {
		t.Fatalf("managed toolset should list tools: %v", err)
	}
	if len(tools) != 1 || tools[0].Name() != "vault_read_markdown_file" {
		t.Fatalf("unexpected managed tools: %+v", tools)
	}
}

func TestExtractPendingToolConfirmationReturnsOriginalToolDetails(t *testing.T) {
	t.Parallel()

	confirmation := extractPendingToolConfirmation(&genai.Content{
		Role: genai.RoleModel,
		Parts: []*genai.Part{{
			FunctionCall: &genai.FunctionCall{
				ID:   "confirm-1",
				Name: toolconfirmation.FunctionCallName,
				Args: map[string]any{
					"toolConfirmation": map[string]any{"hint": "Please confirm this write."},
					"originalFunctionCall": map[string]any{
						"name": "vault.create_markdown_file",
						"args": map[string]any{
							"relativePath": "Notes/New.md",
							"content":      "# New",
						},
					},
				},
			},
		}},
	})

	if confirmation == nil {
		t.Fatal("expected pending confirmation to be extracted")
	}
	if confirmation.ID != "confirm-1" {
		t.Fatalf("unexpected confirmation id: %s", confirmation.ID)
	}
	if confirmation.ToolName != "vault.create_markdown_file" {
		t.Fatalf("unexpected tool name: %s", confirmation.ToolName)
	}
	if confirmation.Hint != "Please confirm this write." {
		t.Fatalf("unexpected hint: %s", confirmation.Hint)
	}
	if confirmation.ToolArgsJSON == "" || confirmation.ToolArgsJSON == "{}" {
		t.Fatalf("expected marshaled tool args, got %q", confirmation.ToolArgsJSON)
	}
}

func TestSeedSessionHistoryAppendsUserAndAssistantEventsOnce(t *testing.T) {
	t.Parallel()

	runtime, err := New()
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}

	ctx := context.Background()
	if err := runtime.EnsureSession(ctx, "user-1", "session-1"); err != nil {
		t.Fatalf("EnsureSession returned error: %v", err)
	}

	history := []HistoryEntry{
		{Role: "user", Text: "第一句"},
		{Role: "assistant", Text: "第一句回答"},
	}
	if err := runtime.seedSessionHistory(ctx, "user-1", "session-1", history); err != nil {
		t.Fatalf("seedSessionHistory returned error: %v", err)
	}
	if err := runtime.seedSessionHistory(ctx, "user-1", "session-1", history); err != nil {
		t.Fatalf("second seedSessionHistory returned error: %v", err)
	}

	response, err := runtime.sessionService.Get(ctx, &session.GetRequest{
		AppName:   appName,
		UserID:    "user-1",
		SessionID: "session-1",
	})
	if err != nil {
		t.Fatalf("sessionService.Get returned error: %v", err)
	}
	if response.Session.Events().Len() != 2 {
		t.Fatalf("expected exactly two seeded events, got %d", response.Session.Events().Len())
	}
	if response.Session.Events().At(0).Author != "user" {
		t.Fatalf("unexpected first author: %s", response.Session.Events().At(0).Author)
	}
	if response.Session.Events().At(1).Author != agentName {
		t.Fatalf("unexpected second author: %s", response.Session.Events().At(1).Author)
	}
}
