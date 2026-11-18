package runtime

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type agentFunc func(context.Context, map[string]any, func(Event) error) error

func (f agentFunc) Run(c context.Context, i map[string]any, e func(Event) error) error {
	return f(c, i, e)
}

// v09Stream runs events through the A2UI v0.9 middleware alone, without the 1.0 conversion.
func v09Stream(config *a2uiConfig, input map[string]any, events []Event) []Event {
	stream := newA2UI(config, prepareA2UI(config, input))
	out := []Event{}
	for _, event := range events {
		if event["type"] == "RUN_FINISHED" {
			out = append(append(out, stream.finish()...), event)
			continue
		}
		activities := stream.process(event)
		if event["type"] == "TOOL_CALL_RESULT" {
			out = append(append(out, event), activities...)
		} else {
			out = append(append(out, activities...), event)
		}
	}
	return out
}

func TestA2UIComponentsAreAtomicAndDataProgressive(t *testing.T) {
	config := &a2uiConfig{InjectA2UITool: true, DefaultCatalogID: "catalog", ShowProgressTokens: true}
	input := map[string]any{"tools": []any{}, "messages": []any{}}
	events := v09Stream(config, input, []Event{{"type": "RUN_STARTED"}, {"type": "TOOL_CALL_START", "toolCallId": "call", "toolCallName": "render_a2ui"}, {"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `{"surfaceId":"s","components":[{"id":"root","component":"Column","children":{"componentId":"row","path":"/items"}},{"id":"row","component":"Text","text":{"path":"name"}}`}, {"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `],"data":{"items":[{"name":"one"},`}, {"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `{"name":"two"}]}}`}, {"type": "TOOL_CALL_END", "toolCallId": "call"}, {"type": "RUN_FINISHED"}})
	if len(input["tools"].([]any)) != 1 {
		t.Fatal("render tool absent")
	}
	painted := 0
	for _, e := range events {
		if e["activityType"] != "a2ui-surface" {
			continue
		}
		if e["messageId"] != "a2ui-surface-call" {
			t.Fatal(e)
		}
		if ops, ok := object(e["content"])["a2ui_operations"].([]any); ok {
			painted++
			if len(ops) < 2 || object(object(ops[0])["createSurface"])["catalogId"] != "catalog" {
				t.Fatal("non atomic surface")
			}
		}
	}
	if painted < 2 {
		t.Fatalf("expected progressive snapshots: %v", events)
	}
	if events[len(events)-2]["type"] != "TOOL_CALL_RESULT" || events[len(events)-2]["content"] != `{"status":"rendered"}` {
		t.Fatalf("render result missing: %v", events)
	}
}

func TestA2UIRejectsCycle(t *testing.T) {
	if len(validateComponents([]any{map[string]any{"id": "root", "component": "Column", "child": "root"}}, nil)) == 0 {
		t.Fatal("cycle accepted")
	}
}

func TestA2UIActionAddsSyntheticHistory(t *testing.T) {
	messages := []any{map[string]any{"id": "1", "role": "user", "content": "Hi"}}
	i := map[string]any{"messages": messages, "forwardedProps": map[string]any{"a2uiAction": map[string]any{"userAction": map[string]any{"name": "buy", "surfaceId": "shop", "sourceComponentId": "button", "context": map[string]any{"q": "<b>"}}}}}
	prepareA2UI(&a2uiConfig{}, i)
	m := i["messages"].([]any)
	if len(m) != 3 || len(messages) != 1 {
		t.Fatal(m)
	}
	call := object(object(m[1])["toolCalls"].([]any)[0])
	if arguments := str(object(call["function"])["arguments"]); arguments != `{"context":{"q":"<b>"},"name":"buy","sourceComponentId":"button","surfaceId":"shop"}` {
		t.Fatal(arguments)
	}
	if text := object(m[2])["content"]; text != `User performed action "buy" on surface "shop" (component: button). Context: {"q":"<b>"}` || object(m[2])["toolCallId"] != call["id"] {
		t.Fatal(text)
	}
}

func TestA2UIToolGuideAndSchemaMatchTheMiddleware(t *testing.T) {
	schema := map[string]any{"components": map[string]any{"Text": map[string]any{"required": []any{"text"}}}}
	input := map[string]any{"context": []any{map[string]any{"description": a2uiSchemaDescription, "value": `{"catalogId":"client"}`}}, "forwardedProps": map[string]any{}}
	catalog := prepareA2UI(&a2uiConfig{InjectA2UITool: "custom", Schema: schema}, input)
	if catalog != "client" {
		t.Fatalf("frontend catalog %q", catalog)
	}
	context := input["context"].([]any)
	if len(context) != 2 || object(context[0])["value"] != `{"components":{"Text":{"required":["text"]}}}` {
		t.Fatalf("schema context: %v", context)
	}
	guide := str(object(context[1])["value"])
	if object(context[1])["description"] != "A2UI render tool usage guide — how to call custom with valid arguments." || !strings.HasPrefix(guide, "## How to call custom\n\nYou MUST provide ALL required arguments when calling custom:") || !strings.Contains(guide, "```json\n{") || !strings.Contains(guide, "1. NEVER call custom without the `components` array") {
		t.Fatalf("guide: %s", guide)
	}
	if object(input["forwardedProps"])["injectA2UITool"] != "custom" || object(input["tools"].([]any)[0])["name"] != "custom" {
		t.Fatal("tool not injected")
	}
	// A schema without components does not reach the agent.
	empty := map[string]any{}
	prepareA2UI(&a2uiConfig{Schema: map[string]any{"components": map[string]any{}}}, empty)
	if len(empty["context"].([]any)) != 0 {
		t.Fatal("empty schema injected")
	}
}

func TestA2UIGuideHasTheMiddlewareLength(t *testing.T) {
	// RENDER_A2UI_TOOL_GUIDELINES("NAME").length is 2002 UTF-16 units.
	if n := utf16Length(renderA2UIGuide("NAME")); n != 2002 {
		t.Fatalf("guide length %d", n)
	}
}

func TestA2UINothingPaintsBeforeTheSurfaceIDArrives(t *testing.T) {
	stream := newA2UI(&a2uiConfig{}, "")
	stream.process(Event{"type": "TOOL_CALL_START", "toolCallId": "call", "toolCallName": "render_a2ui"})
	if events := stream.process(Event{"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `{"components":[{"id":"root","component":"Text","text":"hello"}]`}); len(events) != 0 || stream.calls["call"].painted {
		t.Fatalf("painted without a surface id: %v", events)
	}
	events := stream.process(Event{"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `,"surfaceId":"late"`})
	call := stream.calls["call"]
	if len(events) != 1 || !call.painted || call.surface != "late" || call.catalog != basicCatalog {
		t.Fatalf("surface was not painted: %v", events)
	}
	stream.process(Event{"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `,"surfaceId":"later","catalogId":"late-catalog","data":{"value":1}}`})
	if call.surface != "late" || call.catalog != basicCatalog || !call.complete {
		t.Fatalf("painted identity changed: %+v", call)
	}
}

func TestA2UIInvalidTreeRetriesWithoutPainting(t *testing.T) {
	stream := newA2UI(&a2uiConfig{MaxAttempts: 2, DebugExposure: "verbose"}, "")
	stream.process(Event{"type": "TOOL_CALL_START", "toolCallId": "call", "toolCallName": "render_a2ui"})
	events := stream.process(Event{"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `{"surfaceId":"s","components":[{"id":"root","component":"Column","children":["missing"]}]}`})
	if len(events) != 1 {
		t.Fatal(events)
	}
	content := object(events[0]["content"])
	if content["status"] != "retrying" || content["attempt"] != 2 || content["maxAttempts"] != 2 || content["debugExposure"] != "verbose" || stream.calls["call"].painted {
		t.Fatalf("retry: %v", content)
	}
}

func TestA2UIToolResultsBecomeSurfacesUnlessPainted(t *testing.T) {
	stream := newA2UI(&a2uiConfig{}, "")
	stream.process(Event{"type": "TOOL_CALL_START", "toolCallId": "tool", "toolCallName": "search"})
	result := `{"a2ui_operations":[{"version":"v0.9","createSurface":{"surfaceId":"a"}},{"version":"v0.9","createSurface":{"surfaceId":"b"}}]}`
	encoded, _ := json.Marshal(result)
	events := stream.process(Event{"type": "TOOL_CALL_RESULT", "toolCallId": "tool", "content": string(encoded)})
	if len(events) != 2 || events[0]["messageId"] != "a2ui-surface-a-tool" || events[1]["messageId"] != "a2ui-surface-b-tool" || stream.outer != "" {
		t.Fatalf("result activities: %v", events)
	}
	failed := stream.process(Event{"type": "TOOL_CALL_RESULT", "toolCallId": "x", "content": `{"code":"a2ui_recovery_exhausted","error":"gave up","attempts":[1,2]}`})
	if len(failed) != 1 || object(failed[0]["content"])["status"] != "failed" || object(failed[0]["content"])["maxAttempts"] != 2 {
		t.Fatalf("failure: %v", failed)
	}
}
