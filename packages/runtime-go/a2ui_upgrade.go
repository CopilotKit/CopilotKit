package runtime

// Serve A2UI v0.9 agents through the A2UI 1.0 client.
//
// Ports a2ui-v09-operations.ts, a2ui-v09-actions.ts, a2ui-v09-catalog.ts and
// a2ui-v09-middleware.ts of the TypeScript runtime:
//   - v0.9 a2ui-surface activity events become 1.0 generative-ui-surface events;
//   - a click on a converted surface reaches the agent as the v0.9 a2uiAction;
//   - a 0.9 agent gets the v0.9 component schema of the client's catalog.

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Operations (a2ui-v09-operations.ts)

const v09SurfaceActivityType = "a2ui-surface"

var v09Kinds = []string{"createSurface", "updateComponents", "updateDataModel", "deleteSurface"}
var v09BasicCatalogIDs = map[string]bool{
	"https://a2ui.org/specification/v0_9/basic_catalog.json":          true,
	"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json": true,
}

// The A2UI 1.0 basic catalog, which native 1.0 agents (for example ADK) send. It has the 18
// components of the v0.9 basic catalog with 1.0 bindings, so it becomes the standard catalog
// too.
var v10BasicCatalogIDs = map[string]bool{
	"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json": true,
}

// v0.9 Text heading variants as 1.0 Title sizes, largest first.
var headingSizes = map[string]string{"h1": "2xl", "h2": "xl", "h3": "lg", "h4": "md", "h5": "sm"}

func v09Kind(op map[string]any) string {
	found := ""
	for _, kind := range v09Kinds {
		if _, ok := op[kind]; ok {
			if found != "" {
				return ""
			}
			found = kind
		}
	}
	return found
}

// isV09Operation is true for an A2UI v0.9 operation, also one without version but with
// one v0.9 key.
func isV09Operation(value any) bool {
	m, ok := record(value)
	if !ok {
		return false
	}
	if version, present := m["version"]; present {
		return version == "v0.9" || version == "v0.9.1"
	}
	kind := v09Kind(m)
	return kind != "" && isRecord(m[kind])
}

// convertValue turns {path} into {"@path"} and {call, args} into {"@call", args}.
func convertValue(value any) any {
	if list, ok := value.([]any); ok {
		out := make([]any, len(list))
		for i, item := range list {
			out[i] = convertValue(item)
		}
		return out
	}
	m, ok := record(value)
	if !ok {
		return value
	}
	if path, isPath := m["path"].(string); isPath && len(m) == 1 {
		return map[string]any{"@path": path}
	}
	if _, isCall := m["call"].(string); isCall {
		plain := true
		for key := range m {
			plain = plain && (key == "call" || key == "args" || key == "returnType")
		}
		if plain {
			return convertCall(m)
		}
	}
	out := map[string]any{}
	for key, item := range m {
		out[key] = convertValue(item)
	}
	return out
}

func convertCall(call map[string]any) map[string]any {
	result := map[string]any{"@call": call["call"]}
	if args, ok := call["args"]; ok {
		result["args"] = convertValue(args)
	}
	return result
}

func isV09Action(value any) bool {
	m, ok := record(value)
	return ok && len(m) == 1 && (isRecord(m["event"]) || isRecord(m["functionCall"]))
}

// convertAction returns a v0.9 action as a 1.0 {event} or {functionCall} binding.
func convertAction(action any) (map[string]any, error) {
	if !isV09Action(action) {
		return nil, errors.New(`action must be { "event": ... } or { "functionCall": ... }`)
	}
	m := object(action)
	if call, ok := record(m["functionCall"]); ok {
		if !nonEmptyString(call["call"]) {
			return nil, errors.New("action.functionCall.call must be a function name")
		}
		return map[string]any{"functionCall": convertCall(call)}, nil
	}
	event := object(m["event"])
	if !nonEmptyString(event["name"]) {
		return nil, errors.New("action.event.name is required")
	}
	converted := map[string]any{"name": event["name"]}
	if context, ok := event["context"]; ok {
		converted["context"] = convertValue(context)
	}
	return map[string]any{"event": converted}, nil
}

func without(m map[string]any, keys ...string) map[string]any {
	out := map[string]any{}
	for key, value := range m {
		if !containsString(keys, key) {
			out[key] = value
		}
	}
	return out
}

// basicCatalogChanges renames the props of the basic catalog that the 1.0 standard catalog
// names differently. Text with a heading variant becomes Title (h1 "2xl" to h5 "sm"), with
// caption it becomes Caption; variant goes, and weight too for Title and Caption.
// Button.action becomes onClick. TextField.validationRegexp becomes a regex check.
func basicCatalogChanges(node map[string]any) map[string]any {
	switch node["component"] {
	case "Text":
		variant, ok := node["variant"]
		if !ok {
			return node
		}
		rest := without(node, "variant")
		name, _ := variant.(string)
		if size, heading := headingSizes[name]; heading {
			title := without(rest, "weight")
			title["component"] = "Title"
			title["size"] = size
			return title
		}
		if variant == "caption" {
			caption := without(rest, "weight")
			caption["component"] = "Caption"
			return caption
		}
		return rest
	case "Button":
		action, ok := node["action"]
		if !ok {
			return node
		}
		rest := without(node, "action")
		rest["onClick"] = action
		return rest
	case "TextField":
		pattern, ok := node["validationRegexp"]
		if !ok {
			return node
		}
		rest := without(node, "validationRegexp")
		value, hasValue := rest["value"]
		if !isString(pattern) || !hasValue {
			return rest
		}
		checks, _ := rest["checks"].([]any)
		check := map[string]any{"condition": map[string]any{"@call": "regex", "args": map[string]any{"value": value, "pattern": pattern}}}
		rest["checks"] = append(append([]any{}, checks...), check)
		return rest
	}
	return node
}

// convertComponent returns one v0.9 component (flat format) as a 1.0 component node.
func convertComponent(node any) (map[string]any, error) {
	m, ok := record(node)
	if !ok || !nonEmptyString(m["id"]) {
		return nil, errors.New("a component needs a string id")
	}
	if !nonEmptyString(m["component"]) {
		return nil, fmt.Errorf(`component "%s": the component type must be a string (the v0.9 flat format)`, m["id"])
	}
	converted := map[string]any{}
	for _, key := range sortedKeys(m) {
		value := m[key]
		switch {
		case key == "id" || key == "component":
			converted[key] = value
		case key == "action" || isV09Action(value):
			action, err := convertAction(value)
			if err != nil {
				return nil, fmt.Errorf(`component "%s": %v`, m["id"], err)
			}
			converted[key] = action
		default:
			converted[key] = convertValue(value)
		}
	}
	return basicCatalogChanges(converted), nil
}

// convertUpdateDataModel: v0.9 removes the key when value is left out; 1.0 removes it for null.
func convertUpdateDataModel(payload map[string]any, surfaceID string) (map[string]any, error) {
	path, hasPath := payload["path"]
	if hasPath && !isString(path) {
		return nil, errors.New("updateDataModel.path must be a string")
	}
	pointer := str(path)
	if !strings.HasPrefix(pointer, "/") {
		pointer = "/" + pointer
	}
	root := pointer == "/"
	value, hasValue := payload["value"]
	if root && hasValue && !isRecord(value) {
		return nil, errors.New("a root updateDataModel value must be a JSON object in A2UI 1.0")
	}
	if !hasValue {
		value = nil
		if root {
			value = map[string]any{}
		}
	}
	return map[string]any{"version": a2uiVersion10, "updateDataModel": map[string]any{"surfaceId": surfaceID, "path": pointer, "value": value}}, nil
}

// convertCreateSurface maps the basic catalog id to the standard catalog id; theme has no
// 1.0 field.
func convertCreateSurface(payload map[string]any, surfaceID string) map[string]any {
	create := map[string]any{"surfaceId": surfaceID}
	if catalogID, _ := payload["catalogId"].(string); catalogID != "" {
		if v09BasicCatalogIDs[catalogID] {
			catalogID = standardCatalogID
		}
		create["catalogId"] = catalogID
	}
	send := payload["sendDataModel"]
	if send == nil {
		send = payload["attachDataModel"]
	}
	if flag, ok := send.(bool); ok {
		create["sendDataModel"] = flag
	}
	return map[string]any{"version": a2uiVersion10, "createSurface": create}
}

// toStandardComponents returns basic catalog components as standard ones; anything else stays.
func toStandardComponents(components any) any {
	list, ok := components.([]any)
	if !ok {
		return components
	}
	out := make([]any, len(list))
	for i, node := range list {
		if m, ok := record(node); ok {
			out[i] = basicCatalogChanges(m)
		} else {
			out[i] = node
		}
	}
	return out
}

// upgradeV10Operation returns a native A2UI 1.0 operation for the standard catalog: the 1.0
// basic catalog id becomes the standard catalog id, and the basic catalog components (inline
// in createSurface, or in updateComponents) get the changes of basicCatalogChanges. Bindings
// are already 1.0. Everything else stays; the client validates the operation.
func upgradeV10Operation(op map[string]any) map[string]any {
	if create, ok := record(op["createSurface"]); ok {
		create = shallowCopy(create)
		if catalogID, _ := create["catalogId"].(string); v10BasicCatalogIDs[catalogID] {
			create["catalogId"] = standardCatalogID
		}
		if components, ok := create["components"]; ok {
			create["components"] = toStandardComponents(components)
		}
		out := shallowCopy(op)
		out["createSurface"] = create
		return out
	}
	if update, ok := record(op["updateComponents"]); ok {
		update = shallowCopy(update)
		if components, ok := update["components"]; ok {
			update["components"] = toStandardComponents(components)
		}
		out := shallowCopy(op)
		out["updateComponents"] = update
		return out
	}
	return op
}

func upgradeOperation(op any) (map[string]any, error) {
	m, ok := record(op)
	if !ok {
		return nil, errors.New("operation must be a JSON object")
	}
	if m["version"] == a2uiVersion10 {
		return upgradeV10Operation(m), nil
	}
	if !isV09Operation(m) {
		if version, ok := m["version"].(string); ok {
			return nil, fmt.Errorf(`unsupported A2UI version "%s"; only v0.9 and 1.0 operations are supported`, version)
		}
		return nil, errors.New("not an A2UI v0.9 operation: it needs exactly one of " + strings.Join(v09Kinds, ", "))
	}
	kind := v09Kind(m)
	if kind == "" {
		return nil, errors.New("operation must contain exactly one of " + strings.Join(v09Kinds, ", "))
	}
	payload, ok := record(m[kind])
	if !ok || !nonEmptyString(payload["surfaceId"]) {
		return nil, errors.New(kind + ".surfaceId is required")
	}
	surfaceID := payload["surfaceId"].(string)
	switch kind {
	case "createSurface":
		return convertCreateSurface(payload, surfaceID), nil
	case "updateComponents":
		components, ok := payload["components"].([]any)
		if !ok || len(components) == 0 {
			return nil, errors.New("updateComponents.components must be a non-empty array")
		}
		converted := make([]any, len(components))
		for i, component := range components {
			node, err := convertComponent(component)
			if err != nil {
				return nil, err
			}
			converted[i] = node
		}
		return map[string]any{"version": a2uiVersion10, "updateComponents": map[string]any{"surfaceId": surfaceID, "components": converted}}, nil
	case "updateDataModel":
		return convertUpdateDataModel(payload, surfaceID)
	}
	return map[string]any{"version": a2uiVersion10, "deleteSurface": map[string]any{"surfaceId": surfaceID}}, nil
}

type droppedOperation struct {
	operation any
	reason    string
}

// upgradeV09Operations converts A2UI v0.9 operations to 1.0, in order. A native 1.0
// operation keeps its form: only the 1.0 basic catalog id becomes the standard catalog id,
// and its basic catalog components get the same changes as v0.9 ones. Any other operation,
// and a v0.9 operation that cannot be converted, is returned in the second list with the
// reason.
func upgradeV09Operations(operations []any) ([]any, []droppedOperation) {
	upgraded := []any{}
	dropped := []droppedOperation{}
	for _, operation := range operations {
		converted, err := upgradeOperation(operation)
		if err != nil {
			dropped = append(dropped, droppedOperation{operation, err.Error()})
			continue
		}
		upgraded = append(upgraded, converted)
	}
	return upgraded, dropped
}

// v09SurfaceIDOf returns the nested surfaceId of a v0.9 or 1.0 surface operation.
func v09SurfaceIDOf(op any) (string, bool) {
	m, ok := record(op)
	if !ok {
		return "", false
	}
	for _, kind := range v09Kinds {
		if payload, ok := record(m[kind]); ok {
			if surface, ok := payload["surfaceId"].(string); ok {
				return surface, surface != ""
			}
		}
	}
	return "", false
}

// failedLifecycleError is the error of a failed lifecycle snapshot (the agent's A2UI
// recovery gave up). ok is false for any other content.
func failedLifecycleError(content any) (string, bool) {
	m, isRecord := record(content)
	if !isRecord || m["status"] != "failed" {
		return "", false
	}
	message, _ := m["error"].(string)
	if message == "" {
		message = "A2UI generation failed"
	}
	length := 0
	for i, r := range message {
		size := 1
		if r >= 0x10000 {
			size = 2
		}
		if length+size > maxRejectionLength {
			return message[:i], true
		}
		length += size
	}
	return message, true
}

func readV09Operations(content any) []any {
	m, ok := record(content)
	if !ok {
		return nil
	}
	operations := m["a2ui_operations"]
	if operations == nil {
		operations = m["operations"]
	}
	list, _ := operations.([]any)
	return list
}

// deepCopy copies a decoded JSON value.
func deepCopy(value any) any {
	switch v := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, item := range v {
			out[key] = deepCopy(item)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = deepCopy(item)
		}
		return out
	}
	return value
}

var arrayIndex = regexp.MustCompile(`^\d+$`)

func patchIndex(key string) (int, bool) {
	if !arrayIndex.MatchString(key) {
		return 0, false
	}
	index, err := strconv.Atoi(key)
	return index, err == nil
}

// patchSlot reads and replaces one member of the document, so that inserting into an array
// updates the container that holds it.
type patchSlot struct {
	get func() any
	set func(any)
}

// applyJSONPatch applies RFC 6902 operations to document and returns the new root. It returns
// an error for a path that does not resolve, so a bad delta leaves stored content alone.
func applyJSONPatch(document any, patch any) (any, error) {
	var err error
	entries, ok := patch.([]any)
	if !ok {
		return nil, errors.New("patch must be an array")
	}
	root := document
	segmentsOf := func(pointer string) ([]string, error) {
		if pointer == "" {
			return nil, nil
		}
		if !strings.HasPrefix(pointer, "/") {
			return nil, fmt.Errorf(`invalid pointer "%s"`, pointer)
		}
		parts := strings.Split(pointer[1:], "/")
		for i, part := range parts {
			parts[i] = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
		}
		return parts, nil
	}
	// parentOf resolves the container of pointer as a slot, so arrays can grow in place.
	parentOf := func(pointer string) (patchSlot, *string, error) {
		segments, err := segmentsOf(pointer)
		if err != nil {
			return patchSlot{}, nil, err
		}
		slot := patchSlot{get: func() any { return root }, set: func(v any) { root = v }}
		if len(segments) == 0 {
			return slot, nil, nil
		}
		key := segments[len(segments)-1]
		for _, segment := range segments[:len(segments)-1] {
			if forbiddenSegments[segment] {
				return patchSlot{}, nil, errors.New("forbidden path")
			}
			parent := slot.get()
			switch container := parent.(type) {
			case []any:
				index, ok := patchIndex(segment)
				if !ok || index >= len(container) {
					return patchSlot{}, nil, fmt.Errorf(`path "%s" not found`, pointer)
				}
				slot = patchSlot{get: func() any { return container[index] }, set: func(v any) { container[index] = v }}
			case map[string]any:
				if _, present := container[segment]; !present {
					return patchSlot{}, nil, fmt.Errorf(`path "%s" not found`, pointer)
				}
				name := segment
				slot = patchSlot{get: func() any { return container[name] }, set: func(v any) { container[name] = v }}
			default:
				return patchSlot{}, nil, fmt.Errorf(`path "%s" not found`, pointer)
			}
		}
		if forbiddenSegments[key] {
			return patchSlot{}, nil, errors.New("forbidden path")
		}
		return slot, &key, nil
	}
	read := func(pointer string) (any, bool, error) {
		slot, key, err := parentOf(pointer)
		if err != nil {
			return nil, false, err
		}
		if key == nil {
			return root, true, nil
		}
		switch parent := slot.get().(type) {
		case []any:
			index, ok := patchIndex(*key)
			if !ok || index >= len(parent) {
				return nil, false, nil
			}
			return parent[index], true, nil
		case map[string]any:
			value, present := parent[*key]
			return value, present, nil
		}
		return nil, false, nil
	}
	remove := func(pointer string) error {
		slot, key, err := parentOf(pointer)
		if err != nil {
			return err
		}
		if key == nil {
			return errors.New("cannot remove the root")
		}
		switch parent := slot.get().(type) {
		case []any:
			index, ok := patchIndex(*key)
			if !ok {
				return fmt.Errorf(`path "%s" not found`, pointer)
			}
			if index < len(parent) {
				slot.set(append(append([]any{}, parent[:index]...), parent[index+1:]...))
			}
			return nil
		case map[string]any:
			if _, present := parent[*key]; present {
				delete(parent, *key)
				return nil
			}
		}
		return fmt.Errorf(`path "%s" not found`, pointer)
	}
	write := func(pointer string, value any, insert bool) error {
		slot, key, err := parentOf(pointer)
		if err != nil {
			return err
		}
		if key == nil {
			root = value
			return nil
		}
		switch parent := slot.get().(type) {
		case []any:
			index, ok := len(parent), *key == "-"
			if !ok {
				index, ok = patchIndex(*key)
			}
			if !ok || index > len(parent) {
				return fmt.Errorf(`index "%s" is out of range`, *key)
			}
			next := append([]any{}, parent[:index]...)
			next = append(next, value)
			if insert {
				next = append(next, parent[index:]...)
			} else if index < len(parent) {
				next = append(next, parent[index+1:]...)
			}
			slot.set(next)
		case map[string]any:
			parent[*key] = value
		default:
			return fmt.Errorf(`path "%s" not found`, pointer)
		}
		return nil
	}
	for _, raw := range entries {
		entry, ok := record(raw)
		path, isPath := entry["path"].(string)
		if !ok || !isPath {
			return nil, errors.New("invalid patch operation")
		}
		from, _ := entry["from"].(string)
		switch entry["op"] {
		case "add":
			err = write(path, deepCopy(entry["value"]), true)
		case "replace":
			if _, present, readErr := read(path); readErr != nil || !present {
				return nil, fmt.Errorf(`path "%s" not found`, path)
			}
			err = write(path, deepCopy(entry["value"]), false)
		case "remove":
			err = remove(path)
		case "copy":
			value, present, readErr := read(from)
			if readErr != nil || !present {
				return nil, fmt.Errorf(`path "%s" has no value`, path)
			}
			err = write(path, deepCopy(value), true)
		case "move":
			value, present, readErr := read(from)
			if readErr != nil || !present {
				return nil, fmt.Errorf(`path "%s" has no value`, path)
			}
			if err = remove(from); err == nil {
				err = write(path, value, true)
			}
		case "test":
			value, _, readErr := read(path)
			if readErr != nil || compactJSON(value) != compactJSON(entry["value"]) {
				return nil, fmt.Errorf(`test failed at "%s"`, path)
			}
		default:
			return nil, fmt.Errorf(`unknown patch op "%s"`, jsString(entry["op"]))
		}
		if err != nil {
			return nil, err
		}
	}
	return root, nil
}

// sourceOperation is one converted operation, with its index in the source message and the
// A2UI version it was written in ("0.9" or "1.0").
type sourceOperation struct {
	operation any
	index     int
	version   string
}

type sourcePart struct {
	operations []sourceOperation
	rejected   []any
}

type surfaceState struct {
	// The part of each source message, in the order they first touched the surface.
	parts        map[string]*sourcePart
	partOrder    []string
	lastSnapshot string
	// Operations sent as deltas, for a surface created in an earlier run.
	sentOperations []any
	sentRejected   string
}

func (s *surfaceState) setPart(messageID string, part *sourcePart) {
	if _, ok := s.parts[messageID]; !ok {
		s.partOrder = append(s.partOrder, messageID)
	}
	s.parts[messageID] = part
}

func (s *surfaceState) deletePart(messageID string) bool {
	if _, ok := s.parts[messageID]; !ok {
		return false
	}
	delete(s.parts, messageID)
	for i, id := range s.partOrder {
		if id == messageID {
			s.partOrder = append(s.partOrder[:i:i], s.partOrder[i+1:]...)
			break
		}
	}
	return true
}

// a2uiV09Upgrader converts the a2ui-surface surfaces of one run (A2UI v0.9, or native 1.0)
// to generative-ui-surface surfaces. Create one per run.
//
// An a2ui-surface snapshot or delta is kept per messageId and its operations converted. Each
// surface becomes one genui:<surfaceId> message: a surface created in this run is sent as a
// cumulative snapshot (chat target, status "ready", a2uiSourceVersion "0.9" for a surface
// written in v0.9); a surface that this run only updates gets its new operations as an
// ACTIVITY_DELTA. A surface written in native 1.0 (for example by ADK) has no
// a2uiSourceVersion, so a click on it reaches the agent unchanged. One surface has one
// version, the version of its first operation; an operation of the other version is
// rejected. A lifecycle snapshot (no operations) names no surface, so it is consumed. A
// failed one (the agent's recovery gave up) becomes a surface with no operations, status
// "error", and its error as the one rejected entry, so the chat shows that the UI could not
// be made. Its surfaceId is the source messageId.
type a2uiV09Upgrader struct {
	sources      map[string]any
	surfaces     map[string]*surfaceState
	surfaceOrder []string
	// The source messages whose failed snapshot was sent.
	failures map[string]bool
}

func newA2UIV09Upgrader() *a2uiV09Upgrader {
	return &a2uiV09Upgrader{sources: map[string]any{}, surfaces: map[string]*surfaceState{}, failures: map[string]bool{}}
}

// failure is the surface that shows a failed lifecycle snapshot, sent once.
func (u *a2uiV09Upgrader) failure(messageID, message string) []Event {
	if u.failures[messageID] {
		return nil
	}
	u.failures[messageID] = true
	content := newOrdered().set("surfaceId", messageID).set("target", generativeUIChatTarget).set("catalogId", standardCatalogID).set("operations", []any{}).set("status", "error").set("rejected", []any{map[string]any{"index": 0, "reason": message}}).set("a2uiSourceVersion", "0.9")
	var copy any
	json.Unmarshal([]byte(compactJSON(content)), &copy)
	return []Event{{"type": "ACTIVITY_SNAPSHOT", "messageId": surfaceMessageID(messageID), "activityType": generativeUIActivityType, "content": copy, "replace": true}}
}

func (u *a2uiV09Upgrader) snapshot(surfaceID string, state *surfaceState, operations, rejected []any, version string) []Event {
	catalogID := ""
	for _, op := range operations {
		if create, ok := object(op)["createSurface"]; ok {
			catalogID, _ = object(create)["catalogId"].(string)
			break
		}
	}
	if catalogID == "" {
		catalogID = standardCatalogID
	}
	content := newOrdered().set("surfaceId", surfaceID).set("target", generativeUIChatTarget).set("catalogId", catalogID).set("operations", operations).set("status", "ready").set("rejected", rejected)
	if version == "0.9" {
		content.set("a2uiSourceVersion", "0.9")
	}
	serialized := compactJSON(content)
	if serialized == state.lastSnapshot {
		return nil
	}
	state.lastSnapshot = serialized
	var copy any
	json.Unmarshal([]byte(serialized), &copy)
	return []Event{{"type": "ACTIVITY_SNAPSHOT", "messageId": surfaceMessageID(surfaceID), "activityType": generativeUIActivityType, "content": copy, "replace": true}}
}

func (u *a2uiV09Upgrader) delta(surfaceID string, state *surfaceState, operations, rejected []any) []Event {
	same := 0
	for same < len(state.sentOperations) && same < len(operations) && compactJSON(state.sentOperations[same]) == compactJSON(operations[same]) {
		same++
	}
	// Operations that changed after they were sent cannot be taken back. v0.9 updates
	// replace by id or path, so sending them again is safe.
	patch := []any{}
	for _, op := range operations[same:] {
		patch = append(patch, map[string]any{"op": "add", "path": "/operations/-", "value": deepCopy(op)})
	}
	serialized := compactJSON(rejected)
	if serialized != state.sentRejected {
		patch = append(patch, map[string]any{"op": "replace", "path": "/rejected", "value": deepCopy(rejected)})
	}
	state.sentOperations = operations
	state.sentRejected = serialized
	if len(patch) == 0 {
		return nil
	}
	return []Event{{"type": "ACTIVITY_DELTA", "messageId": surfaceMessageID(surfaceID), "activityType": generativeUIActivityType, "patch": patch}}
}

func (u *a2uiV09Upgrader) emit(surfaceID string) []Event {
	state := u.surfaces[surfaceID]
	if state == nil {
		return nil
	}
	operations, rejected := []any{}, []any{}
	created := false
	version := ""
	for _, messageID := range state.partOrder {
		part := state.parts[messageID]
		for _, entry := range part.operations {
			if version == "" {
				version = entry.version
			}
			if entry.version != version {
				rejected = append(rejected, map[string]any{"index": entry.index, "reason": fmt.Sprintf(`surface "%s" is A2UI %s; an A2UI %s operation cannot change it`, surfaceID, version, entry.version)})
				continue
			}
			if _, ok := object(entry.operation)["createSurface"]; ok {
				// A second createSurface of the same id is rejected in 1.0.
				if created {
					continue
				}
				created = true
			}
			operations = append(operations, entry.operation)
		}
		rejected = append(rejected, part.rejected...)
	}
	if created {
		return u.snapshot(surfaceID, state, operations, rejected, version)
	}
	return u.delta(surfaceID, state, operations, rejected)
}

// refresh converts the stored content of one source message again.
func (u *a2uiV09Upgrader) refresh(messageID string) []Event {
	parts := map[string]*sourcePart{}
	touched := []string{}
	for index, op := range readV09Operations(u.sources[messageID]) {
		// An operation with no surface cannot be shown anywhere.
		surfaceID, ok := v09SurfaceIDOf(op)
		if !ok {
			continue
		}
		part := parts[surfaceID]
		if part == nil {
			part = &sourcePart{operations: []sourceOperation{}, rejected: []any{}}
			parts[surfaceID] = part
			touched = append(touched, surfaceID)
		}
		operations, dropped := upgradeV09Operations([]any{op})
		// Only v0.9 and 1.0 operations convert.
		version := "0.9"
		if object(op)["version"] == a2uiVersion10 {
			version = "1.0"
		}
		for _, operation := range operations {
			part.operations = append(part.operations, sourceOperation{operation, index, version})
		}
		for _, entry := range dropped {
			part.rejected = append(part.rejected, map[string]any{"index": index, "reason": entry.reason})
		}
	}
	for _, surfaceID := range u.surfaceOrder {
		if _, ok := parts[surfaceID]; !ok && u.surfaces[surfaceID].deletePart(messageID) {
			touched = append(touched, surfaceID)
		}
	}
	for _, surfaceID := range touched {
		part, ok := parts[surfaceID]
		if !ok {
			continue
		}
		state := u.surfaces[surfaceID]
		if state == nil {
			state = &surfaceState{parts: map[string]*sourcePart{}, sentRejected: "[]"}
			u.surfaces[surfaceID] = state
			u.surfaceOrder = append(u.surfaceOrder, surfaceID)
		}
		state.setPart(messageID, part)
	}
	events := []Event{}
	for _, surfaceID := range touched {
		events = append(events, u.emit(surfaceID)...)
	}
	if message, failed := failedLifecycleError(u.sources[messageID]); failed {
		events = append(events, u.failure(messageID, message)...)
	}
	return events
}

// transform returns the events that replace one event of the run.
func (u *a2uiV09Upgrader) transform(event Event) []Event {
	switch event["type"] {
	case "ACTIVITY_SNAPSHOT":
		if event["activityType"] != v09SurfaceActivityType {
			return []Event{event}
		}
		messageID := str(event["messageId"])
		// replace: false does not replace a message that already exists.
		if _, exists := u.sources[messageID]; exists && event["replace"] == false {
			return nil
		}
		u.sources[messageID] = deepCopy(normalizeJSON(event["content"]))
		return u.refresh(messageID)
	case "ACTIVITY_DELTA":
		if event["activityType"] != v09SurfaceActivityType {
			return []Event{event}
		}
		messageID := str(event["messageId"])
		source, exists := u.sources[messageID]
		if !exists {
			return nil
		}
		content, err := applyJSONPatch(deepCopy(source), normalizeJSON(event["patch"]))
		if err != nil {
			// The AG-UI client also skips a delta that does not apply.
			return nil
		}
		u.sources[messageID] = content
		return u.refresh(messageID)
	}
	return []Event{event}
}

// normalizeJSON turns a value built in Go (typed maps and slices) into decoded JSON.
func normalizeJSON(value any) any {
	switch value.(type) {
	case nil, string, bool, float64, map[string]any, []any:
		if !containsTyped(value) {
			return value
		}
	}
	var out any
	json.Unmarshal([]byte(compactJSON(value)), &out)
	return out
}

func containsTyped(value any) bool {
	switch v := value.(type) {
	case nil, string, bool, float64:
		return false
	case map[string]any:
		for _, item := range v {
			if containsTyped(item) {
				return true
			}
		}
		return false
	case []any:
		for _, item := range v {
			if containsTyped(item) {
				return true
			}
		}
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// Clicks (a2ui-v09-actions.ts)

// readV09Action returns the 1.0 action of the user event that started the run, as a v0.9
// user action.
func readV09Action(envelope map[string]any) map[string]any {
	if envelope == nil {
		return nil
	}
	message, ok := record(extensionsOf(envelope)["copilotkit_action"])
	if !ok {
		return nil
	}
	action, ok := record(message["action"])
	if !ok {
		return nil
	}
	name, isName := action["name"].(string)
	surfaceID, isSurface := action["surfaceId"].(string)
	if !isName || !isSurface {
		return nil
	}
	source, _ := action["sourceComponentId"].(string)
	context, ok := record(action["context"])
	if !ok {
		context = map[string]any{}
	}
	timestamp, ok := action["timestamp"].(string)
	if !ok {
		timestamp = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	}
	return map[string]any{"name": name, "surfaceId": surfaceID, "sourceComponentId": source, "context": context, "timestamp": timestamp}
}

// isV09Surface is true when the surface was converted from v0.9. The client's surface
// summary decides (no a2uiSourceVersion means a 1.0 surface), then the last
// generative-ui-surface activity message of the surface, then agentVersion.
func isV09Surface(envelope map[string]any, messages []any, surfaceID, agentVersion string) bool {
	if summary, ok := record(object(extensionsOf(envelope)["copilotkit_surfaces"])[surfaceID]); ok {
		return summary["a2uiSourceVersion"] == "0.9"
	}
	for i := len(messages) - 1; i >= 0; i-- {
		message, ok := record(messages[i])
		if !ok || message["role"] != "activity" || message["activityType"] != generativeUIActivityType {
			continue
		}
		content, ok := record(message["content"])
		if ok && content["surfaceId"] == surfaceID {
			return content["a2uiSourceVersion"] == "0.9"
		}
	}
	return agentVersion == "0.9"
}

// downgradeV09Action turns a click on a surface of v0.9 origin into the v0.9 action of the
// agent side. The 1.0 client sends a click as a visible user message plus copilotkit_action
// in the envelope. For a surface of v0.9 origin this returns a new input with
// forwardedProps.a2uiAction.userAction set and that user message removed, as the v0.9 client
// sent no message for a click. Otherwise it returns input.
func downgradeV09Action(input map[string]any, agentVersion string) map[string]any {
	forwarded, ok := record(input["forwardedProps"])
	// A run that already has a v0.9 action keeps it.
	if !ok {
		return input
	}
	if _, exists := forwarded["a2uiAction"]; exists {
		return input
	}
	envelope := readEnvelope(forwarded)
	action := readV09Action(envelope)
	if envelope == nil || action == nil {
		return input
	}
	messages, _ := input["messages"].([]any)
	if !isV09Surface(envelope, messages, str(action["surfaceId"]), agentVersion) {
		return input
	}
	// The client adds the visible click message just before the run.
	if len(messages) > 0 {
		if last, ok := record(messages[len(messages)-1]); ok && last["role"] == "user" && isString(last["content"]) {
			messages = messages[:len(messages)-1]
		}
	}
	nextForwarded := map[string]any{}
	for key, value := range forwarded {
		nextForwarded[key] = value
	}
	nextForwarded["a2uiAction"] = map[string]any{"userAction": action}
	next := shallowCopy(input)
	next["messages"] = append([]any{}, messages...)
	next["forwardedProps"] = nextForwarded
	return next
}

func shallowCopy(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for key, value := range m {
		out[key] = value
	}
	return out
}

// ---------------------------------------------------------------------------
// Catalog (a2ui-v09-catalog.ts)

const (
	v09BasicCatalogID                  = "https://a2ui.org/specification/v0_9/basic_catalog.json"
	v09CapabilitiesDescription         = "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render."
	v09GenerationGuidelinesDescription = "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions."
	v09DesignGuidelinesDescription     = "A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns."
	v09Common                          = "common_types.json#/$defs/"
)

// The components of the v0.9 basic catalog. The 1.0 standard catalog has each of them.
var v09BasicComponents = []string{"Text", "Image", "Icon", "Video", "AudioPlayer", "Row", "Column", "List", "Card", "Tabs", "Modal", "Divider", "Button", "TextField", "CheckBox", "ChoicePicker", "Slider", "DateTimeInput"}

// The components of the 1.0 standard catalog (standardDeclarations).
var standardComponents = func() map[string]bool {
	names := map[string]bool{}
	for _, name := range strings.Fields("Box Column Row Grid GridItem Card Flow FlowItem Carousel CarouselItem CarouselMediaItem Spacer Divider Tabs Title Text Caption Label Bold Italic Underline Strikethrough Badge Blockquote Code Markdown Math ShimmerText Link Tooltip Button Pressable Form TextField TextArea Select CheckBox Radio RadioGroup Slider SegmentedControl ChoicePicker DateTimeInput PulseIndicator FlashcardFlip Popover PopoverTrigger PopoverContent Modal Table TableSection TableRow TableCell List ListItem Chart Map Image Icon Favicon Svg Video AudioPlayer HtmlView LinkCard Citation FollowUp EntityCard ImageGrid") {
		names[name] = true
	}
	return names
}()

// Props of standard components that v0.9 names differently: component → 1.0 → v0.9 name.
var v10ToV09PropNames = map[string]map[string]string{"Button": {"onClick": "action"}}

func v09Ref(name string) map[string]any { return map[string]any{"$ref": v09Common + name} }

// The v0.9 common types that the schemas reference, so every ref resolves in the payload.
var v09CommonTypes = json.RawMessage(`{"ComponentId":{"type":"string","description":"The unique identifier for a component, used for both definitions and references within the same surface."},"ComponentCommon":{"type":"object","properties":{"id":{"$ref":"common_types.json#/$defs/ComponentId"},"accessibility":{"$ref":"common_types.json#/$defs/AccessibilityAttributes"}},"required":["id"]},"AccessibilityAttributes":{"type":"object","description":"Attributes to enhance accessibility when using assistive technologies like screen readers.","properties":{"label":{"$ref":"common_types.json#/$defs/DynamicString"},"description":{"$ref":"common_types.json#/$defs/DynamicString"}}},"ChildList":{"oneOf":[{"type":"array","items":{"$ref":"common_types.json#/$defs/ComponentId"},"description":"A static list of child component IDs."},{"type":"object","description":"A template for generating a dynamic list of children from a data model list. The ` + "`componentId`" + ` is the component to use as a template.","properties":{"componentId":{"$ref":"common_types.json#/$defs/ComponentId"},"path":{"type":"string","description":"The path to the list of component property objects in the data model."}},"required":["componentId","path"],"additionalProperties":false}]},"DataBinding":{"type":"object","properties":{"path":{"type":"string","description":"A JSON Pointer path to a value in the data model."}},"required":["path"],"additionalProperties":false},"FunctionCall":{"type":"object","description":"Invokes a named function on the client.","properties":{"call":{"type":"string","description":"The name of the function to call."},"args":{"type":"object","description":"Arguments passed to the function.","additionalProperties":{"$ref":"common_types.json#/$defs/DynamicValue"}}},"required":["call"],"additionalProperties":false},"DynamicValue":{"description":"A value that can be a literal, a path, or a function call returning any type.","anyOf":[{"type":"string"},{"type":"number"},{"type":"boolean"},{"type":"array"},{"$ref":"common_types.json#/$defs/DataBinding"},{"$ref":"common_types.json#/$defs/FunctionCall"}]},"DynamicString":{"anyOf":[{"type":"string"},{"$ref":"common_types.json#/$defs/DataBinding"},{"$ref":"common_types.json#/$defs/FunctionCall"}]},"DynamicNumber":{"anyOf":[{"type":"number"},{"$ref":"common_types.json#/$defs/DataBinding"},{"$ref":"common_types.json#/$defs/FunctionCall"}]},"DynamicBoolean":{"anyOf":[{"type":"boolean"},{"$ref":"common_types.json#/$defs/DataBinding"},{"$ref":"common_types.json#/$defs/FunctionCall"}]},"DynamicStringList":{"anyOf":[{"type":"array","items":{"type":"string"}},{"$ref":"common_types.json#/$defs/DataBinding"},{"$ref":"common_types.json#/$defs/FunctionCall"}]},"Action":{"description":"Defines an interaction handler that can either trigger a server-side event or execute a local client-side function.","oneOf":[{"type":"object","description":"Triggers a server-side event.","properties":{"event":{"type":"object","properties":{"name":{"type":"string","description":"The name of the action to be dispatched to the server."},"context":{"type":"object","description":"A JSON object containing the key-value pairs for the action context. Values can be literals or paths.","additionalProperties":{"$ref":"common_types.json#/$defs/DynamicValue"}}},"required":["name"],"additionalProperties":false}},"required":["event"],"additionalProperties":false},{"type":"object","description":"Executes a local client-side function.","properties":{"functionCall":{"$ref":"common_types.json#/$defs/FunctionCall"}},"required":["functionCall"],"additionalProperties":false}]}}`)

var dynamicTypes = map[string]string{"string": "DynamicString", "number": "DynamicNumber", "boolean": "DynamicBoolean"}
var dynamicRefs = map[string]string{"string": "DynamicString", "number": "DynamicNumber", "boolean": "DynamicBoolean", "string[]": "DynamicStringList", "unknown": "DynamicValue"}

// v09Text writes 1.0 binding and call syntax in a description the v0.9 way.
func v09Text(text string) string {
	return strings.ReplaceAll(strings.ReplaceAll(text, `"@path"`, `"path"`), `"@call"`, `"call"`)
}

// v09Schema copies a schema with its descriptions written the v0.9 way.
func v09Schema(value any) any {
	if list, ok := value.([]any); ok {
		out := make([]any, len(list))
		for i, item := range list {
			out[i] = v09Schema(item)
		}
		return out
	}
	m, ok := record(value)
	if !ok {
		return value
	}
	out := map[string]any{}
	for key, child := range m {
		if text, isText := child.(string); isText && key == "description" {
			out[key] = v09Text(text)
		} else {
			out[key] = v09Schema(child)
		}
	}
	return out
}

// withDescription returns a $ref schema followed by an optional description.
func withDescription(schema map[string]any, description any) *orderedObject {
	out := newOrdered()
	for _, key := range sortedKeys(schema) {
		out.set(key, schema[key])
	}
	if text, ok := description.(string); ok {
		out.set("description", text)
	}
	return out
}

// dynamicValue returns a prop as v0.9 states it: its literal schema, a {path} or a {call}.
// Only the prop itself is made dynamic, as in the v0.9 basic catalog.
func dynamicValue(schema any) any {
	m, ok := record(schema)
	if !ok {
		return v09Ref("DynamicValue")
	}
	v09 := v09Schema(m).(map[string]any)
	if childRefKind(m) != "" {
		return v09
	}
	literal := without(v09, "description")
	description := v09["description"]
	if kind, isType := literal["type"].(string); len(literal) == 1 && isType {
		if dynamic, ok := dynamicTypes[kind]; ok {
			return withDescription(v09Ref(dynamic), description)
		}
	}
	if items, ok := record(literal["items"]); ok && len(literal) == 2 && literal["type"] == "array" && len(items) == 1 && items["type"] == "string" {
		return withDescription(v09Ref("DynamicStringList"), description)
	}
	out := newOrdered()
	if text, ok := description.(string); ok {
		out.set("description", text)
	}
	return out.set("anyOf", []any{literal, v09Ref("DataBinding"), v09Ref("FunctionCall")})
}

// dynamicProperties returns an object schema with each of its properties made dynamic.
func dynamicProperties(schema map[string]any) map[string]any {
	result := v09Schema(schema).(map[string]any)
	if properties, ok := record(schema["properties"]); ok {
		dynamic := map[string]any{}
		for key, value := range properties {
			dynamic[key] = normalizeJSON(dynamicValue(value))
		}
		result["properties"] = dynamic
	}
	return result
}

// rebaseRefs points the local refs (#/...) of a props schema to where it is embedded.
func rebaseRefs(value any, base string) any {
	if list, ok := value.([]any); ok {
		out := make([]any, len(list))
		for i, item := range list {
			out[i] = rebaseRefs(item, base)
		}
		return out
	}
	if ordered, ok := value.(*orderedObject); ok {
		out := newOrdered()
		for _, key := range ordered.keys {
			out.set(key, rebaseRefs(ordered.values[key], base))
		}
		if target, ok := out.values["$ref"].(string); ok {
			out.set("$ref", rebasedRef(target, base))
		}
		return out
	}
	m, ok := record(value)
	if !ok {
		return value
	}
	out := map[string]any{}
	for key, child := range m {
		out[key] = rebaseRefs(child, base)
	}
	if target, ok := out["$ref"].(string); ok {
		out["$ref"] = rebasedRef(target, base)
	}
	return out
}

func rebasedRef(target, base string) string {
	if target == "#" {
		return base
	}
	if strings.HasPrefix(target, "#/") {
		return base + target[1:]
	}
	return target
}

// componentSchema returns one component in the v0.9 inline catalog format, under its v0.9
// prop names.
func componentSchema(name string, manifest map[string]any, renames map[string]string) *orderedObject {
	props := object(manifest["props"])
	fields := map[string]any{}
	fieldOrder := []string{}
	add := func(key string, value any) {
		if _, ok := fields[key]; !ok {
			fieldOrder = append(fieldOrder, key)
		}
		fields[key] = value
	}
	properties := object(props["properties"])
	for _, key := range sortedKeys(properties) {
		add(key, dynamicValue(properties[key]))
	}
	events := object(manifest["events"])
	for _, key := range sortedKeys(events) {
		var description any
		if text, _ := object(events[key])["description"].(string); text != "" {
			description = v09Text(text)
		}
		add(key, withDescription(v09Ref("Action"), description))
	}
	slots := object(manifest["slots"])
	for _, key := range sortedKeys(slots) {
		if slots[key] == "single" {
			add(key, v09Ref("ComponentId"))
		} else {
			add(key, v09Ref("ChildList"))
		}
	}
	rename := func(key string) string {
		if renamed, ok := renames[key]; ok {
			return renamed
		}
		return key
	}
	segment := strings.ReplaceAll(strings.ReplaceAll(name, "~", "~0"), "/", "~1")
	base := "#/components/" + segment + "/allOf/1"
	ordered := newOrdered().set("component", map[string]any{"const": name})
	order, _ := stringList(manifest["parameterOrder"])
	for _, key := range append(order, fieldOrder...) {
		if value, ok := fields[key]; ok {
			if _, done := ordered.values[rename(key)]; !done {
				ordered.set(rename(key), rebaseRefs(value, base))
			}
		}
	}
	required := []any{"component"}
	list, _ := props["required"].([]any)
	for _, key := range list {
		if name, ok := key.(string); ok {
			required = append(required, rename(name))
		}
	}
	body := newOrdered().set("properties", ordered).set("required", required)
	for _, key := range []string{"$defs", "definitions"} {
		if defs, ok := record(props[key]); ok {
			body.set(key, rebaseRefs(v09Schema(defs), base))
		}
	}
	text, present := manifest["description"]
	if !present || text == nil {
		text = props["description"]
	}
	schema := newOrdered()
	if description, ok := text.(string); ok {
		schema.set("description", v09Text(description))
	}
	return schema.set("allOf", []any{v09Ref("ComponentCommon"), body})
}

func typeSchema(kind string) any {
	trimmed := strings.TrimSpace(kind)
	alternatives := strings.Split(trimmed, "|")
	if len(alternatives) > 1 {
		anyOf := []any{}
		for _, part := range alternatives {
			anyOf = append(anyOf, typeSchema(strings.TrimSpace(part)))
		}
		return map[string]any{"anyOf": anyOf}
	}
	if ref, ok := dynamicRefs[trimmed]; ok {
		return v09Ref(ref)
	}
	if strings.HasSuffix(trimmed, "[]") {
		// The whole list can be bound or computed, like any other arg.
		list := newOrdered().set("type", "array").set("items", typeSchema(strings.TrimSuffix(trimmed, "[]")))
		return map[string]any{"anyOf": []any{list, v09Ref("DataBinding"), v09Ref("FunctionCall")}}
	}
	return v09Ref("DynamicValue")
}

var indexSignature = regexp.MustCompile(`^\[\w+: string\]:\s*(.+)$`)
var namedParameter = regexp.MustCompile(`^(\w+)(\?)?:\s*(.+)$`)

// argsSchemaFromSignature returns the JSON Schema of the args of a built-in function, from
// its short signature.
func argsSchemaFromSignature(signature string) *orderedObject {
	body := strings.TrimSpace(signature)
	body = strings.TrimSuffix(strings.TrimPrefix(body, "{"), "}")
	properties := newOrdered()
	required := []any{}
	var additional any = false
	for _, part := range strings.Split(body, ";") {
		entry := strings.TrimSpace(part)
		if entry == "" {
			continue
		}
		if match := indexSignature.FindStringSubmatch(entry); match != nil {
			additional = typeSchema(match[1])
			continue
		}
		match := namedParameter.FindStringSubmatch(entry)
		if match == nil {
			continue
		}
		properties.set(match[1], typeSchema(match[3]))
		if match[2] == "" {
			required = append(required, match[1])
		}
	}
	schema := newOrdered().set("type", "object").set("properties", properties)
	if len(required) > 0 {
		schema.set("required", required)
	}
	return schema.set("additionalProperties", additional)
}

func functionSchema(name string, description, returnType any, parameters any) *orderedObject {
	schema := newOrdered().set("name", name)
	if text, ok := description.(string); ok && text != "" {
		schema.set("description", v09Text(text))
	}
	// v0.9 has no validationResult: its checks are boolean function calls.
	switch {
	case returnType == "validationResult":
		returnType = "boolean"
	case returnType == nil:
		returnType = "any"
	}
	return schema.set("returnType", returnType).set("parameters", parameters)
}

// catalogFunctions returns the basic functions, then the app functions the renderer may call.
func catalogFunctions(functions map[string]any) []any {
	result := []any{}
	for _, fn := range a2uiBasicFunctions {
		if _, declared := functions[fn.name]; !declared {
			result = append(result, functionSchema(fn.name, fn.description, fn.returnType, argsSchemaFromSignature(fn.parameters)))
		}
	}
	for _, name := range sortedKeys(functions) {
		fn := object(functions[name])
		if renderer, _ := functionCallers(fn); renderer {
			result = append(result, functionSchema(name, fn["description"], fn["returnType"], dynamicProperties(object(fn["parameters"]))))
		}
	}
	return result
}

// v09Capabilities lists the catalog id, then the components beyond the v0.9 basic catalog.
func v09Capabilities(catalogID string, names []string, hasNames bool) string {
	lines := []string{"Available A2UI catalog:"}
	if !hasNames {
		return strings.Join(append(lines, "- "+catalogID), "\n")
	}
	extra := []string{}
	for _, name := range names {
		if !containsString(v09BasicComponents, name) {
			extra = append(extra, name)
		}
	}
	superset := true
	for _, name := range v09BasicComponents {
		superset = superset && containsString(names, name)
	}
	if catalogID == v09BasicCatalogID && superset && len(extra) == 0 {
		return strings.Join(append(lines, "- "+catalogID+" (basic catalog)"), "\n")
	}
	lines = append(lines, "- "+catalogID)
	if superset {
		lines = append(lines, "  Extends the basic catalog with all standard components plus:")
	} else {
		lines = append(lines, "  Custom catalog (does NOT include all basic components).", "  Custom components:")
	}
	for _, name := range extra {
		lines = append(lines, "  - "+name)
	}
	return strings.Join(lines, "\n")
}

// buildV09CatalogContext returns the A2UI v0.9 catalog context of a run, from the client's
// generative UI envelope: capabilities, the component schema in the v0.9 inline catalog
// format, and the v0.9 generation and design guidelines, as the v0.9 client sent them. The
// components are the 18 basic ones of the standard catalog plus the UI's own components.
// The catalog id is the v0.9 basic catalog id when the UI includes the standard catalog.
// It returns ok false when the run has no envelope.
func buildV09CatalogContext(input map[string]any) (string, []any, bool) {
	envelope := readEnvelope(input["forwardedProps"])
	if envelope == nil {
		return "", nil, false
	}
	manifest := envelopeToManifest(envelope)
	ids := manifest.catalogIDs
	if len(ids) == 0 {
		ids = []string{manifest.catalogID}
	}
	extendsStandard := containsString(ids, standardCatalogID)
	catalogID := manifest.catalogID
	if extendsStandard {
		catalogID = v09BasicCatalogID
	}
	if !manifest.hasComponents {
		return catalogID, []any{map[string]any{"description": v09CapabilitiesDescription, "value": v09Capabilities(catalogID, nil, false)}}, true
	}
	components := newOrdered()
	for _, name := range sortedKeys(manifest.components) {
		standard := extendsStandard && standardComponents[name]
		// Of the standard components, a v0.9 agent knows the basic ones only.
		if standard && !containsString(v09BasicComponents, name) {
			continue
		}
		var renames map[string]string
		if standard {
			renames = v10ToV09PropNames[name]
		}
		components.set(name, componentSchema(name, object(manifest.components[name]), renames))
	}
	schema := newOrdered().set("catalogId", catalogID).set("components", components).set("functions", catalogFunctions(manifest.functions)).set("common_types.json", map[string]any{"$defs": v09CommonTypes})
	return catalogID, []any{
		map[string]any{"description": v09CapabilitiesDescription, "value": v09Capabilities(catalogID, components.keys, true)},
		map[string]any{"description": a2uiSchemaDescription, "value": compactJSON(schema)},
		map[string]any{"description": v09GenerationGuidelinesDescription, "value": a2uiDefaultGenerationGuidelines},
		map[string]any{"description": v09DesignGuidelinesDescription, "value": a2uiDefaultDesignGuidelines},
	}, true
}

// ---------------------------------------------------------------------------
// The bridge (a2ui-v09-middleware.ts)

// prepareV09AgentInput returns the input of the agent side of a run; it never mutates input.
// A click on a surface of v0.9 origin becomes the v0.9 action. A 0.9 agent also gets the v0.9
// catalog context; an entry with the same description is replaced. The runtime stores the
// client's input, so the thread keeps the click message.
func prepareV09AgentInput(input map[string]any, agentVersion string) map[string]any {
	agentInput := downgradeV09Action(input, agentVersion)
	if agentVersion != "0.9" {
		return agentInput
	}
	_, entries, ok := buildV09CatalogContext(agentInput)
	if !ok {
		return agentInput
	}
	descriptions := map[any]bool{}
	for _, entry := range entries {
		descriptions[object(entry)["description"]] = true
	}
	context := []any{}
	existing, _ := agentInput["context"].([]any)
	for _, entry := range existing {
		if m, ok := record(entry); ok && descriptions[m["description"]] {
			continue
		}
		context = append(context, entry)
	}
	next := shallowCopy(agentInput)
	next["context"] = append(context, entries...)
	return next
}

// A2UI_DEFAULT_GENERATION_GUIDELINES of @copilotkit/shared, as the v0.9 client sent it.
const a2uiDefaultGenerationGuidelines = `Generate A2UI v0.9 JSON.

## A2UI Protocol Instructions

A2UI (Agent to UI) is a protocol for rendering rich UI surfaces from agent responses.

CRITICAL: You MUST call the render_a2ui tool with ALL of these arguments:
- surfaceId: A unique ID for the surface (e.g. "product-comparison")
- components: REQUIRED — the A2UI component array. NEVER omit this. Only use
  components listed in the Available Components schema provided as context.
- data: OPTIONAL — a JSON object written to the root of the surface data model.
  Use for pre-filling form values or providing data for path-bound components.
- every component must have the "component" field specifying the component type.
  ONLY use component names from the Available Components schema — do NOT invent
  component names or use names not in the schema.

COMPONENT ID RULES:
- Exactly one component MUST have id="root". This is the surface's entry
  point — the renderer begins at "root" and walks the child/children tree
  from there. Every other component must be reachable from "root". If no
  component has id="root", the surface renders an empty loading placeholder
  and none of your components will be shown.
- Every component ID must be unique within the surface.
- A component MUST NOT reference itself as child/children. This causes a
  circular dependency error. For example, if a component has id="avatar",
  its child must be a DIFFERENT id (e.g. "avatar-img"), never "avatar".
- The child/children tree must be a DAG — no cycles allowed.

REPEATING CONTENT (TEMPLATES):
To repeat a component for each item in an array, use the structural children format:
  children: { componentId: "card-id", path: "/items" }
This tells the renderer to create one instance of "card-id" per item in the "/items" array.

PATH RULES FOR TEMPLATES:
Components inside a repeating template use RELATIVE paths (no leading slash).
The path is resolved relative to each array item automatically.
If a container has children: { componentId: "card", path: "/items" } and each item
has a key "name", use { "path": "name" } (NO leading slash — relative to item).
CRITICAL: Do NOT use "/name" (absolute) inside templates — use "name" (relative).
The container's path ("/items") uses a leading slash (absolute), but all
components INSIDE the template use paths WITHOUT leading slash.

COMPONENT VALUES — DEFAULT RULE:
Use inline literal values for ALL component properties. Pass strings, numbers,
arrays, and objects directly on the component. Do NOT use { "path": "..." }
objects unless the property's schema explicitly allows it (see exception below).
CRITICAL: USING { "path": "..." } ON A PROPERTY THAT DOES NOT DECLARE PATH
SUPPORT IN ITS SCHEMA WILL CAUSE A RUNTIME CRASH AND BREAK THE ENTIRE UI.
ALWAYS CHECK THE COMPONENT SCHEMA FIRST — IF THE PROPERTY ONLY ACCEPTS A
PLAIN TYPE, YOU MUST USE A LITERAL VALUE.
VERY IMPORTANT: THE APPLICATION WILL BREAK IF YOU DO NOT FOLLOW THIS RULE!

For example, a chart's "data" must always be an inline array:
  "data": [{"label": "Jan", "value": 100}, {"label": "Feb", "value": 200}]
A metric's "value" must always be an inline string:
  "value": "$1,200"

PATH BINDING EXCEPTION — SCHEMA-DRIVEN:
A few properties accept { "path": "/some/path" } as an alternative to a literal
value. You can identify these in the Available Components schema: the property
will list BOTH a literal type AND an object-with-path option. If a property only
shows a single type (string, number, array, etc.), it does NOT support path
binding — use a literal value only.

Path binding is typically used for editable form inputs so the client can write
user input back to the data model. When building forms:
- Bind input "value" to a data model path: "value": { "path": "/form/name" }
- Pre-fill via the "data" tool argument: "data": { "form": { "name": "Alice" } }
- Capture values on submit via button action context:
    "action": { "event": { "name": "submit", "context": { "name": { "path": "/form/name" } } } }

REPEATING CONTENT uses a structural children format (not the same as value binding):
  children: { componentId: "card-id", path: "/items" }
Components inside templates use RELATIVE paths (no leading slash): { "path": "name" }.`

// A2UI_DEFAULT_DESIGN_GUIDELINES of @copilotkit/shared, as the v0.9 client sent it.
const a2uiDefaultDesignGuidelines = `Create polished, visually appealing interfaces. ONLY use components listed in the
Available Components schema — do NOT use component names that are not in the schema.

Design principles:
- Create clear visual hierarchy within cards and layouts.
- Keep cards clean — avoid clutter. Whitespace is good.
- Use consistent surfaceIds (lowercase, hyphenated).
- NEVER use the same ID for a component and its child — this creates a
  circular dependency. E.g. if id="avatar", child must NOT be "avatar".
- For side-by-side comparisons, use a container with structural children
  (children: { componentId, path }) to repeat a card template per data item.
- Include images when relevant (logos, icons, product photos):
  - Prefer company logos via Google favicons: https://www.google.com/s2/favicons?domain=example.com&sz=128
  - Do NOT invent Unsplash photo-IDs — they will 404. Only use real, known URLs.
- For buttons: action MUST use this exact nested format:
    "action": { "event": { "name": "myAction", "context": { "key": "value" } } }
  The "event" key holds an OBJECT with "name" (required) and "context" (optional).
  Do NOT use a flat format like {"event": "name"} — "event" must be an object.
- For forms: check the component schema — if an input's "value" property
  supports path binding, use it for editable fields. The submit button's
  action context should reference the same paths to capture user input.

Use the SAME surfaceId as the main surface. Match action names to button action event names.`
