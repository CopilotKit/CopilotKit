package runtime

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

const a2uiSchemaDescription = "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations."
const basicCatalog = "https://a2ui.org/specification/v0_9/basic_catalog.json"

// a2uiConfig configures the native A2UI v0.9 middleware of one run (see generative_ui.go):
// fully for an agent that speaks A2UI v0.9, and for extraction of {"a2ui_operations": [...]}
// tool results only for a 1.0 agent. Its a2ui-surface output is converted to A2UI 1.0
// surfaces by a2ui_upgrade.go. Retries remain agent-owned.
type a2uiConfig struct {
	InjectA2UITool     any
	DefaultCatalogID   string
	Schema             any
	ToolNames          []string
	MaxAttempts        int
	ShowProgressTokens bool
	DebugExposure      string
}

func (c *a2uiConfig) injects() bool {
	return c.InjectA2UITool != nil && c.InjectA2UITool != false
}
func (c *a2uiConfig) toolName() string {
	if name := str(c.InjectA2UITool); name != "" {
		return name
	}
	return "render_a2ui"
}
func (c *a2uiConfig) isTool(name string) bool {
	if len(c.ToolNames) == 0 && name == "render_a2ui" {
		return true
	}
	return containsString(c.ToolNames, name) || (c.injects() && name == c.toolName())
}
func (c *a2uiConfig) maxAttempts() int {
	if c.MaxAttempts > 0 {
		return c.MaxAttempts
	}
	return 3
}

// hasSchemaComponents is true for a schema that reaches the agent: a nonempty list, or an
// object with components, as in the TypeScript middleware.
func hasSchemaComponents(schema any) bool {
	if list, ok := schema.([]any); ok {
		return len(list) > 0
	}
	return len(object(object(schema)["components"])) > 0
}

// jsTruthy is the truthiness of a decoded JSON value in JavaScript.
func jsTruthy(v any) bool {
	switch value := v.(type) {
	case nil:
		return false
	case bool:
		return value
	case string:
		return value != ""
	case float64:
		return value != 0 && value == value
	}
	return true
}

// processA2UIAction adds a v0.9 user action to the history as a log_a2ui_event call and result.
func processA2UIAction(input map[string]any) {
	action, ok := record(object(input["forwardedProps"])["a2uiAction"])
	if !ok {
		return
	}
	userAction := action["userAction"]
	if !jsTruthy(userAction) {
		return
	}
	call := uuid()
	messages, _ := input["messages"].([]any)
	field := func(key, fallback string) string {
		if value := object(userAction)[key]; value != nil {
			return jsString(value)
		}
		return fallback
	}
	text := fmt.Sprintf(`User performed action "%s" on surface "%s"`, field("name", "unknown_action"), field("surfaceId", "unknown_surface"))
	if component := object(userAction)["sourceComponentId"]; jsTruthy(component) {
		text += fmt.Sprintf(" (component: %s)", jsString(component))
	}
	context := "{}"
	if value := object(userAction)["context"]; jsTruthy(value) {
		context = compactJSON(value)
	}
	text += ". Context: " + context
	history := append([]any{}, messages...)
	input["messages"] = append(history, map[string]any{"id": uuid(), "role": "assistant", "content": "", "toolCalls": []any{map[string]any{"id": call, "type": "function", "function": map[string]any{"name": "log_a2ui_event", "arguments": compactJSON(userAction)}}}}, map[string]any{"id": uuid(), "role": "tool", "toolCallId": call, "content": text})
}

// renderA2UITool is RENDER_A2UI_TOOL of @ag-ui/a2ui-middleware.
func renderA2UITool(name string) map[string]any {
	return map[string]any{"name": name, "description": "Render a dynamic A2UI v0.9 surface with structured parameters. Follow the A2UI render tool usage guide provided in context.", "parameters": map[string]any{"type": "object", "properties": map[string]any{
		"surfaceId":  map[string]any{"type": "string", "description": "Unique surface identifier."},
		"components": map[string]any{"type": "array", "description": `A2UI v0.9 component array (flat format). The root component must have id "root".`, "items": map[string]any{"type": "object"}},
		"data":       map[string]any{"type": "object", "description": `Initial data model for the surface. Written to the root path. Use for pre-filling form values (e.g. {"form": {"name": "Alice"}}) or providing data for components bound to data model paths.`},
	}, "required": []any{"surfaceId", "components"}}}
}

// renderA2UIGuide is RENDER_A2UI_TOOL_GUIDELINES of @ag-ui/a2ui-middleware.
func renderA2UIGuide(name string) string {
	return strings.NewReplacer("{name}", name, "~", "`").Replace(renderA2UIGuideTemplate)
}

const renderA2UIGuideTemplate = `## How to call {name}

You MUST provide ALL required arguments when calling {name}:

- **surfaceId** (string, required): Unique ID for the surface (e.g. "sales-dashboard").
- **components** (array, REQUIRED): A2UI v0.9 flat component array. NEVER omit this.
- **data** (object, optional): Initial data model for path-bound component values.

Note: the catalog id is set by the host, not by you. Do not include a catalogId argument.

### Component format (v0.9 flat)

Components are a flat array — children are referenced by ID, not nested:
- Every component has ~id~ (unique) and ~component~ (type name from the available catalog).
- The root component MUST have ~id: "root"~.
- Properties go directly on the component object.
- Use ~children: ["id1", "id2"]~ for multiple children, ~child: "id"~ for a single child.

### Minimal example

~~~json
{
  "surfaceId": "my-dashboard",
  "components": [
    { "id": "root", "component": "Column", "children": ["title", "row1"] },
    { "id": "title", "component": "Title", "text": "Overview" },
    { "id": "row1", "component": "Row", "children": ["m1", "m2"], "gap": 16 },
    { "id": "m1", "component": "Metric", "label": "Users", "value": "1,200" },
    { "id": "m2", "component": "Metric", "label": "Revenue", "value": "$50K" }
  ]
}
~~~

### Key rules

1. NEVER call {name} without the ~components~ array — the UI will be empty.
2. Root must be a layout component (Column, Row, Card) — not Text or Button.
3. Component IDs must be unique. A component must NOT reference itself as child.
4. Only use component names from the Available Components schema in context.
5. For data binding use ~{ "path": "/key" }~ (absolute) or ~{ "path": "key" }~ (relative inside templates).
6. For repeating content: ~children: { componentId: "card-id", path: "/items" }~ repeats per array item.
7. Button actions: ~"action": { "event": { "name": "action_name", "context": { ... } } }~ — event must be an object.
8. No placeholder images — only use real URLs or Icon components.`

// prepareA2UI adds the action history, schema context and render tool to the agent input,
// and returns the frontend catalog id from the schema context.
func prepareA2UI(c *a2uiConfig, input map[string]any) string {
	context, _ := input["context"].([]any)
	catalog := ""
	for _, entry := range context {
		m := object(entry)
		if m["description"] == a2uiSchemaDescription {
			if value, ok := m["value"].(string); ok {
				var schema map[string]any
				json.Unmarshal([]byte(value), &schema)
				catalog = str(schema["catalogId"])
			}
			break
		}
	}
	processA2UIAction(input)
	context = append([]any{}, context...)
	if hasSchemaComponents(c.Schema) {
		filtered := []any{}
		for _, entry := range context {
			if object(entry)["description"] != a2uiSchemaDescription {
				filtered = append(filtered, entry)
			}
		}
		context = append(filtered, map[string]any{"description": a2uiSchemaDescription, "value": compactJSON(c.Schema)})
	}
	if c.injects() {
		tools, _ := input["tools"].([]any)
		filtered := []any{}
		for _, tool := range tools {
			if object(tool)["name"] != c.toolName() {
				filtered = append(filtered, tool)
			}
		}
		input["tools"] = append(filtered, renderA2UITool(c.toolName()))
		forwarded := shallowCopy(object(input["forwardedProps"]))
		forwarded["injectA2UITool"] = c.InjectA2UITool
		input["forwardedProps"] = forwarded
		description := "A2UI render tool usage guide — how to call " + c.toolName() + " with valid arguments."
		guided := []any{}
		for _, entry := range context {
			if object(entry)["description"] != description {
				guided = append(guided, entry)
			}
		}
		context = append(guided, map[string]any{"description": description, "value": renderA2UIGuide(c.toolName())})
	}
	input["context"] = context
	return catalog
}

type a2uiCall struct {
	key, outer, args, surface, catalog, dataKey string
	components                                  []any
	rejected, painted, complete, result         bool
	items, units                                int
}
type a2uiStream struct {
	config          *a2uiConfig
	frontend, outer string
	calls           map[string]*a2uiCall
	painted         map[string]bool
	order           []string
	attempts        map[string]int
	tokens          map[string]int
	retries         map[string]bool
}

func newA2UI(c *a2uiConfig, frontend string) *a2uiStream {
	return &a2uiStream{config: c, frontend: frontend, calls: map[string]*a2uiCall{}, painted: map[string]bool{}, attempts: map[string]int{}, tokens: map[string]int{}, retries: map[string]bool{}}
}

// lifecycle keeps building, retry and failure states on the replaceable activity of a key.
func (s *a2uiStream) lifecycle(key string, content map[string]any) Event {
	if s.config.DebugExposure != "" {
		content["debugExposure"] = s.config.DebugExposure
	}
	return s.activity(key, content)
}
func (s *a2uiStream) activity(key string, content map[string]any) Event {
	return Event{"type": "ACTIVITY_SNAPSHOT", "messageId": "a2ui-surface-" + key, "activityType": "a2ui-surface", "content": content, "replace": true}
}
func (s *a2uiStream) keyOf(id string) string {
	if s.outer != "" {
		return s.outer
	}
	return id
}

// validComponentArray is true for a complete, nonempty array of typed components, the
// arrays that the middleware validates.
func validComponentArray(components []any) bool {
	if len(components) == 0 {
		return false
	}
	for _, component := range components {
		if !isString(object(component)["component"]) {
			return false
		}
	}
	return true
}

func (s *a2uiStream) process(e Event) []Event {
	id := str(e["toolCallId"])
	events := []Event{}
	switch str(e["type"]) {
	case "TOOL_CALL_START":
		if s.config.isTool(str(e["toolCallName"])) {
			key := s.keyOf(id)
			s.attempts[key]++
			s.tokens[key] = 0
			s.calls[id] = &a2uiCall{key: key, outer: s.outer, dataKey: "items"}
			s.order = append(s.order, id)
			if !s.retries[key] {
				events = append(events, s.lifecycle(key, map[string]any{"status": "building"}))
			}
		} else if e["toolCallName"] != "log_a2ui_event" {
			s.outer = id
		}
	case "TOOL_CALL_ARGS":
		call := s.calls[id]
		if call == nil || call.rejected {
			break
		}
		delta := str(e["delta"])
		call.args += delta
		call.units += utf16Length(delta)
		if len(call.args) > 4<<20 {
			call.rejected = true
			events = append(events, s.lifecycle(call.key, map[string]any{"status": "failed", "error": "A2UI arguments exceed size limit"}))
			break
		}
		if tokens := int(math.Floor(float64(call.units)/4 + 0.5)); s.config.ShowProgressTokens && !call.painted && !call.complete && !s.retries[call.key] && tokens-s.tokens[call.key] >= 20 {
			s.tokens[call.key] = tokens
			events = append(events, s.lifecycle(call.key, map[string]any{"status": "building", "progressTokens": tokens}))
		}
		justPainted := false
		if !call.painted {
			// Nothing is painted before the surface id is known: a surface is keyed by it.
			surface := fieldString(call.args, "surfaceId")
			var components []any
			if surface == "" || json.Unmarshal([]byte(fieldRemainder(call.args, "components")), &components) != nil || !validComponentArray(components) {
				break
			}
			if validation := validateComponents(components, object(s.config.Schema)); len(validation) > 0 {
				call.rejected = true
				s.retries[call.key] = true
				s.tokens[call.key] = 0
				attempt := s.attempts[call.key] + 1
				if attempt > s.config.maxAttempts() {
					attempt = s.config.maxAttempts()
				}
				events = append(events, s.lifecycle(call.key, map[string]any{"status": "retrying", "attempt": attempt, "maxAttempts": s.config.maxAttempts(), "errors": validation}))
				break
			}
			call.surface, call.components, call.painted, justPainted = surface, components, true, true
			call.catalog = s.config.DefaultCatalogID
			if call.catalog == "" {
				call.catalog = s.frontend
			}
			if call.catalog == "" {
				call.catalog = fieldString(call.args, "catalogId")
			}
			if call.catalog == "" || call.catalog == "basic" {
				call.catalog = basicCatalog
			}
			for _, component := range components {
				if path := str(object(object(component)["children"])["path"]); path != "" {
					call.dataKey = strings.TrimPrefix(path, "/")
					break
				}
			}
		}
		if call.complete {
			break
		}
		rawData := fieldRemainder(call.args, "data")
		items, _ := partialArray(fieldRemainder(rawData, call.dataKey))
		advanced := len(items) > call.items
		if justPainted || advanced {
			ops := s.surfaceOperations(call)
			if advanced {
				call.items = len(items)
				ops = append(ops, map[string]any{"version": "v0.9", "updateDataModel": map[string]any{"surfaceId": call.surface, "path": "/", "value": map[string]any{call.dataKey: items}}})
			}
			events = append(events, s.activity(call.key, map[string]any{"a2ui_operations": ops}))
			s.painted[call.surface] = true
			delete(s.retries, call.key)
		}
		var data map[string]any
		if json.Unmarshal([]byte(rawData), &data) == nil && data != nil {
			call.complete = true
			ops := append(s.surfaceOperations(call), map[string]any{"version": "v0.9", "updateDataModel": map[string]any{"surfaceId": call.surface, "path": "/", "value": data}})
			events = append(events, s.activity(call.key, map[string]any{"a2ui_operations": ops}))
		}
	case "TOOL_CALL_RESULT":
		if call := s.calls[id]; call != nil {
			call.result = true
		}
		// A render call that painted its surface reports no operations again.
		painted := s.calls[id] != nil && s.calls[id].painted
		for _, call := range s.calls {
			painted = painted || (call.painted && call.outer == id)
		}
		if !painted {
			events = append(events, s.resultActivities(id, str(e["content"]))...)
		}
		if s.outer == id {
			s.outer = ""
		}
	}
	return events
}

// resultActivities turns {"a2ui_operations": [...]} or a recovery failure in a tool result
// into activities.
func (s *a2uiStream) resultActivities(id, content string) []Event {
	var parsed any
	if json.Unmarshal([]byte(content), &parsed) != nil {
		return nil
	}
	if text, ok := parsed.(string); ok {
		parsed = nil
		json.Unmarshal([]byte(text), &parsed)
	}
	result := object(parsed)
	key := s.keyOf(id)
	operations, ok := result["a2ui_operations"].([]any)
	if !ok {
		if result["code"] != "a2ui_recovery_exhausted" {
			return nil
		}
		attempts, _ := result["attempts"].([]any)
		if attempts == nil {
			attempts = []any{}
		}
		maxAttempts := len(attempts)
		if maxAttempts == 0 {
			maxAttempts = s.config.maxAttempts()
		}
		message := "A2UI generation failed"
		if text, present := result["error"]; present && text != nil {
			message = jsString(text)
		}
		delete(s.retries, key)
		return []Event{s.lifecycle(key, map[string]any{"status": "failed", "error": message, "attempts": attempts, "maxAttempts": maxAttempts})}
	}
	groups := map[string][]any{}
	order := []string{}
	for _, op := range operations {
		m, ok := record(op)
		if !ok {
			continue
		}
		surface := ""
		for _, kind := range []string{"createSurface", "updateComponents", "updateDataModel", "deleteSurface"} {
			if value := object(m[kind])["surfaceId"]; value != nil && surface == "" {
				surface = jsString(value)
			}
		}
		if surface != "" && s.painted[surface] {
			continue
		}
		if surface == "" {
			surface = "default"
		}
		if _, ok := groups[surface]; !ok {
			order = append(order, surface)
		}
		groups[surface] = append(groups[surface], op)
	}
	events := []Event{}
	for _, surface := range order {
		messageKey := key
		if len(order) > 1 {
			messageKey = surface + "-" + key
		}
		events = append(events, s.activity(messageKey, map[string]any{"a2ui_operations": groups[surface]}))
	}
	return events
}
func (s *a2uiStream) surfaceOperations(call *a2uiCall) []any {
	return []any{map[string]any{"version": "v0.9", "createSurface": map[string]any{"surfaceId": call.surface, "catalogId": call.catalog}}, map[string]any{"version": "v0.9", "updateComponents": map[string]any{"surfaceId": call.surface, "components": call.components}}}
}

// finish answers every render call that has no result before RUN_FINISHED.
func (s *a2uiStream) finish() []Event {
	events := []Event{}
	for _, id := range s.order {
		if call := s.calls[id]; !call.result {
			call.result = true
			events = append(events, Event{"type": "TOOL_CALL_RESULT", "messageId": uuid(), "toolCallId": id, "content": `{"status":"rendered"}`})
		}
	}
	return events
}

// fieldRemainder locates a root member with a real JSON decoder, including unfinished values.
func fieldRemainder(raw, key string) string {
	d := json.NewDecoder(strings.NewReader(raw))
	token, e := d.Token()
	if e != nil || token != json.Delim('{') {
		return ""
	}
	for d.More() {
		token, e = d.Token()
		if e != nil {
			return ""
		}
		start := int(d.InputOffset())
		for start < len(raw) && (raw[start] == ':' || raw[start] == ' ' || raw[start] == '\n' || raw[start] == '\r' || raw[start] == '\t') {
			start++
		}
		var value json.RawMessage
		e = d.Decode(&value)
		if token == key {
			if e == nil {
				return string(value)
			}
			return raw[start:]
		}
		if e != nil {
			return ""
		}
	}
	return ""
}
func fieldString(raw, key string) string {
	var value string
	json.Unmarshal([]byte(fieldRemainder(raw, key)), &value)
	return value
}
func partialArray(raw string) ([]any, bool) {
	d := json.NewDecoder(strings.NewReader(raw))
	token, e := d.Token()
	if e != nil || token != json.Delim('[') {
		return nil, false
	}
	items := []any{}
	for d.More() {
		var item any
		if d.Decode(&item) != nil {
			return items, false
		}
		items = append(items, item)
	}
	token, e = d.Token()
	return items, e == nil && token == json.Delim(']')
}
