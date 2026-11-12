package runtime

import (
	"reflect"
	"strings"
	"testing"
)

const basicV09 = "https://a2ui.org/specification/v0_9/basic_catalog.json"

var planV09 = []any{
	map[string]any{"version": "v0.9", "createSurface": map[string]any{"surfaceId": "plans", "catalogId": basicV09}},
	map[string]any{"version": "v0.9", "updateComponents": map[string]any{"surfaceId": "plans", "components": []any{
		map[string]any{"id": "root", "component": "Column", "children": []any{"title", "choose"}},
		map[string]any{"id": "title", "component": "Text", "text": map[string]any{"path": "/title"}},
		map[string]any{"id": "choose", "component": "Button", "child": "label", "action": map[string]any{"event": map[string]any{"name": "choose", "context": map[string]any{"plan": map[string]any{"path": "/plan"}}}}},
	}}},
	map[string]any{"version": "v0.9", "updateDataModel": map[string]any{"surfaceId": "plans", "path": "/", "value": map[string]any{}}},
}

func TestV09OperationsConvertToV10(t *testing.T) {
	operations, dropped := upgradeV09Operations(decoded(t, planV09).([]any))
	if len(dropped) != 0 {
		t.Fatal(dropped)
	}
	assertJSON(t, operations, []any{
		map[string]any{"version": "1.0", "createSurface": map[string]any{"surfaceId": "plans", "catalogId": standardCatalogID}},
		map[string]any{"version": "1.0", "updateComponents": map[string]any{"surfaceId": "plans", "components": []any{
			map[string]any{"id": "root", "component": "Column", "children": []any{"title", "choose"}},
			map[string]any{"id": "title", "component": "Text", "text": map[string]any{"@path": "/title"}},
			map[string]any{"id": "choose", "component": "Button", "child": "label", "onClick": map[string]any{"event": map[string]any{"name": "choose", "context": map[string]any{"plan": map[string]any{"@path": "/plan"}}}}},
		}}},
		map[string]any{"version": "1.0", "updateDataModel": map[string]any{"surfaceId": "plans", "path": "/", "value": map[string]any{}}},
	})
}

func TestBasicCatalogPropsTakeTheirStandardCatalogForm(t *testing.T) {
	components := []any{
		map[string]any{"id": "h", "component": "Text", "variant": "h1", "weight": "bold", "text": "T"},
		map[string]any{"id": "c", "component": "Text", "variant": "caption", "weight": "bold", "text": "c"},
		map[string]any{"id": "b", "component": "Text", "variant": "body", "text": "b"},
		map[string]any{"id": "f", "component": "TextField", "value": map[string]any{"path": "/email"}, "validationRegexp": "@"},
		map[string]any{"id": "n", "component": "Text", "text": map[string]any{"call": "formatNumber", "args": map[string]any{"value": 1}}},
	}
	operations, _ := upgradeV09Operations(decoded(t, []any{map[string]any{"updateComponents": map[string]any{"surfaceId": "s", "components": components}}}).([]any))
	assertJSON(t, object(object(operations[0])["updateComponents"])["components"], []any{
		map[string]any{"id": "h", "component": "Title", "text": "T", "size": "2xl"},
		map[string]any{"id": "c", "component": "Caption", "text": "c"},
		map[string]any{"id": "b", "component": "Text", "text": "b"},
		map[string]any{"id": "f", "component": "TextField", "value": map[string]any{"@path": "/email"}, "checks": []any{map[string]any{"condition": map[string]any{"@call": "regex", "args": map[string]any{"value": map[string]any{"@path": "/email"}, "pattern": "@"}}}}},
		map[string]any{"id": "n", "component": "Text", "text": map[string]any{"@call": "formatNumber", "args": map[string]any{"value": 1}}},
	})
}

func TestLeftOutValuesRemoveAndUnconvertibleOperationsAreDropped(t *testing.T) {
	operations, dropped := upgradeV09Operations(decoded(t, []any{
		map[string]any{"version": "v0.9", "updateDataModel": map[string]any{"surfaceId": "s", "path": "items"}},
		map[string]any{"version": "v0.9", "updateDataModel": map[string]any{"surfaceId": "s"}},
		map[string]any{"version": "1.0", "deleteSurface": map[string]any{"surfaceId": "s"}},
		map[string]any{"version": "v0.8", "deleteSurface": map[string]any{"surfaceId": "s"}},
		map[string]any{"version": "v0.9", "updateDataModel": map[string]any{"surfaceId": "s", "path": "/", "value": 3}},
		map[string]any{"version": "v0.9", "updateComponents": map[string]any{"surfaceId": "s", "components": []any{map[string]any{"id": "x"}}}},
		"text",
	}).([]any))
	assertJSON(t, []any{object(operations[0])["updateDataModel"], object(operations[1])["updateDataModel"], operations[2]}, []any{
		map[string]any{"surfaceId": "s", "path": "/items", "value": nil},
		map[string]any{"surfaceId": "s", "path": "/", "value": map[string]any{}},
		map[string]any{"version": "1.0", "deleteSurface": map[string]any{"surfaceId": "s"}},
	})
	reasons := []string{}
	for _, entry := range dropped {
		reasons = append(reasons, entry.reason)
	}
	want := []string{
		`unsupported A2UI version "v0.8"; only v0.9 and 1.0 operations are supported`,
		"a root updateDataModel value must be a JSON object in A2UI 1.0",
		`component "x": the component type must be a string (the v0.9 flat format)`,
		"operation must be a JSON object",
	}
	if !reflect.DeepEqual(reasons, want) {
		t.Fatalf("reasons: %q", reasons)
	}
}

func v09Activity(messageID string, operations []any) Event {
	return Event{"type": "ACTIVITY_SNAPSHOT", "messageId": messageID, "activityType": "a2ui-surface", "content": map[string]any{"a2ui_operations": operations}, "replace": true}
}

func TestUpgraderSendsOneCumulativeSurfacePerSurfaceID(t *testing.T) {
	upgrader := newA2UIV09Upgrader()
	lifecycle := v09Activity("m", nil)
	lifecycle["content"] = map[string]any{"status": "building"}
	if out := upgrader.transform(lifecycle); len(out) != 0 {
		t.Fatalf("lifecycle: %v", out)
	}
	first := upgrader.transform(v09Activity("m", planV09[:2]))
	if len(first) != 1 || first[0]["messageId"] != "genui:plans" {
		t.Fatalf("first: %v", first)
	}
	content := object(first[0]["content"])
	if content["status"] != "ready" || content["a2uiSourceVersion"] != "0.9" || content["target"] != "chat" || content["catalogId"] != standardCatalogID {
		t.Fatalf("content: %v", content)
	}
	patch := []any{map[string]any{"op": "add", "path": "/a2ui_operations/-", "value": planV09[2]}}
	second := upgrader.transform(Event{"type": "ACTIVITY_DELTA", "messageId": "m", "activityType": "a2ui-surface", "patch": patch})
	if len(second) != 1 || len(object(second[0]["content"])["operations"].([]any)) != 3 {
		t.Fatalf("second: %v", second)
	}
	// Unchanged content is not sent again; a patch that does not apply is skipped.
	if out := upgrader.transform(v09Activity("m", planV09)); len(out) != 0 {
		t.Fatalf("unchanged: %v", out)
	}
	bad := Event{"type": "ACTIVITY_DELTA", "messageId": "m", "activityType": "a2ui-surface", "patch": []any{map[string]any{"op": "replace", "path": "/missing/x", "value": 1}}}
	if out := upgrader.transform(bad); len(out) != 0 {
		t.Fatalf("bad patch: %v", out)
	}
	other := Event{"type": "ACTIVITY_SNAPSHOT", "activityType": "mcp-apps", "content": map[string]any{}}
	if out := upgrader.transform(other); len(out) != 1 || !reflect.DeepEqual(out[0], other) {
		t.Fatalf("other: %v", out)
	}
	// replace: false does not replace a stored source.
	stale := v09Activity("m", nil)
	stale["replace"] = false
	if out := upgrader.transform(stale); len(out) != 0 {
		t.Fatalf("stale: %v", out)
	}
}

func TestUpgraderAppendsUpdatesOfASurfaceFromAnEarlierRun(t *testing.T) {
	upgrader := newA2UIV09Upgrader()
	update := map[string]any{"version": "v0.9", "updateDataModel": map[string]any{"surfaceId": "old", "path": "/a", "value": 1}}
	out := upgrader.transform(v09Activity("m", []any{update, map[string]any{"updateComponents": map[string]any{"surfaceId": "old"}}}))
	if len(out) != 1 || out[0]["type"] != "ACTIVITY_DELTA" || out[0]["messageId"] != "genui:old" {
		t.Fatalf("delta: %v", out)
	}
	assertJSON(t, out[0]["patch"], []any{
		map[string]any{"op": "add", "path": "/operations/-", "value": map[string]any{"version": "1.0", "updateDataModel": map[string]any{"surfaceId": "old", "path": "/a", "value": 1}}},
		map[string]any{"op": "replace", "path": "/rejected", "value": []any{map[string]any{"index": 1, "reason": "updateComponents.components must be a non-empty array"}}},
	})
}

const basicV10 = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"

// adkV10 is the native 1.0 operations of an ADK agent: the fixture of #8353, from ag-ui #3374
// test_a2ui_protocol_versions.py::_ops at 89a59e1.
func adkV10() []any {
	return []any{
		map[string]any{"version": "1.0", "createSurface": map[string]any{"surfaceId": "s", "catalogId": basicV10}},
		map[string]any{"version": "1.0", "updateComponents": map[string]any{"surfaceId": "s", "components": []any{map[string]any{"id": "root", "component": "Text", "text": "Hello"}}}},
		map[string]any{"version": "1.0", "updateDataModel": map[string]any{"surfaceId": "s", "path": "/", "value": map[string]any{}}},
	}
}

func TestNativeV10OperationsKeepTheirFormOnTheStandardCatalog(t *testing.T) {
	save := map[string]any{"event": map[string]any{"name": "save", "context": map[string]any{"name": map[string]any{"@path": "/name"}}}}
	native := map[string]any{"version": "1.0", "createSurface": map[string]any{"surfaceId": "s", "catalogId": basicV10, "components": []any{
		map[string]any{"id": "title", "component": "Text", "variant": "h2", "text": "Profile"},
		map[string]any{"id": "save", "component": "Button", "child": "label", "action": save},
	}, "dataModel": map[string]any{"name": "Ada"}}}
	custom := map[string]any{"version": "1.0", "createSurface": map[string]any{"surfaceId": "c", "catalogId": "https://example.test/catalog"}}
	adk := adkV10()
	operations, dropped := upgradeV09Operations(append(adk, native, custom))
	if len(dropped) != 0 {
		t.Fatalf("dropped: %v", dropped)
	}
	assertJSON(t, operations, []any{
		map[string]any{"version": "1.0", "createSurface": map[string]any{"surfaceId": "s", "catalogId": standardCatalogID}},
		adk[1],
		adk[2],
		map[string]any{"version": "1.0", "createSurface": map[string]any{"surfaceId": "s", "catalogId": standardCatalogID, "components": []any{
			map[string]any{"id": "title", "component": "Title", "text": "Profile", "size": "xl"},
			map[string]any{"id": "save", "component": "Button", "child": "label", "onClick": save},
		}, "dataModel": map[string]any{"name": "Ada"}}},
		custom,
	})
}

func TestUpgraderSendsANativeV10SurfaceWithoutTheV09Tag(t *testing.T) {
	v09 := map[string]any{"version": "v0.9", "updateDataModel": map[string]any{"surfaceId": "s", "path": "/x", "value": 1}}
	out := newA2UIV09Upgrader().transform(v09Activity("m", append(adkV10(), v09)))
	if len(out) != 1 || out[0]["messageId"] != "genui:s" || out[0]["activityType"] != generativeUIActivityType {
		t.Fatalf("out: %v", out)
	}
	operations, _ := upgradeV09Operations(adkV10())
	assertJSON(t, out[0]["content"], map[string]any{
		"surfaceId": "s", "target": "chat", "catalogId": standardCatalogID, "operations": operations, "status": "ready",
		"rejected": []any{map[string]any{"index": 3, "reason": `surface "s" is A2UI 1.0; an A2UI 0.9 operation cannot change it`}},
	})
	// A v0.9 surface rejects a 1.0 operation the same way, and keeps its tag.
	native := map[string]any{"version": "1.0", "deleteSurface": map[string]any{"surfaceId": "plans"}}
	converted := newA2UIV09Upgrader().transform(v09Activity("m", []any{planV09[0], native}))
	content := object(converted[0]["content"])
	if content["a2uiSourceVersion"] != "0.9" {
		t.Fatalf("content: %v", content)
	}
	assertJSON(t, content["rejected"], []any{map[string]any{"index": 1, "reason": `surface "plans" is A2UI 0.9; an A2UI 1.0 operation cannot change it`}})
}

func TestASummaryWithoutTheV09TagIsAV10Surface(t *testing.T) {
	// A native 1.0 surface: its click reaches even a 0.9 agent unchanged.
	input := map[string]any{"messages": history(), "forwardedProps": testEnvelope(t, envelopeOptions{action: clickAction, surfaces: map[string]any{"card": map[string]any{"target": "chat"}}})}
	out := downgradeV09Action(input, "0.9")
	if _, converted := object(out["forwardedProps"])["a2uiAction"]; converted || len(out["messages"].([]any)) != 2 {
		t.Fatalf("out: %v", out)
	}
}

func TestJSONPatchAppliesRFC6902OperationsAndRejectsBadPaths(t *testing.T) {
	document := decoded(t, map[string]any{"a": []any{1, 2}, "b": map[string]any{"c": 1}})
	result, err := applyJSONPatch(document, decoded(t, []any{
		map[string]any{"op": "add", "path": "/a/1", "value": 9},
		map[string]any{"op": "remove", "path": "/a/0"},
		map[string]any{"op": "move", "from": "/b/c", "path": "/d"},
		map[string]any{"op": "copy", "from": "/d", "path": "/a/-"},
		map[string]any{"op": "test", "path": "/a", "value": []any{9, 2, 1}},
	}))
	if err != nil {
		t.Fatal(err)
	}
	assertJSON(t, result, map[string]any{"a": []any{9, 2, 1}, "b": map[string]any{}, "d": 1})
	for _, patch := range []any{
		[]any{map[string]any{"op": "replace", "path": "/x", "value": 1}},
		[]any{map[string]any{"op": "add", "path": "/__proto__", "value": 1}},
		[]any{map[string]any{"op": "add", "path": "/a/9", "value": 1}},
		[]any{map[string]any{"op": "test", "path": "/d", "value": 2}},
		[]any{map[string]any{"op": "add", "path": "/x/y", "value": 1}},
		[]any{map[string]any{"op": "bogus", "path": "/a"}},
		map[string]any{},
	} {
		if _, err := applyJSONPatch(deepCopy(result), decoded(t, patch)); err == nil {
			t.Fatalf("applied %v", patch)
		}
	}
	nested, err := applyJSONPatch(decoded(t, map[string]any{"list": []any{[]any{1}}}), decoded(t, []any{map[string]any{"op": "add", "path": "/list/0/-", "value": 2}}))
	if err != nil {
		t.Fatal(err)
	}
	assertJSON(t, nested, map[string]any{"list": []any{[]any{1, 2}}})
	root, err := applyJSONPatch(map[string]any{}, decoded(t, []any{map[string]any{"op": "replace", "path": "", "value": []any{1}}}))
	if err != nil {
		t.Fatal(err)
	}
	assertJSON(t, root, []any{1})
}

var clickAction = map[string]any{"version": "1.0", "action": map[string]any{"name": "confirm", "surfaceId": "card", "sourceComponentId": "button", "timestamp": "2026-10-20T10:00:00.000Z", "context": map[string]any{"selected": 2}}}
var userAction = map[string]any{"name": "confirm", "surfaceId": "card", "sourceComponentId": "button", "context": map[string]any{"selected": 2}, "timestamp": "2026-10-20T10:00:00.000Z"}

func history() []any {
	return []any{map[string]any{"id": "1", "role": "user", "content": "Hi"}, map[string]any{"id": "2", "role": "user", "content": "Ok"}}
}

func TestClickReachesAV09AgentAsItsActionWithoutTheMessage(t *testing.T) {
	input := map[string]any{"messages": history(), "forwardedProps": testEnvelope(t, envelopeOptions{action: clickAction})}
	original := compactJSON(input)
	agentInput := downgradeV09Action(input, "0.9")
	if compactJSON(input) != original {
		t.Fatal("input changed")
	}
	assertJSON(t, agentInput["messages"], history()[:1])
	assertJSON(t, object(agentInput["forwardedProps"])["a2uiAction"], map[string]any{"userAction": userAction})
	if same := downgradeV09Action(input, "1.0"); reflect.ValueOf(same).Pointer() != reflect.ValueOf(input).Pointer() {
		t.Fatal("a 1.0 agent's input changed")
	}
}

func TestSurfaceOriginDecidesBeforeTheAgentVersion(t *testing.T) {
	for _, c := range []struct {
		source, agentVersion string
		converted            bool
	}{{"0.9", "1.0", true}, {"1.0", "0.9", false}} {
		activity := map[string]any{"id": "a", "role": "activity", "activityType": "generative-ui-surface", "content": map[string]any{"surfaceId": "card", "a2uiSourceVersion": c.source}}
		fromMessage := map[string]any{"messages": append([]any{activity}, history()...), "forwardedProps": testEnvelope(t, envelopeOptions{action: clickAction})}
		fromSummary := map[string]any{"messages": history(), "forwardedProps": testEnvelope(t, envelopeOptions{action: clickAction, surfaces: map[string]any{"card": map[string]any{"target": "chat", "a2uiSourceVersion": c.source}}})}
		for _, input := range []map[string]any{fromMessage, fromSummary} {
			_, converted := object(downgradeV09Action(input, c.agentVersion)["forwardedProps"])["a2uiAction"]
			if converted != c.converted {
				t.Fatalf("%+v: converted %v", c, converted)
			}
		}
	}
}

func TestAnExistingV09ActionIsKept(t *testing.T) {
	forwarded := testEnvelope(t, envelopeOptions{action: clickAction})
	forwarded["a2uiAction"] = map[string]any{"userAction": map[string]any{"name": "old"}}
	input := map[string]any{"messages": history(), "forwardedProps": forwarded}
	out := downgradeV09Action(input, "0.9")
	assertJSON(t, object(out["forwardedProps"])["a2uiAction"], map[string]any{"userAction": map[string]any{"name": "old"}})
	if len(out["messages"].([]any)) != 2 {
		t.Fatal("the click message was removed")
	}
}

var buttonManifest = map[string]any{"props": map[string]any{"type": "object", "properties": map[string]any{"label": map[string]any{"type": "string"}}}, "events": map[string]any{"onClick": map[string]any{"description": "Clicked", "parameters": map[string]any{}}}}
var titleManifest = map[string]any{"props": map[string]any{"type": "object", "properties": map[string]any{"text": map[string]any{"type": "string"}}}}
var cardManifest = map[string]any{
	"description":    `Bind with {"@path": "/x"}`,
	"props":          map[string]any{"type": "object", "properties": map[string]any{"name": map[string]any{"type": "string", "description": "Its name"}, "tags": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "size": map[string]any{"type": "string", "enum": []any{"sm", "lg"}}}, "required": []any{"name"}},
	"slots":          map[string]any{"footer": "single"},
	"parameterOrder": []any{"footer"},
}
var catalogFunctionsFixture = map[string]any{
	"pick":   map[string]any{"description": `Pick with {"@path": "/id"}`, "parameters": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}}}},
	"secret": map[string]any{"allowedCallers": "agentOnly", "parameters": map[string]any{"type": "object"}},
}

// catalogEnvelope returns forwardedProps with one inline catalog of ids[0].
func catalogEnvelope(t *testing.T, components map[string]any, ids ...string) map[string]any {
	t.Helper()
	if len(ids) == 0 {
		ids = []string{"shop"}
	}
	catalog := map[string]any{"catalogId": ids[0], "protocolVersion": "1.0", "functions": catalogFunctionsFixture}
	if components != nil {
		catalog["components"] = components
	}
	supported := []any{}
	for _, id := range ids {
		supported = append(supported, id)
	}
	extensions := map[string]any{"copilotkit_format": 3, "copilotkit_transport": "tool", "copilotkit_targets": []any{map[string]any{"id": "chat", "kind": "chat"}}, "copilotkit_surfaces": map[string]any{}, "copilotkit_contextSent": false}
	return decoded(t, map[string]any{"copilotkit": map[string]any{"ui": map[string]any{"1.0": map[string]any{"supportedCatalogIds": supported, "inlineCatalogs": []any{catalog}}, "metadata": map[string]any{"extensions": extensions}}}}).(map[string]any)
}

func schemaOf(t *testing.T, context []any) (map[string]any, string) {
	t.Helper()
	for _, entry := range context {
		if object(entry)["description"] == a2uiSchemaDescription {
			raw := str(object(entry)["value"])
			return parse(t, raw).(map[string]any), raw
		}
	}
	t.Fatal("no schema entry")
	return nil, ""
}

func TestStandardCatalogBecomesTheBasicCatalogPlusCustomComponents(t *testing.T) {
	components := map[string]any{"Button": buttonManifest, "Title": titleManifest, "ProductCard": cardManifest}
	catalogID, context, ok := buildV09CatalogContext(map[string]any{"forwardedProps": catalogEnvelope(t, components, "app", standardCatalogID)})
	if !ok || catalogID != basicV09 || len(context) != 4 {
		t.Fatalf("catalog %q, %d entries", catalogID, len(context))
	}
	schema, raw := schemaOf(t, context)
	// Title is a standard component that v0.9 never had; Button keeps its v0.9 prop name.
	if names := sortedKeys(object(schema["components"])); !reflect.DeepEqual(names, []string{"Button", "ProductCard"}) {
		t.Fatalf("components: %v", names)
	}
	if !strings.Contains(raw, `"properties":{"component":{"const":"Button"},"label":{"$ref":"common_types.json#/$defs/DynamicString"},"action":{"$ref":"common_types.json#/$defs/Action","description":"Clicked"}}`) {
		t.Fatalf("button order: %s", raw)
	}
	// parameterOrder comes first.
	if !strings.Contains(raw, `"properties":{"component":{"const":"ProductCard"},"footer":`) {
		t.Fatalf("parameter order: %s", raw)
	}
	card := object(object(schema["components"])["ProductCard"])
	if card["description"] != `Bind with {"path": "/x"}` {
		t.Fatal(card["description"])
	}
	body := object(card["allOf"].([]any)[1])
	assertJSON(t, body["properties"], map[string]any{
		"component": map[string]any{"const": "ProductCard"},
		"footer":    map[string]any{"$ref": "common_types.json#/$defs/ComponentId"},
		"name":      map[string]any{"$ref": "common_types.json#/$defs/DynamicString", "description": "Its name"},
		"tags":      map[string]any{"$ref": "common_types.json#/$defs/DynamicStringList"},
		"size":      map[string]any{"anyOf": []any{map[string]any{"type": "string", "enum": []any{"sm", "lg"}}, map[string]any{"$ref": "common_types.json#/$defs/DataBinding"}, map[string]any{"$ref": "common_types.json#/$defs/FunctionCall"}}},
	})
	assertJSON(t, body["required"], []any{"component", "name"})
	names := []string{}
	for _, fn := range schema["functions"].([]any) {
		names = append(names, str(object(fn)["name"]))
		if object(fn)["name"] == "email" && object(fn)["returnType"] != "boolean" {
			t.Fatal("validationResult must become boolean")
		}
		if object(fn)["name"] == "pick" && object(fn)["description"] != `Pick with {"path": "/id"}` {
			t.Fatal(object(fn)["description"])
		}
	}
	if names[len(names)-1] != "pick" || containsString(names, "secret") || containsString(names, "calc") || len(names) != len(a2uiBasicFunctions)+1 {
		t.Fatalf("functions: %v", names)
	}
	if !strings.HasPrefix(raw, `{"catalogId":"`+basicV09+`","components":{`) || !strings.HasSuffix(raw, `"common_types.json":{"$defs":`+string(v09CommonTypes)+`}}`) {
		t.Fatalf("schema layout: %s", raw)
	}
	if want := "Available A2UI catalog:\n- " + basicV09 + "\n  Custom catalog (does NOT include all basic components).\n  Custom components:\n  - ProductCard"; object(context[0])["value"] != want {
		t.Fatalf("capabilities: %q", object(context[0])["value"])
	}
	if object(context[2])["value"] != a2uiDefaultGenerationGuidelines || object(context[3])["value"] != a2uiDefaultDesignGuidelines || utf16Length(a2uiDefaultGenerationGuidelines) != 4208 || utf16Length(a2uiDefaultDesignGuidelines) != 1509 {
		t.Fatal("guidelines")
	}
}

func TestACustomCatalogKeepsItsIDAndACatalogWithoutSchemasOnlyNamesIt(t *testing.T) {
	catalogID, context, _ := buildV09CatalogContext(map[string]any{"forwardedProps": catalogEnvelope(t, map[string]any{"Title": titleManifest})})
	schema, _ := schemaOf(t, context)
	if catalogID != "shop" || len(context) != 4 || !reflect.DeepEqual(sortedKeys(object(schema["components"])), []string{"Title"}) {
		t.Fatalf("custom catalog: %q %v", catalogID, schema["components"])
	}
	catalogID, context, ok := buildV09CatalogContext(map[string]any{"forwardedProps": catalogEnvelope(t, nil)})
	assertJSON(t, context, []any{map[string]any{"description": "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.", "value": "Available A2UI catalog:\n- shop"}})
	if !ok || catalogID != "shop" {
		t.Fatal(catalogID)
	}
	if _, _, ok := buildV09CatalogContext(map[string]any{"forwardedProps": map[string]any{}}); ok {
		t.Fatal("a run without an envelope got a catalog")
	}
}

func TestV09AgentInputReplacesTheClientSchemaEntry(t *testing.T) {
	input := map[string]any{"messages": []any{}, "context": []any{map[string]any{"description": a2uiSchemaDescription, "value": "{}"}, map[string]any{"description": "x"}}, "forwardedProps": catalogEnvelope(t, map[string]any{"ProductCard": cardManifest})}
	agentInput := prepareV09AgentInput(input, "0.9")
	descriptions := []string{}
	count := 0
	for _, entry := range agentInput["context"].([]any) {
		description := str(object(entry)["description"])
		descriptions = append(descriptions, description)
		if description == a2uiSchemaDescription {
			count++
		}
	}
	schema, _ := schemaOf(t, agentInput["context"].([]any))
	if count != 1 || descriptions[0] != "x" || schema["catalogId"] != "shop" || len(input["context"].([]any)) != 2 {
		t.Fatalf("context: %v", descriptions)
	}
	if out := prepareV09AgentInput(input, "1.0"); len(out["context"].([]any)) != 2 {
		t.Fatal("a 1.0 agent got the v0.9 catalog")
	}
}

func TestArgsSchemaFromSignatureMapsTypesToDynamicRefs(t *testing.T) {
	got := compactJSON(argsSchemaFromSignature("{ value: string; min?: number; [k: string]: unknown }"))
	want := `{"type":"object","properties":{"value":{"$ref":"common_types.json#/$defs/DynamicString"},"min":{"$ref":"common_types.json#/$defs/DynamicNumber"}},"required":["value"],"additionalProperties":{"$ref":"common_types.json#/$defs/DynamicValue"}}`
	if got != want {
		t.Fatalf("got %s", got)
	}
	assertJSON(t, argsSchemaFromSignature("{ values: boolean[]; value: string | number }"), map[string]any{
		"type": "object",
		"properties": map[string]any{
			"values": map[string]any{"anyOf": []any{map[string]any{"type": "array", "items": map[string]any{"$ref": "common_types.json#/$defs/DynamicBoolean"}}, map[string]any{"$ref": "common_types.json#/$defs/DataBinding"}, map[string]any{"$ref": "common_types.json#/$defs/FunctionCall"}}},
			"value":  map[string]any{"anyOf": []any{map[string]any{"$ref": "common_types.json#/$defs/DynamicString"}, map[string]any{"$ref": "common_types.json#/$defs/DynamicNumber"}}},
		},
		"required":             []any{"values", "value"},
		"additionalProperties": false,
	})
}
