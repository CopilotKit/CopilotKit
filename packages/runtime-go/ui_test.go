package runtime

import (
	"context"
	"encoding/json"
	"testing"
)

type agentFunc func(context.Context, map[string]any, func(Event) error) error

func (f agentFunc) Run(c context.Context, i map[string]any, e func(Event) error) error {
	return f(c, i, e)
}

func TestA2UIComponentsAreAtomicAndDataProgressive(t *testing.T) {
	config := &A2UIConfig{InjectA2UITool: true, DefaultCatalogID: "catalog"}
	agent := agentFunc(func(ctx context.Context, input map[string]any, emit func(Event) error) error {
		if len(input["tools"].([]any)) != 1 {
			t.Fatal("render tool absent")
		}
		for _, e := range []Event{{"type": "RUN_STARTED"}, {"type": "TOOL_CALL_START", "toolCallId": "call", "toolCallName": "render_a2ui"}, {"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `{"surfaceId":"s","components":[{"id":"root","component":"Column","children":{"componentId":"row","path":"/items"}},{"id":"row","component":"Text","text":{"path":"name"}}`}, {"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `],"data":{"items":[{"name":"one"},`}, {"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `{"name":"two"}]}}`}, {"type": "TOOL_CALL_END", "toolCallId": "call"}, {"type": "RUN_FINISHED"}} {
			if err := emit(e); err != nil {
				return err
			}
		}
		return nil
	})
	var events []Event
	err := (&uiAgent{next: agent, a2ui: config}).Run(context.Background(), map[string]any{"tools": []any{}, "messages": []any{}}, func(e Event) error { events = append(events, e); return nil })
	if err != nil {
		t.Fatal(err)
	}
	painted := 0
	for _, e := range events {
		if e["activityType"] == "a2ui-surface" {
			if e["messageId"] != "a2ui-surface-call" {
				t.Fatal(e)
			}
			if ops, ok := object(e["content"])["a2ui_operations"].([]any); ok {
				painted++
				if len(ops) < 2 {
					t.Fatal("non atomic surface")
				}
			}
		}
	}
	if painted < 2 {
		t.Fatalf("expected progressive snapshots: %v", events)
	}
	if events[len(events)-2]["type"] != "TOOL_CALL_RESULT" {
		t.Fatalf("render result missing: %v", events)
	}
}
func TestA2UIRejectsCycle(t *testing.T) {
	if len(validateComponents([]any{map[string]any{"id": "root", "component": "Column", "child": "root"}}, nil)) == 0 {
		t.Fatal("cycle accepted")
	}
}
func TestA2UIActionAddsSyntheticHistory(t *testing.T) {
	i := map[string]any{"messages": []any{}, "forwardedProps": map[string]any{"a2uiAction": map[string]any{"userAction": map[string]any{"name": "buy", "surfaceId": "shop"}}}}
	processA2UIAction(i)
	m := i["messages"].([]any)
	if len(m) != 2 {
		t.Fatal(m)
	}
	b, _ := json.Marshal(m)
	if !json.Valid(b) {
		t.Fatal("invalid action history")
	}
}

func TestFrontendCatalogEnablesToolUnlessExplicitlyDisabled(t *testing.T) {
	var absent *A2UIConfig
	if c := resolveA2UI(absent, "default", true); c == nil || c.InjectA2UITool != true {
		t.Fatalf("catalog did not enable tool: %v", c)
	}
	disabled := false
	if c := resolveA2UI(&A2UIConfig{Enabled: &disabled}, "default", true); c != nil {
		t.Fatal("overrode disabled config")
	}
	explicit := &A2UIConfig{InjectA2UITool: false}
	if c := resolveA2UI(explicit, "default", true); c.InjectA2UITool != false {
		t.Fatal("overrode tool opt-out")
	}
}

func TestA2UILateIdentityDoesNotReplacePaintedSurface(t *testing.T) {
	stream := newA2UI(&A2UIConfig{}, "")
	stream.process(Event{"type": "TOOL_CALL_START", "toolCallId": "call", "toolCallName": "render_a2ui"})
	stream.process(Event{"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `{"components":[{"id":"root","component":"Text","text":"hello"}]`})
	call := stream.calls["call"]
	if !call.painted {
		t.Fatal("surface was not painted")
	}
	surface, catalog := call.surface, call.catalog
	stream.process(Event{"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `,"surfaceId":"late","catalogId":"late-catalog","data":{"value":1}}`})
	if call.surface != surface || call.catalog != catalog {
		t.Fatalf("painted identity changed: %+v", call)
	}
}
