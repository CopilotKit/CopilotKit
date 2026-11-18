package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

// decoded returns a JSON value as encoding/json decodes it, for comparisons.
func decoded(t *testing.T, value any) any {
	t.Helper()
	var out any
	if err := json.Unmarshal([]byte(compactJSON(value)), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func parse(t *testing.T, text string) any {
	t.Helper()
	var out any
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func assertJSON(t *testing.T, got, want any) {
	t.Helper()
	if g, w := decoded(t, got), decoded(t, want); !reflect.DeepEqual(g, w) {
		t.Fatalf("got  %s\nwant %s", compactJSON(g), compactJSON(w))
	}
}

var productCard = map[string]any{
	"description": "A product",
	"props":       map[string]any{"type": "object", "properties": map[string]any{"name": map[string]any{"type": "string"}, "price": map[string]any{"type": "number"}}, "required": []any{"name"}},
	"events":      map[string]any{"onBuy": map[string]any{"description": "Buys it", "parameters": map[string]any{}}},
	"slots":       map[string]any{"footer": "single", "children": "multiple"},
}
var textComponent = map[string]any{"props": map[string]any{"type": "object", "properties": map[string]any{"text": map[string]any{"type": "string"}}}}

type envelopeOptions struct {
	transport  string
	components map[string]any
	noCatalog  bool
	surfaces   map[string]any
	action     map[string]any
}

// testEnvelope returns the forwardedProps of a run from the 1.0 client, as decoded JSON.
func testEnvelope(t *testing.T, o envelopeOptions) map[string]any {
	t.Helper()
	if o.transport == "" {
		o.transport = "tool"
	}
	catalog := map[string]any{"catalogId": "shop", "protocolVersion": "1.0", "functions": map[string]any{}}
	if !o.noCatalog {
		catalog["components"] = o.components
		if o.components == nil {
			catalog["components"] = map[string]any{"ProductCard": productCard, "Text": textComponent}
		}
	}
	surfaces := o.surfaces
	if surfaces == nil {
		surfaces = map[string]any{}
	}
	extensions := map[string]any{"copilotkit_format": 3, "copilotkit_transport": o.transport, "copilotkit_targets": []any{map[string]any{"id": "chat", "kind": "chat"}, map[string]any{"id": "side", "kind": "inline", "components": []any{"Text"}}}, "copilotkit_surfaces": surfaces, "copilotkit_contextSent": false}
	if o.action != nil {
		extensions["copilotkit_action"] = o.action
	}
	return decoded(t, map[string]any{"copilotkit": map[string]any{"ui": map[string]any{"1.0": map[string]any{"supportedCatalogIds": []any{"shop"}, "inlineCatalogs": []any{catalog}}, "metadata": map[string]any{"extensions": extensions}}}}).(map[string]any)
}

func op10(kind string, payload map[string]any) map[string]any {
	return map[string]any{"version": "1.0", kind: payload}
}

func renderCallEvents(id string, chunks ...string) []Event {
	events := []Event{{"type": "TOOL_CALL_START", "toolCallId": id, "toolCallName": "render_ui"}}
	for _, chunk := range chunks {
		events = append(events, Event{"type": "TOOL_CALL_ARGS", "toolCallId": id, "delta": chunk})
	}
	return append(events, Event{"type": "TOOL_CALL_END", "toolCallId": id})
}

// runGenerativeUI passes events through the render_ui middleware, as uiAgent does.
func runGenerativeUI(t *testing.T, events []Event, forwarded map[string]any, messages []any) []Event {
	t.Helper()
	manifest := readToolManifest(forwarded)
	if manifest == nil {
		t.Fatal("no manifest")
	}
	run := newGenerativeUIRun(manifest, map[string]any{"messages": messages})
	out := []Event{}
	var finished Event
	for _, event := range events {
		if event["type"] == "RUN_FINISHED" {
			finished = event
			continue
		}
		out = append(out, run.handle(event)...)
	}
	out = append(out, run.complete(finished != nil)...)
	if finished != nil {
		out = append(out, finished)
	}
	return out
}

func ofType(events []Event, kind string) []Event {
	out := []Event{}
	for _, event := range events {
		if event["type"] == kind {
			out = append(out, event)
		}
	}
	return out
}

func TestPrepareAddsOneRenderToolAndGuide(t *testing.T) {
	manifest := readToolManifest(testEnvelope(t, envelopeOptions{}))
	input := map[string]any{"tools": []any{map[string]any{"name": "render_ui", "description": "stale"}, map[string]any{"name": "search"}}, "context": []any{map[string]any{"description": generativeUIContextDescription, "value": "stale"}}}
	prepareGenerativeUI(manifest, input)
	tools := input["tools"].([]any)
	if len(tools) != 2 || object(tools[0])["name"] != "search" || object(tools[1])["name"] != "render_ui" {
		t.Fatalf("tools: %v", tools)
	}
	assertJSON(t, object(object(object(tools[1])["parameters"])["properties"])["target"].(map[string]any)["enum"], []any{"chat", "side"})
	context := input["context"].([]any)
	if len(context) != 1 || object(context[0])["description"] != generativeUIContextDescription {
		t.Fatalf("context: %v", context)
	}
	guide := str(object(context[0])["value"])
	for _, line := range []string{
		`- "side" (a named area of the app; only Text)`,
		`- **ProductCard**: A product`,
		`  props: {"properties":{"name":{"type":"string"},"price":{"type":"number"}},"required":["name"],"type":"object"}`,
		`  slot props (component ids): {"children":"multiple","footer":"single"}`,
		"### Functions\n- none",
		"### Existing surfaces\n- none",
	} {
		if !strings.Contains(guide, line) {
			t.Fatalf("guide lacks %q:\n%s", line, guide)
		}
	}
}

func TestGuideIncludesFeatureRulesOnlyWhenTheCatalogUsesThem(t *testing.T) {
	withEvents := buildGenerativeUIPrompt(readToolManifest(testEnvelope(t, envelopeOptions{})))
	plain := buildGenerativeUIPrompt(readToolManifest(testEnvelope(t, envelopeOptions{components: map[string]any{"Text": textComponent}})))
	if !strings.Contains(withEvents, "Event props take an action:") || !strings.Contains(withEvents, "give a multiple slot a template") {
		t.Fatal(withEvents)
	}
	if strings.Contains(plain, "Event props take an action") || strings.Contains(plain, "give a multiple slot a template") {
		t.Fatal(plain)
	}
	if !strings.HasPrefix(plain, "## Generative UI\nCall `render_ui` to show UI.") || !strings.Contains(plain, "\n\nRules:\n1. Components are flat objects") {
		t.Fatal(plain)
	}
}

func TestGuideListsExistingSurfacesWithUserValuesAndRejections(t *testing.T) {
	surfaces := map[string]any{"cart": map[string]any{"target": "chat", "dataModel": map[string]any{"qty": 2}, "rejected": []any{"operation 1: bad"}}, "old": map[string]any{"target": "chat", "status": "deleted"}}
	guide := buildGenerativeUIPrompt(readToolManifest(testEnvelope(t, envelopeOptions{surfaces: surfaces})))
	for _, text := range []string{"- \"cart\" (target \"chat\")\n  user values: {\"qty\":2}\n  rejected: operation 1: bad", `- "old" (target "chat", deleted: never use this id again)`, "User values are what the user entered"} {
		if !strings.Contains(guide, text) {
			t.Fatalf("guide lacks %q", text)
		}
	}
}

func TestRunsWithoutAToolCatalogPassThrough(t *testing.T) {
	malformed := testEnvelope(t, envelopeOptions{})
	object(object(malformed["copilotkit"])["ui"])["1.0"] = map[string]any{}
	for name, forwarded := range map[string]map[string]any{
		"markdown":      testEnvelope(t, envelopeOptions{transport: "markdown"}),
		"no-components": testEnvelope(t, envelopeOptions{noCatalog: true}),
		"malformed":     malformed,
		"missing":       {},
	} {
		if readToolManifest(forwarded) != nil {
			t.Fatalf("%s: got a manifest", name)
		}
	}
}

func TestStreamedOperationsCreateThenPatchOneSurface(t *testing.T) {
	create := op10("createSurface", map[string]any{"surfaceId": "card", "catalogId": "unknown", "components": []any{map[string]any{"id": "root", "component": "ProductCard", "name": "A", "footer": "t"}}})
	update := op10("updateComponents", map[string]any{"surfaceId": "card", "components": []any{map[string]any{"id": "t", "component": "Text"}}})
	invalid := op10("updateComponents", map[string]any{"surfaceId": "card", "components": []any{map[string]any{"id": "x", "component": "Nope"}}})
	args := compactJSON(map[string]any{"target": "chat", "operations": []any{create, update, invalid}})
	events := runGenerativeUI(t, append(renderCallEvents("call", args[:60], args[60:]), Event{"type": "RUN_FINISHED"}), testEnvelope(t, envelopeOptions{}), nil)
	snapshots := ofType(events, "ACTIVITY_SNAPSHOT")
	if len(snapshots) != 1 || snapshots[0]["messageId"] != "genui:card" {
		t.Fatalf("snapshots: %v", snapshots)
	}
	content := object(snapshots[0]["content"])
	// The model does not pick the catalog: an unlisted id gets the run's catalog.
	if content["catalogId"] != "shop" || object(object(content["operations"].([]any)[0])["createSurface"])["catalogId"] != "shop" {
		t.Fatalf("catalog: %v", content)
	}
	rejection := map[string]any{"index": 2, "reason": `component "x": unknown component "Nope"`}
	patches := []any{}
	for _, delta := range ofType(events, "ACTIVITY_DELTA") {
		patches = append(patches, delta["patch"])
	}
	assertJSON(t, patches, []any{
		[]any{map[string]any{"op": "add", "path": "/operations/-", "value": update}},
		[]any{map[string]any{"op": "add", "path": "/rejected/-", "value": rejection}},
		[]any{map[string]any{"op": "replace", "path": "/status", "value": "ready"}},
	})
	result, finished := events[len(events)-2], events[len(events)-1]
	if finished["type"] != "RUN_FINISHED" || result["type"] != "TOOL_CALL_RESULT" {
		t.Fatalf("end: %v", events)
	}
	if want := `{"status":"rendered","applied":2,"calls":0,"rejected":[{"index":2,"reason":"component \"x\": unknown component \"Nope\""}]}`; result["content"] != want {
		t.Fatalf("result %s", result["content"])
	}
}

func TestOperationsWaitForALateTargetAndRespectItsComponents(t *testing.T) {
	args := `{"operations":[{"version":"1.0","createSurface":{"surfaceId":"panel"}},{"version":"1.0","updateComponents":{"surfaceId":"panel","components":[{"id":"root","component":"ProductCard","name":"A"}]}}],"target":"side"}`
	events := runGenerativeUI(t, append(renderCallEvents("call", args), Event{"type": "RUN_FINISHED"}), testEnvelope(t, envelopeOptions{}), nil)
	snapshots := ofType(events, "ACTIVITY_SNAPSHOT")
	if len(snapshots) != 1 || object(snapshots[0]["content"])["target"] != "side" {
		t.Fatalf("snapshots: %v", snapshots)
	}
	assertJSON(t, object(parse(t, str(events[len(events)-2]["content"])))["rejected"], []any{map[string]any{"index": 1, "reason": `component "root": "ProductCard" is not allowed in target "side"; use one of: Text`}})
}

func TestOperationsSentAsAStringAreRecovered(t *testing.T) {
	operations := compactJSON([]any{op10("createSurface", map[string]any{"surfaceId": "late"})})
	events := runGenerativeUI(t, append(renderCallEvents("call", compactJSON(map[string]any{"target": "chat", "operations": operations})), Event{"type": "RUN_FINISHED"}), testEnvelope(t, envelopeOptions{}), nil)
	snapshots := ofType(events, "ACTIVITY_SNAPSHOT")
	if len(snapshots) != 1 || snapshots[0]["messageId"] != "genui:late" {
		t.Fatalf("snapshots: %v", snapshots)
	}
}

func TestAnsweredCallsGetNoResultAndEmptyCallsReportAnError(t *testing.T) {
	events := append(renderCallEvents("empty", `{"target":"chat"}`), renderCallEvents("answered", `{"target":"chat","operations":[]}`)...)
	events = append(events, Event{"type": "TOOL_CALL_RESULT", "toolCallId": "answered", "content": "ok"}, Event{"type": "RUN_FINISHED"})
	out := runGenerativeUI(t, events, testEnvelope(t, envelopeOptions{}), nil)
	results := ofType(out, "TOOL_CALL_RESULT")
	if len(results) != 2 || results[0]["toolCallId"] != "answered" || results[1]["toolCallId"] != "empty" {
		t.Fatalf("results: %v", results)
	}
	if want := `{"status":"error","applied":0,"calls":0,"rejected":[],"reason":"operations must be a JSON array of A2UI operation objects; nothing was rendered"}`; results[1]["content"] != want {
		t.Fatalf("result %s", results[1]["content"])
	}
	if out[len(out)-1]["type"] != "RUN_FINISHED" {
		t.Fatal("RUN_FINISHED must be last")
	}
}

func TestExistingAndDeletedSurfacesFollowTheClientSummary(t *testing.T) {
	surfaces := map[string]any{"live": map[string]any{"target": "chat"}, "gone": map[string]any{"target": "chat", "status": "deleted"}}
	args := compactJSON(map[string]any{"target": "chat", "operations": []any{
		op10("updateDataModel", map[string]any{"surfaceId": "live", "path": "/x", "value": 1}),
		op10("createSurface", map[string]any{"surfaceId": "gone"}),
		op10("createSurface", map[string]any{"surfaceId": "live"}),
	}})
	events := runGenerativeUI(t, append(renderCallEvents("call", args), Event{"type": "RUN_FINISHED"}), testEnvelope(t, envelopeOptions{surfaces: surfaces}), nil)
	reasons := []string{}
	for _, entry := range object(parse(t, str(events[len(events)-2]["content"])))["rejected"].([]any) {
		reasons = append(reasons, str(object(entry)["reason"]))
	}
	if want := []string{`surface id "gone" was used before; use a new surfaceId`, `surface "live" already exists`}; !reflect.DeepEqual(reasons, want) {
		t.Fatalf("reasons: %q", reasons)
	}
	// The first touch of an existing surface marks it streaming and clears old rejections.
	first := ofType(events, "ACTIVITY_DELTA")[0]["patch"].([]any)
	assertJSON(t, first[:2], []any{map[string]any{"op": "replace", "path": "/status", "value": "streaming"}, map[string]any{"op": "replace", "path": "/rejected", "value": []any{}}})
}

func TestValidationRejectsComponentsWithTheTypeScriptReasons(t *testing.T) {
	manifest := readToolManifest(testEnvelope(t, envelopeOptions{}))
	for _, c := range []struct {
		component map[string]any
		reason    string
	}{
		{map[string]any{"id": "a", "component": "Text", "text": map[string]any{"path": "/x"}}, `component "a": text: bind data with {"@path": "/x"}, not {"path": "/x"}`},
		{map[string]any{"id": "a", "component": "Text", "size": 1}, `component "a": unknown prop "size"`},
		{map[string]any{"id": "a", "component": "ProductCard"}, `component "a": missing required prop "name"`},
		{map[string]any{"id": "a", "component": "ProductCard", "name": "x", "footer": "a"}, `component "a": footer: a component cannot be its own child`},
		{map[string]any{"id": "a", "component": "ProductCard", "name": "x", "onBuy": map[string]any{"event": "buy"}}, `component "a": onBuy: event.name is required`},
		{map[string]any{"id": "a", "component": "Text", "text": map[string]any{"@call": "openUrl"}}, `component "a": text: "openUrl" runs only from an event; a data prop can call only @index and the built-in functions (required, regex, length, numeric, email, formatString, formatNumber, formatCurrency, formatDate, pluralize, and, or, not, calc, series)`},
		{map[string]any{"id": "a", "component": "ProductCard", "name": "x", "children": map[string]any{"componentId": "b", "path": "/__proto__"}}, `component "a": children: path segment "__proto__" is not allowed in template path`},
		{map[string]any{"id": "a", "component": "ProductCard", "name": "x", "onBuy": map[string]any{"functionCall": map[string]any{"@call": "missing"}}}, `component "a": onBuy: function "missing" is not exposed to generative UI`},
	} {
		operation := decoded(t, op10("updateComponents", map[string]any{"surfaceId": "s", "components": []any{c.component}}))
		if got := validateOperation(operation, manifest, map[string]bool{"s": true}, nil, map[string]any{}, nil, nil); got != c.reason {
			t.Fatalf("got  %s\nwant %s", got, c.reason)
		}
	}
}

func TestValidationRequiresAnExistingSurfaceAndAValue(t *testing.T) {
	manifest := readToolManifest(testEnvelope(t, envelopeOptions{}))
	for _, c := range []struct {
		op     map[string]any
		known  map[string]bool
		reason string
	}{
		{op10("deleteSurface", map[string]any{"surfaceId": "s"}), nil, `surface "s" does not exist; send createSurface first`},
		{op10("updateDataModel", map[string]any{"surfaceId": "s"}), map[string]bool{"s": true}, `updateDataModel.value is required; use "value":null to delete`},
		{map[string]any{"deleteSurface": map[string]any{"surfaceId": "s"}}, map[string]bool{"s": true}, `operation needs "version":"1.0"`},
		{map[string]any{"version": "0.9", "deleteSurface": map[string]any{"surfaceId": "s"}}, nil, `unsupported version "0.9"; use "1.0"`},
		{op10("createSurface", map[string]any{"surfaceId": "s", "catalogId": 2}), nil, `unknown catalog "2"; leave out catalogId or use "shop"`},
		{op10("callRendererFunction", map[string]any{}), nil, agentFunctionCallsOffReason},
	} {
		if got := validateOperation(decoded(t, c.op), manifest, c.known, nil, nil, nil, nil); got != c.reason {
			t.Fatalf("got  %s\nwant %s", got, c.reason)
		}
	}
}

func TestGenerativeUIRunsFollowOptionTransportAndAgentScope(t *testing.T) {
	on := &GenerativeUIConfig{}
	for i, c := range []struct {
		option    *GenerativeUIConfig
		forwarded map[string]any
		expected  bool
	}{
		{nil, testEnvelope(t, envelopeOptions{}), true},
		{nil, map[string]any{}, false},
		{on, map[string]any{}, true},
		{on, testEnvelope(t, envelopeOptions{transport: "markdown"}), false},
		{&GenerativeUIConfig{Disabled: true}, testEnvelope(t, envelopeOptions{}), false},
		{&GenerativeUIConfig{Agents: []string{"other"}}, testEnvelope(t, envelopeOptions{}), false},
		{&GenerativeUIConfig{Agents: []string{}}, map[string]any{}, false},
	} {
		if got := isGenerativeUIRun(c.option, "default", c.forwarded); got != c.expected {
			t.Fatalf("case %d: got %v", i, got)
		}
	}
}

func TestA2UIVersionAndInfoResolvePerAgent(t *testing.T) {
	option := &GenerativeUIConfig{A2UIVersions: map[string]string{"legacy": "0.9"}, Agents: []string{"legacy", "current"}}
	if resolveA2UIVersion(option, "legacy") != "0.9" || resolveA2UIVersion(option, "current") != "1.0" || resolveA2UIVersion(&GenerativeUIConfig{}, "legacy") != "1.0" || resolveA2UIVersion(&GenerativeUIConfig{A2UIVersion: "0.9"}, "any") != "0.9" {
		t.Fatal("versions")
	}
	assertJSON(t, generativeUIInfo(option), map[string]any{"enabled": true, "agents": []any{"legacy", "current"}})
	assertJSON(t, generativeUIInfo(nil), map[string]any{"enabled": true})
	assertJSON(t, generativeUIInfo(&GenerativeUIConfig{Disabled: true}), map[string]any{"enabled": false})
	for _, invalid := range []*GenerativeUIConfig{{A2UIVersion: "2.0"}, {A2UIVersions: map[string]string{"a": "0.8"}}, {InjectA2UITool: ""}, {InjectA2UITool: 1}, {Recovery: &A2UIRecovery{DebugExposure: "loud"}}} {
		if _, err := cloneGenerativeUI(invalid); err == nil {
			t.Fatalf("accepted %+v", invalid)
		}
	}
}

func TestGenerativeUIConfigReadsTheTypeScriptOption(t *testing.T) {
	var config struct {
		Off, On, Single, PerAgent *GenerativeUIConfig
	}
	raw := `{"Off":false,"On":true,"Single":{"a2uiVersion":"0.9","injectA2UITool":"custom","agents":["a"],"recovery":{"maxAttempts":2}},"PerAgent":{"a2uiVersion":{"legacy":"0.9"}}}`
	if err := json.Unmarshal([]byte(raw), &config); err != nil {
		t.Fatal(err)
	}
	if !config.Off.Disabled || config.On.Disabled || config.Single.A2UIVersion != "0.9" || config.Single.InjectA2UITool != "custom" || config.Single.Recovery.MaxAttempts != 2 || config.PerAgent.A2UIVersions["legacy"] != "0.9" {
		t.Fatalf("%+v", config)
	}
	if out, _ := json.Marshal(config.PerAgent); string(out) != `{"a2uiVersion":{"legacy":"0.9"}}` {
		t.Fatal(string(out))
	}
	if json.Unmarshal([]byte(`{"a2uiVersion":3}`), &GenerativeUIConfig{}) == nil {
		t.Fatal("accepted a numeric version")
	}
}

func TestRuntimeInfoReportsGenerativeUIInsteadOfA2UI(t *testing.T) {
	rt, err := New(Config{APIKey: "key", APIURL: "http://127.0.0.1:1", IdentifyUser: func(*http.Request) (User, error) { return User{ID: "u", Name: "U"}, nil }, TelemetryDisabled: true, GenerativeUI: &GenerativeUIConfig{Agents: []string{"default"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer rt.Close()
	recorder := httptest.NewRecorder()
	rt.ServeHTTP(recorder, httptest.NewRequest("GET", "/copilotkit/info", nil))
	body := object(parse(t, recorder.Body.String()))
	assertJSON(t, body["generativeUI"], map[string]any{"enabled": true, "agents": []any{"default"}})
	if _, ok := body["a2uiEnabled"]; ok {
		t.Fatal("a2uiEnabled reported")
	}
	if _, ok := body["a2ui"]; ok {
		t.Fatal("a2ui reported")
	}
}

// recordingAgent records its inputs and emits fixed events.
type recordingAgent struct {
	events []Event
	inputs []map[string]any
}

func (a *recordingAgent) Run(_ context.Context, input map[string]any, emit func(Event) error) error {
	a.inputs = append(a.inputs, input)
	for _, event := range a.events {
		if err := emit(event); err != nil {
			return err
		}
	}
	return nil
}

// runUIAgent runs agent with the UI middlewares of runtime option for agent "default".
func runUIAgent(t *testing.T, agent Agent, option *GenerativeUIConfig, input map[string]any) []Event {
	t.Helper()
	ui := &uiAgent{next: agent, generative: isGenerativeUIRun(option, "default", input["forwardedProps"]), version: resolveA2UIVersion(option, "default"), option: option}
	events := []Event{}
	if err := ui.Run(context.Background(), input, func(e Event) error { events = append(events, e); return nil }); err != nil {
		t.Fatal(err)
	}
	return events
}

func toolNamesOf(input map[string]any) []string {
	names := []string{}
	for _, tool := range input["tools"].([]any) {
		names = append(names, str(object(tool)["name"]))
	}
	return names
}

func TestEachAgentVersionGetsItsOwnRenderTool(t *testing.T) {
	input := func() map[string]any {
		return map[string]any{"messages": []any{}, "tools": []any{}, "context": []any{}, "forwardedProps": testEnvelope(t, envelopeOptions{})}
	}
	current := &recordingAgent{events: []Event{{"type": "RUN_FINISHED"}}}
	runUIAgent(t, current, nil, input())
	if names := toolNamesOf(current.inputs[0]); !reflect.DeepEqual(names, []string{"render_ui"}) {
		t.Fatalf("1.0 tools: %v", names)
	}
	legacy := &recordingAgent{events: []Event{{"type": "RUN_FINISHED"}}}
	clientInput := input()
	runUIAgent(t, legacy, &GenerativeUIConfig{A2UIVersion: "0.9"}, clientInput)
	agentInput := legacy.inputs[0]
	if names := toolNamesOf(agentInput); !reflect.DeepEqual(names, []string{"render_a2ui"}) {
		t.Fatalf("0.9 tools: %v", names)
	}
	if len(clientInput["tools"].([]any)) != 0 || len(clientInput["context"].([]any)) != 0 {
		t.Fatal("the client input changed")
	}
	var schema string
	for _, entry := range agentInput["context"].([]any) {
		if object(entry)["description"] == generativeUIContextDescription {
			t.Fatal("a 0.9 agent got the 1.0 guide")
		}
		if object(entry)["description"] == a2uiSchemaDescription {
			schema = str(object(entry)["value"])
		}
	}
	if !strings.Contains(schema, `"components":{"ProductCard":`) || !strings.Contains(schema, `},"Text":`) {
		t.Fatalf("schema: %s", schema)
	}
}

func TestV09RenderCallReachesTheBrowserAsAV10Surface(t *testing.T) {
	agent := &recordingAgent{events: []Event{
		{"type": "TOOL_CALL_START", "toolCallId": "call", "toolCallName": "render_a2ui"},
		{"type": "TOOL_CALL_ARGS", "toolCallId": "call", "delta": `{"surfaceId":"card","components":[{"id":"root","component":"Text","text":"Hi"}]}`},
		{"type": "RUN_FINISHED"},
	}}
	events := runUIAgent(t, agent, &GenerativeUIConfig{A2UIVersion: "0.9"}, map[string]any{"messages": []any{}, "forwardedProps": testEnvelope(t, envelopeOptions{})})
	for _, event := range events {
		if event["activityType"] == "a2ui-surface" {
			t.Fatal("a v0.9 activity reached the browser")
		}
	}
	snapshots := ofType(events, "ACTIVITY_SNAPSHOT")
	if len(snapshots) != 1 || snapshots[0]["messageId"] != "genui:card" {
		t.Fatalf("snapshots: %v", snapshots)
	}
	content := object(snapshots[0]["content"])
	if content["a2uiSourceVersion"] != "0.9" || content["catalogId"] != "shop" || content["status"] != "ready" {
		t.Fatalf("content: %v", content)
	}
	if events[len(events)-2]["type"] != "TOOL_CALL_RESULT" || events[len(events)-2]["content"] != `{"status":"rendered"}` || events[len(events)-1]["type"] != "RUN_FINISHED" {
		t.Fatalf("end: %v", events[len(events)-2:])
	}
}

func TestV10AgentRenderUICallStreamsSurfaces(t *testing.T) {
	args := `{"target":"chat","operations":[{"version":"1.0","createSurface":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"Hi"}]}}]}`
	agent := &recordingAgent{events: append(append([]Event{{"type": "RUN_STARTED"}}, renderCallEvents("call", args)...), Event{"type": "RUN_FINISHED"})}
	events := runUIAgent(t, agent, nil, map[string]any{"messages": []any{}, "forwardedProps": testEnvelope(t, envelopeOptions{})})
	kinds := []string{}
	for _, event := range events {
		kinds = append(kinds, str(event["type"]))
	}
	want := []string{"RUN_STARTED", "TOOL_CALL_START", "TOOL_CALL_ARGS", "ACTIVITY_SNAPSHOT", "TOOL_CALL_END", "ACTIVITY_DELTA", "TOOL_CALL_RESULT", "RUN_FINISHED"}
	if !reflect.DeepEqual(kinds, want) {
		t.Fatalf("events: %v", kinds)
	}
}

func TestValidationReportsTheFirstProblemInJSONKeyOrder(t *testing.T) {
	args := `{"target":"chat","operations":[{"version":"1.0","createSurface":{"surfaceId":"s","components":[{"id":"a","component":"ProductCard","price":{"@call":"openUrl"},"bogus":1,"name":"x"}]}}]}`
	events := runGenerativeUI(t, append(renderCallEvents("call", args), Event{"type": "RUN_FINISHED"}), testEnvelope(t, envelopeOptions{}), nil)
	rejected := object(parse(t, str(events[len(events)-2]["content"])))["rejected"].([]any)
	if reason := str(object(rejected[0])["reason"]); !strings.HasPrefix(reason, `component "a": price: "openUrl" runs only from an event`) {
		t.Fatalf("reason: %s", reason)
	}
	order := keyOrder{}
	value, err := decodeOrdered(`{"b":1,"a":{"d":2,"c":3},"b":4}`, order)
	if err != nil || compactJSON(value) != `{"a":{"c":3,"d":2},"b":4}` {
		t.Fatal(err, value)
	}
	m := value.(map[string]any)
	if keys := order.keys(m); !reflect.DeepEqual(keys, []string{"b", "a"}) || !reflect.DeepEqual(order.keys(object(m["a"])), []string{"d", "c"}) || !reflect.DeepEqual(order.keys(map[string]any{"z": 1, "y": 2}), []string{"y", "z"}) {
		t.Fatal(keys)
	}
	if _, err := decodeOrdered(`{} {}`, nil); err == nil {
		t.Fatal("accepted trailing JSON")
	}
}
