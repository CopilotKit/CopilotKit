package runtime

import (
	"encoding/json"
	"fmt"
	"strings"
)

const a2uiSchemaDescription = "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations."
const basicCatalog = "https://a2ui.org/specification/v0_9/basic_catalog.json"

// A2UIConfig configures native v0.9 surface middleware. Retries remain agent-owned.
type A2UIConfig struct {
	Enabled          *bool    `json:"enabled,omitempty"`
	Agents           []string `json:"agents,omitempty"`
	InjectA2UITool   any      `json:"injectA2UITool,omitempty"`
	DefaultCatalogID string   `json:"defaultCatalogId,omitempty"`
	Schema           any      `json:"schema,omitempty"`
	ToolNames        []string `json:"a2uiToolNames,omitempty"`
}

func (c *A2UIConfig) enabled(agent string) bool {
	if c == nil || (c.Enabled != nil && !*c.Enabled) {
		return false
	}
	if len(c.Agents) == 0 {
		return true
	}
	for _, id := range c.Agents {
		if id == agent {
			return true
		}
	}
	return false
}

// resolveA2UI copies request defaults so one frontend catalog cannot affect another request.
func resolveA2UI(config *A2UIConfig, agent string, hasCatalog bool) *A2UIConfig {
	if config == nil && !hasCatalog {
		return nil
	}
	copy := A2UIConfig{}
	if config != nil {
		copy = *config
	}
	if !copy.enabled(agent) {
		return nil
	}
	if copy.InjectA2UITool == nil && hasCatalog {
		copy.InjectA2UITool = true
	}
	return &copy
}
func (c *A2UIConfig) toolName() string {
	if name := str(c.InjectA2UITool); name != "" {
		return name
	}
	return "render_a2ui"
}
func (c *A2UIConfig) isTool(name string) bool {
	if len(c.ToolNames) == 0 && name == "render_a2ui" {
		return true
	}
	for _, n := range c.ToolNames {
		if name == n {
			return true
		}
	}
	return c.InjectA2UITool != nil && c.InjectA2UITool != false && name == c.toolName()
}
func processA2UIAction(input map[string]any) {
	action := object(object(object(input["forwardedProps"])["a2uiAction"])["userAction"])
	if len(action) == 0 {
		return
	}
	call := uuid()
	args, _ := json.Marshal(action)
	messages, _ := input["messages"].([]any)
	name, surface := str(action["name"]), str(action["surfaceId"])
	if name == "" {
		name = "unknown_action"
	}
	if surface == "" {
		surface = "unknown_surface"
	}
	text := fmt.Sprintf("User performed action %q on surface %q", name, surface)
	if component := str(action["sourceComponentId"]); component != "" {
		text += fmt.Sprintf(" (component: %s)", component)
	}
	context, _ := json.Marshal(object(action["context"]))
	text += ". Context: " + string(context)
	input["messages"] = append(messages, map[string]any{"id": uuid(), "role": "assistant", "content": "", "toolCalls": []any{map[string]any{"id": call, "type": "function", "function": map[string]any{"name": "log_a2ui_event", "arguments": string(args)}}}}, map[string]any{"id": uuid(), "role": "tool", "toolCallId": call, "content": text})
}
func prepareA2UI(c *A2UIConfig, input map[string]any) string {
	context, _ := input["context"].([]any)
	catalog := ""
	for _, entry := range context {
		m := object(entry)
		if m["description"] == a2uiSchemaDescription {
			var schema map[string]any
			json.Unmarshal([]byte(str(m["value"])), &schema)
			catalog = str(schema["catalogId"])
		}
	}
	if c.Schema != nil {
		filtered := []any{}
		for _, entry := range context {
			if object(entry)["description"] != a2uiSchemaDescription {
				filtered = append(filtered, entry)
			}
		}
		raw, _ := json.Marshal(c.Schema)
		context = append(filtered, map[string]any{"description": a2uiSchemaDescription, "value": string(raw)})
	}
	if c.InjectA2UITool != nil && c.InjectA2UITool != false {
		tools, _ := input["tools"].([]any)
		filtered := []any{}
		for _, tool := range tools {
			if object(tool)["name"] != c.toolName() {
				filtered = append(filtered, tool)
			}
		}
		input["tools"] = append(filtered, map[string]any{"name": c.toolName(), "description": "Render a dynamic A2UI v0.9 surface with structured parameters.", "parameters": map[string]any{"type": "object", "properties": map[string]any{"surfaceId": map[string]any{"type": "string"}, "components": map[string]any{"type": "array", "items": map[string]any{"type": "object"}}, "data": map[string]any{"type": "object"}}, "required": []any{"surfaceId", "components"}}})
		forwarded := object(input["forwardedProps"])
		forwarded["injectA2UITool"] = c.InjectA2UITool
		input["forwardedProps"] = forwarded
		context = append(context, map[string]any{"description": "A2UI render tool usage guide — how to call " + c.toolName() + " with valid arguments.", "value": "Use A2UI v0.9 flat components with unique IDs and root id root. Supply surfaceId and components. Use catalog component types and required properties. Reference child IDs; do not nest components or create cycles. Data bindings use {path: /key}; repeated children use {componentId: id, path: /items}. Supply data for bindings."})
	}
	input["context"] = context
	return catalog
}

type a2uiCall struct {
	key, args, surface, catalog, dataKey string
	components                           []any
	rejected, painted, complete, result  bool
	items                                int
}
type a2uiStream struct {
	config          *A2UIConfig
	frontend, outer string
	calls           map[string]*a2uiCall
	painted         map[string]bool
	order           []string
	attempts        map[string]int
}

func newA2UI(c *A2UIConfig, frontend string) *a2uiStream {
	return &a2uiStream{config: c, frontend: frontend, calls: map[string]*a2uiCall{}, painted: map[string]bool{}, attempts: map[string]int{}}
}
func (s *a2uiStream) activity(key string, content map[string]any) Event {
	return Event{"type": "ACTIVITY_SNAPSHOT", "messageId": "a2ui-surface-" + key, "activityType": "a2ui-surface", "content": content, "replace": true}
}
func (s *a2uiStream) process(e Event) []Event {
	id := str(e["toolCallId"])
	events := []Event{}
	switch str(e["type"]) {
	case "TOOL_CALL_START":
		if s.config.isTool(str(e["toolCallName"])) {
			key := id
			if s.outer != "" {
				key = s.outer
			}
			s.attempts[key]++
			s.calls[id] = &a2uiCall{key: key, dataKey: "items"}
			s.order = append(s.order, id)
			events = append(events, s.activity(key, map[string]any{"status": "building"}))
		} else if e["toolCallName"] != "log_a2ui_event" {
			s.outer = id
		}
	case "TOOL_CALL_ARGS":
		if call := s.calls[id]; call != nil && !call.rejected {
			call.args += str(e["delta"])
			if len(call.args) > 4<<20 {
				call.rejected = true
				events = append(events, s.activity(call.key, map[string]any{"status": "failed", "error": "A2UI arguments exceed size limit"}))
				break
			}
			if !call.painted {
				call.surface = fieldString(call.args, "surfaceId")
				if call.surface == "" {
					call.surface = "surface-" + id
				}
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
			}
			advanced := false
			if !call.painted {
				raw := fieldRemainder(call.args, "components")
				var components []any
				if json.Unmarshal([]byte(raw), &components) == nil {
					validation := validateComponents(components, object(s.config.Schema))
					if len(validation) > 0 {
						call.rejected = true
						events = append(events, s.activity(call.key, map[string]any{"status": "retrying", "attempt": s.attempts[call.key] + 1, "maxAttempts": 3, "errors": validation}))
						break
					}
					call.components = components
					call.painted = true
					advanced = true
					s.painted[call.surface] = true
					for _, component := range components {
						path := str(object(object(component)["children"])["path"])
						if path != "" {
							call.dataKey = strings.TrimPrefix(path, "/")
							break
						}
					}
				}
			}
			if call.painted {
				var data any
				rawData := fieldRemainder(call.args, "data")
				items, _ := partialArray(fieldRemainder(rawData, call.dataKey))
				if len(items) > call.items {
					call.items = len(items)
					advanced = true
					data = map[string]any{call.dataKey: items}
				}
				var complete map[string]any
				if !call.complete && json.Unmarshal([]byte(rawData), &complete) == nil {
					call.complete = true
					data = complete
					advanced = true
				}
				if advanced {
					events = append(events, s.snapshot(call, data))
				}
			}
		}
	case "TOOL_CALL_RESULT":
		if call := s.calls[id]; call != nil {
			call.result = true
		}
		var result map[string]any
		if json.Unmarshal([]byte(str(e["content"])), &result) == nil {
			if result["code"] == "a2ui_recovery_exhausted" {
				key := id
				if s.outer != "" {
					key = s.outer
				}
				events = append(events, s.activity(key, map[string]any{"status": "failed", "error": result["error"], "attempts": result["attempts"], "maxAttempts": 3}))
			} else if operations, ok := result["a2ui_operations"].([]any); ok {
				groups := map[string][]any{}
				order := []string{}
				for _, op := range operations {
					m := object(op)
					surface := ""
					for _, kind := range []string{"createSurface", "updateComponents", "updateDataModel", "deleteSurface"} {
						if value, ok := m[kind]; ok {
							surface = str(object(value)["surfaceId"])
						}
					}
					if surface == "" || s.painted[surface] {
						continue
					}
					if _, ok := groups[surface]; !ok {
						order = append(order, surface)
					}
					groups[surface] = append(groups[surface], op)
				}
				for _, surface := range order {
					key := id
					if s.outer != "" {
						key = s.outer
					}
					if len(order) > 1 {
						key = surface + "-" + key
					}
					events = append(events, s.activity(key, map[string]any{"a2ui_operations": groups[surface]}))
				}
			}
		}
		if s.outer == id {
			s.outer = ""
		}
	}
	return events
}
func (s *a2uiStream) snapshot(call *a2uiCall, data any) Event {
	ops := []any{map[string]any{"version": "v0.9", "createSurface": map[string]any{"surfaceId": call.surface, "catalogId": call.catalog}}, map[string]any{"version": "v0.9", "updateComponents": map[string]any{"surfaceId": call.surface, "components": call.components}}}
	if data != nil {
		ops = append(ops, map[string]any{"version": "v0.9", "updateDataModel": map[string]any{"surfaceId": call.surface, "path": "/", "value": data}})
	}
	return s.activity(call.key, map[string]any{"a2ui_operations": ops})
}
func (s *a2uiStream) finish() []Event {
	events := []Event{}
	for _, id := range s.order {
		call := s.calls[id]
		if !call.result {
			content := `{"status":"rendered"}`
			if !call.painted {
				content = `{"status":"error","error":"A2UI surface was not valid"}`
			}
			events = append(events, Event{"type": "TOOL_CALL_RESULT", "messageId": uuid(), "toolCallId": id, "content": content})
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
