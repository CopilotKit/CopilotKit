package runtime

// Generative UI (A2UI 1.0): the render_ui tool, its guide, and validated surface events.
//
// Ports generative-ui-middleware.ts of the TypeScript runtime and the shared helpers it
// uses (a2ui-envelope.ts, validate-operation.ts, render-ui-args.ts, prompt.ts). The
// browser sends its catalog in forwardedProps.copilotkit.ui; nothing in it is trusted.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	a2uiVersion10                  = "1.0"
	generativeUIActivityType       = "generative-ui-surface"
	generativeUIRenderTool         = "render_ui"
	generativeUIChatTarget         = "chat"
	generativeUIContextDescription = "Generative UI guide: available components, functions, targets, and how to call render_ui."
	standardCatalogID              = "copilotkit/standard@1"
	componentIDRef                 = "common_types.json#/$defs/ComponentId"
	childListRef                   = "common_types.json#/$defs/ChildList"
	// The agent may not call renderer functions yet (GENERATIVE_UI_AGENT_FUNCTION_CALLS).
	agentFunctionCallsOffReason = "callRendererFunction is not supported in this version: the agent cannot call renderer functions until their results can be sent back to it reliably"
	envelopeFormat              = 3
	maxTargetComponents         = 100
	maxSummaryRejections        = 20
	maxRejectionLength          = 500
	maxUserValuesLength         = 500
	indexFunction               = "@index"
)

// GenerativeUIConfig turns on generative UI (A2UI 1.0 surfaces) for every run of Agents.
//
// A nil *GenerativeUIConfig in Config turns generative UI on only for a run whose client
// sends a "tool" catalog. A non-nil value turns it on for every run of Agents (all agents
// when Agents is nil). Disabled turns it off for every run. In JSON the option is also
// accepted as a boolean: true is an empty configuration and false sets Disabled.
//
// A2UIVersion is "1.0" (default; the agent gets render_ui and the generative UI guide) or
// "0.9" (the agent gets render_a2ui and a v0.9 schema of the client's catalog).
// A2UIVersions sets one version per agent ID instead; an agent missing from it speaks
// "1.0". The remaining fields configure the A2UI v0.9 middleware of 0.9 agents only.
// A nil InjectA2UITool adds render_a2ui when the client sends a "tool" catalog.
type GenerativeUIConfig struct {
	Disabled         bool
	Agents           []string
	A2UIVersion      string
	A2UIVersions     map[string]string
	Schema           any
	InjectA2UITool   any
	A2UIToolNames    []string
	DefaultCatalogID string
	Recovery         *A2UIRecovery
}

// A2UIRecovery configures the generation lifecycle of the A2UI v0.9 middleware.
type A2UIRecovery struct {
	MaxAttempts        int    `json:"maxAttempts,omitempty"`
	ShowProgressTokens *bool  `json:"showProgressTokens,omitempty"`
	DebugExposure      string `json:"debugExposure,omitempty"`
}

type generativeUIJSON struct {
	Agents           []string      `json:"agents,omitempty"`
	A2UIVersion      any           `json:"a2uiVersion,omitempty"`
	Schema           any           `json:"schema,omitempty"`
	InjectA2UITool   any           `json:"injectA2UITool,omitempty"`
	A2UIToolNames    []string      `json:"a2uiToolNames,omitempty"`
	DefaultCatalogID string        `json:"defaultCatalogId,omitempty"`
	Recovery         *A2UIRecovery `json:"recovery,omitempty"`
}

// UnmarshalJSON reads the TypeScript runtime option: a boolean or an options object.
func (c *GenerativeUIConfig) UnmarshalJSON(raw []byte) error {
	var enabled bool
	if json.Unmarshal(raw, &enabled) == nil {
		*c = GenerativeUIConfig{Disabled: !enabled}
		return nil
	}
	var value generativeUIJSON
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	*c = GenerativeUIConfig{Agents: value.Agents, Schema: value.Schema, InjectA2UITool: value.InjectA2UITool, A2UIToolNames: value.A2UIToolNames, DefaultCatalogID: value.DefaultCatalogID, Recovery: value.Recovery}
	switch version := value.A2UIVersion.(type) {
	case nil:
	case string:
		c.A2UIVersion = version
	case map[string]any:
		c.A2UIVersions = map[string]string{}
		for agent, v := range version {
			s, ok := v.(string)
			if !ok {
				return errors.New(`a2uiVersion must be "0.9", "1.0", or a map of agent IDs to them`)
			}
			c.A2UIVersions[agent] = s
		}
	default:
		return errors.New(`a2uiVersion must be "0.9", "1.0", or a map of agent IDs to them`)
	}
	return nil
}

// MarshalJSON writes the TypeScript runtime option.
func (c GenerativeUIConfig) MarshalJSON() ([]byte, error) {
	if c.Disabled {
		return []byte("false"), nil
	}
	value := generativeUIJSON{Agents: c.Agents, Schema: c.Schema, InjectA2UITool: c.InjectA2UITool, A2UIToolNames: c.A2UIToolNames, DefaultCatalogID: c.DefaultCatalogID, Recovery: c.Recovery}
	if c.A2UIVersions != nil {
		value.A2UIVersion = c.A2UIVersions
	} else if c.A2UIVersion != "" {
		value.A2UIVersion = c.A2UIVersion
	}
	return json.Marshal(value)
}

// cloneGenerativeUI validates the option and copies it, so the host cannot change it later.
func cloneGenerativeUI(c *GenerativeUIConfig) (*GenerativeUIConfig, error) {
	if c == nil {
		return nil, nil
	}
	copy := *c
	if c.Agents != nil {
		copy.Agents = append([]string{}, c.Agents...)
	}
	if c.A2UIToolNames != nil {
		copy.A2UIToolNames = append([]string{}, c.A2UIToolNames...)
	}
	versions := []string{c.A2UIVersion}
	if c.A2UIVersions != nil {
		copy.A2UIVersions = map[string]string{}
		versions = nil
		for agent, version := range c.A2UIVersions {
			copy.A2UIVersions[agent] = version
			versions = append(versions, version)
		}
	}
	for _, version := range versions {
		if version != "" && version != "0.9" && version != "1.0" {
			return nil, errors.New(`a2uiVersion must be "0.9", "1.0", or a map of agent IDs to them`)
		}
	}
	switch tool := c.InjectA2UITool.(type) {
	case nil, bool:
	case string:
		if tool == "" {
			return nil, errors.New("injectA2UITool must be a boolean or tool name")
		}
	default:
		return nil, errors.New("injectA2UITool must be a boolean or tool name")
	}
	if c.Schema != nil {
		raw, err := json.Marshal(c.Schema)
		if err != nil {
			return nil, errors.New("invalid generative UI schema")
		}
		json.Unmarshal(raw, &copy.Schema)
	}
	if c.Recovery != nil {
		recovery := *c.Recovery
		if recovery.MaxAttempts < 0 {
			return nil, errors.New("recovery.maxAttempts must be positive")
		}
		switch recovery.DebugExposure {
		case "", "hidden", "collapsed", "verbose":
		default:
			return nil, errors.New("invalid A2UI debug exposure")
		}
		copy.Recovery = &recovery
	}
	return &copy, nil
}

// resolveA2UIVersion returns the A2UI version of one agent: "1.0" unless the option says "0.9".
func resolveA2UIVersion(option *GenerativeUIConfig, agentID string) string {
	if option == nil || option.Disabled {
		return a2uiVersion10
	}
	version := option.A2UIVersion
	if option.A2UIVersions != nil {
		version = option.A2UIVersions[agentID]
	}
	if version == "0.9" {
		return "0.9"
	}
	return a2uiVersion10
}

// isGenerativeUIRun decides whether a run gets generative UI, as configureAgentForRequest does.
// It is on for a run with a "tool" envelope, and for every run when the option turns it on.
// A "markdown" envelope gets no render tool. Disabled and the Agents filter always win.
func isGenerativeUIRun(option *GenerativeUIConfig, agentID string, forwardedProps any) bool {
	if option != nil && option.Disabled {
		return false
	}
	transport := ""
	if envelope := readEnvelope(forwardedProps); envelope != nil {
		transport = str(extensionsOf(envelope)["copilotkit_transport"])
	}
	if transport != "tool" && (transport == "markdown" || option == nil) {
		return false
	}
	return option == nil || option.Agents == nil || containsString(option.Agents, agentID)
}

// a2uiMiddlewareConfig returns the v0.9 middleware of a run: full options for a 0.9 agent,
// extraction of tool results only for a 1.0 agent.
func a2uiMiddlewareConfig(option *GenerativeUIConfig, version string, forwardedProps any) *a2uiConfig {
	if version != "0.9" {
		return &a2uiConfig{}
	}
	envelope := readEnvelope(forwardedProps)
	isTool := envelope != nil && extensionsOf(envelope)["copilotkit_transport"] == "tool"
	config := GenerativeUIConfig{}
	if option != nil {
		config = *option
	}
	inject := config.InjectA2UITool
	if inject == nil {
		inject = isTool
	}
	result := &a2uiConfig{InjectA2UITool: inject, DefaultCatalogID: config.DefaultCatalogID, Schema: config.Schema, ToolNames: config.A2UIToolNames, MaxAttempts: 3, ShowProgressTokens: true}
	if config.Recovery != nil {
		if config.Recovery.MaxAttempts > 0 {
			result.MaxAttempts = config.Recovery.MaxAttempts
		}
		if config.Recovery.ShowProgressTokens != nil {
			result.ShowProgressTokens = *config.Recovery.ShowProgressTokens
		}
		result.DebugExposure = config.Recovery.DebugExposure
	}
	return result
}

// generativeUIInfo returns the generativeUI field of /info.
func generativeUIInfo(option *GenerativeUIConfig) map[string]any {
	if option != nil && option.Disabled {
		return map[string]any{"enabled": false}
	}
	if option != nil && option.Agents != nil {
		return map[string]any{"enabled": true, "agents": append([]string{}, option.Agents...)}
	}
	return map[string]any{"enabled": true}
}

// ---------------------------------------------------------------------------
// JSON helpers

// compactJSON serializes like JSON.stringify: no HTML escaping and no trailing newline.
// Object keys of maps are sorted, as encoding/json does.
func compactJSON(v any) string {
	var b bytes.Buffer
	encoder := json.NewEncoder(&b)
	encoder.SetEscapeHTML(false)
	if encoder.Encode(v) != nil {
		return "null"
	}
	return strings.TrimSuffix(b.String(), "\n")
}

// orderedObject is a JSON object that keeps the order in which its keys were set.
type orderedObject struct {
	keys   []string
	values map[string]any
}

func newOrdered() *orderedObject { return &orderedObject{values: map[string]any{}} }

func (o *orderedObject) set(key string, value any) *orderedObject {
	if _, ok := o.values[key]; !ok {
		o.keys = append(o.keys, key)
	}
	o.values[key] = value
	return o
}

func (o *orderedObject) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, key := range o.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(compactJSON(key))
		b.WriteByte(':')
		b.WriteString(compactJSON(o.values[key]))
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func record(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok && m != nil
}
func isRecord(v any) bool { _, ok := record(v); return ok }
func nonEmptyString(v any) bool {
	s, ok := v.(string)
	return ok && s != ""
}
func isString(v any) bool { _, ok := v.(string); return ok }
func jsonNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, !math.IsNaN(n) && !math.IsInf(n, 0)
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}
func optionalString(m map[string]any, key string) bool {
	v, ok := m[key]
	return !ok || isString(v)
}
func recordOf(v any, check func(any) bool) bool {
	m, ok := record(v)
	if !ok {
		return false
	}
	for _, entry := range m {
		if !check(entry) {
			return false
		}
	}
	return true
}
func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// keyOrder records the key order of decoded JSON objects, which JSON.parse keeps and
// encoding/json does not, so that validation reports the first problem of an object as the
// TypeScript runtime does. An entry holds its object, so the address stays unique.
type keyOrder map[uintptr]orderedKeys

type orderedKeys struct {
	object map[string]any
	keys   []string
}

// keys returns the keys of m in their JSON order when it is known, and sorted otherwise.
func (o keyOrder) keys(m map[string]any) []string {
	if entry, ok := o[reflect.ValueOf(m).Pointer()]; ok && len(entry.keys) == len(m) {
		return entry.keys
	}
	return sortedKeys(m)
}

// decodeOrdered decodes one JSON value like encoding/json and records the key order of its
// objects in order.
func decodeOrdered(raw string, order keyOrder) (any, error) {
	d := json.NewDecoder(strings.NewReader(raw))
	value, err := decodeOrderedValue(d, order)
	if err != nil {
		return nil, err
	}
	if _, err := d.Token(); err != io.EOF {
		return nil, errors.New("trailing JSON")
	}
	return value, nil
}

func decodeOrderedValue(d *json.Decoder, order keyOrder) (any, error) {
	token, err := d.Token()
	if err != nil {
		return nil, err
	}
	switch token {
	case json.Delim('{'):
		m := map[string]any{}
		keys := []string{}
		for d.More() {
			name, err := d.Token()
			if err != nil {
				return nil, err
			}
			key, _ := name.(string)
			value, err := decodeOrderedValue(d, order)
			if err != nil {
				return nil, err
			}
			// A repeated key keeps its first position and takes the last value.
			if _, repeated := m[key]; !repeated {
				keys = append(keys, key)
			}
			m[key] = value
		}
		if _, err := d.Token(); err != nil {
			return nil, err
		}
		if order != nil {
			order[reflect.ValueOf(m).Pointer()] = orderedKeys{m, keys}
		}
		return m, nil
	case json.Delim('['):
		list := []any{}
		for d.More() {
			value, err := decodeOrderedValue(d, order)
			if err != nil {
				return nil, err
			}
			list = append(list, value)
		}
		if _, err := d.Token(); err != nil {
			return nil, err
		}
		return list, nil
	}
	return token, nil
}

func containsString(list []string, value string) bool {
	for _, entry := range list {
		if entry == value {
			return true
		}
	}
	return false
}
func stringList(v any) ([]string, bool) {
	list, ok := v.([]any)
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(list))
	for _, entry := range list {
		s, ok := entry.(string)
		if !ok {
			return nil, false
		}
		out = append(out, s)
	}
	return out, true
}

// jsString is String(value) of JavaScript, for rejection reasons.
func jsString(v any) string {
	switch value := v.(type) {
	case string:
		return value
	case bool:
		if value {
			return "true"
		}
		return "false"
	case nil:
		return "null"
	case map[string]any, *orderedObject:
		return "[object Object]"
	case []any:
		parts := make([]string, len(value))
		for i, item := range value {
			if item != nil {
				parts[i] = jsString(item)
			}
		}
		return strings.Join(parts, ",")
	}
	if n, ok := jsonNumber(v); ok {
		if n == math.Trunc(n) && math.Abs(n) < 1e21 {
			return strconv.FormatFloat(n, 'f', -1, 64)
		}
		return strconv.FormatFloat(n, 'g', -1, 64)
	}
	return fmt.Sprint(v)
}

// ---------------------------------------------------------------------------
// Built-in functions (basic-functions.ts)

type basicFunction struct {
	name, description, parameters, returnType string
	requiresUserActivation                    bool
}

var a2uiBasicFunctions = []basicFunction{
	{"required", "Valid when the value is not empty", "{ value: unknown }", "validationResult", false},
	{"regex", "Valid when the value matches the pattern", "{ value: string; pattern: string }", "validationResult", false},
	{"length", "Valid when the length of the value is within min and max", "{ value: string; min?: number; max?: number }", "validationResult", false},
	{"numeric", "Valid when the value is a number within min and max", "{ value: number; min?: number; max?: number }", "validationResult", false},
	{"email", "Valid when the value is an email address", "{ value: string }", "validationResult", false},
	{"formatString", "Interpolates ${/path}, ${relative/path} and ${fn(arg: value)} in the value; \\${ is a literal", "{ value: string }", "string", false},
	{"formatNumber", "The number in the locale of the user", "{ value: number; decimals?: number; grouping?: boolean }", "string", false},
	{"formatCurrency", "The amount as money, with an ISO 4217 currency code", "{ value: number; currency: string; decimals?: number; grouping?: boolean }", "string", false},
	{"formatDate", `A date or ISO string in a TR35 pattern, for example "MMM d, yyyy" or "HH:mm"`, "{ value: string | number; format: string }", "string", false},
	{"pluralize", "The string of the plural category of the value", "{ value: number; zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }", "string", false},
	{"openUrl", "Opens an http(s) URL in a new tab. Only from an event", "{ url: string }", "void", true},
	{"and", "True when every value is true", "{ values: boolean[] }", "boolean", false},
	{"or", "True when any value is true", "{ values: boolean[] }", "boolean", false},
	{"not", "The negated value", "{ value: boolean }", "boolean", false},
}

var copilotKitFunctions = []basicFunction{
	{"calc", "The value of an arithmetic expression over the other args, by name: + - * / % ( ), x ^ y (power), comparisons, && || !, cond ? a : b, min max round floor ceil abs pow sqrt exp ln log10, the constants pi and e, 'text' + name", "{ expression: string; [name: string]: number | string | boolean }", "any", false},
	{"series", `A list of count copies of item, for chart data and template lists. Put arithmetic in ${expression} strings in item, using the loop variable (default i, counting from start, default 1) and other named args. A whole-expression string retains the result type, so "${i * monthlyCost}" yields a number. Arguments, including nested calc or formatString calls in item, resolve before the series loop; those calls cannot use the loop variable. Example: {"@call":"series","args":{"count":6,"item":{"month":"${i}","cost":"${i * monthlyCost}"},"monthlyCost":{"@path":"/monthlyCost"}}}. Omit variable to use i.`, "{ count: number; item: unknown; variable?: string; start?: number; [name: string]: unknown }", "array", false},
}

var generativeUIFunctions = func() map[string]basicFunction {
	m := map[string]basicFunction{}
	for _, fn := range append(append([]basicFunction{}, a2uiBasicFunctions...), copilotKitFunctions...) {
		m[fn.name] = fn
	}
	return m
}()

// isBasicFunction is true for a built-in function name: basic, CopilotKit, or @index.
func isBasicFunction(name string) bool {
	_, ok := generativeUIFunctions[name]
	return name == indexFunction || ok
}

// isValueFunction is true for a built-in function that a prop or a check may call.
func isValueFunction(name string) bool {
	if name == indexFunction {
		return true
	}
	fn, ok := generativeUIFunctions[name]
	return ok && !fn.requiresUserActivation
}

// functionCallers returns who may call an app function, as (renderer, agent).
// An undeclared caller is the renderer.
func functionCallers(fn map[string]any) (bool, bool) {
	if activation, _ := fn["requiresUserActivation"].(bool); activation {
		return true, false
	}
	callers, _ := fn["allowedCallers"].(string)
	if callers == "" {
		callers = "rendererOnly"
	}
	return callers != "agentOnly", callers != "rendererOnly"
}

var valueFunctionList = func() string {
	names := []string{}
	for _, fn := range append(append([]basicFunction{}, a2uiBasicFunctions...), copilotKitFunctions...) {
		if isValueFunction(fn.name) {
			names = append(names, fn.name)
		}
	}
	return "@index and the built-in functions (" + strings.Join(names, ", ") + ")"
}()

// ---------------------------------------------------------------------------
// Envelope (a2ui-envelope.ts)

func isSchemaEntry(v any) bool {
	m, ok := record(v)
	return ok && isRecord(m["parameters"]) && optionalString(m, "description")
}

func isPropsSchema(v any) bool {
	m, ok := record(v)
	if !ok {
		return false
	}
	if properties, present := m["properties"]; present && !isRecord(properties) {
		return false
	}
	if required, present := m["required"]; present {
		if _, ok := stringList(required); !ok {
			return false
		}
	}
	return true
}

func isComponentManifest(v any) bool {
	m, ok := record(v)
	if !ok || !isPropsSchema(m["props"]) || !optionalString(m, "description") {
		return false
	}
	if events, present := m["events"]; present && !recordOf(events, isSchemaEntry) {
		return false
	}
	if slots, present := m["slots"]; present && !recordOf(slots, func(kind any) bool { return kind == "single" || kind == "multiple" }) {
		return false
	}
	order, present := m["parameterOrder"]
	if !present {
		return true
	}
	keys := map[string]bool{}
	for key := range object(object(m["props"])["properties"]) {
		keys[key] = true
	}
	for key := range object(m["slots"]) {
		keys[key] = true
	}
	for key := range object(m["events"]) {
		keys[key] = true
	}
	names, ok := stringList(order)
	if !ok {
		return false
	}
	seen := map[string]bool{}
	for _, name := range names {
		if !keys[name] || seen[name] {
			return false
		}
		seen[name] = true
	}
	return true
}

func isInlineCatalog(v any) bool {
	m, ok := record(v)
	if !ok || !nonEmptyString(m["catalogId"]) || m["protocolVersion"] != "1.0" {
		return false
	}
	if components, present := m["components"]; present && !recordOf(components, isComponentManifest) {
		return false
	}
	return recordOf(m["functions"], isSchemaEntry) && optionalString(m, "instructions")
}

func isCapabilities(v any) bool {
	m, ok := record(v)
	if !ok {
		return false
	}
	ids, ok := m["supportedCatalogIds"].([]any)
	if !ok || len(ids) == 0 {
		return false
	}
	for _, id := range ids {
		if !nonEmptyString(id) {
			return false
		}
	}
	if catalogs, present := m["inlineCatalogs"]; present {
		list, ok := catalogs.([]any)
		if !ok {
			return false
		}
		for _, catalog := range list {
			if !isInlineCatalog(catalog) {
				return false
			}
		}
	}
	return true
}

func isTarget(v any) bool {
	m, ok := record(v)
	if !ok || !nonEmptyString(m["id"]) || (m["kind"] != "chat" && m["kind"] != "inline") || !optionalString(m, "description") {
		return false
	}
	if components, present := m["components"]; present {
		list, ok := components.([]any)
		if !ok || len(list) > maxTargetComponents {
			return false
		}
		for _, name := range list {
			if !nonEmptyString(name) {
				return false
			}
		}
	}
	return true
}

func isSurfaceEntry(v any) bool {
	m, ok := record(v)
	if !ok || !nonEmptyString(m["target"]) {
		return false
	}
	if dataModel, present := m["dataModel"]; present && !isRecord(dataModel) {
		return false
	}
	if rejected, present := m["rejected"]; present {
		list, ok := rejected.([]any)
		if !ok || len(list) > maxSummaryRejections {
			return false
		}
		for _, entry := range list {
			s, ok := entry.(string)
			if !ok || utf16Length(s) > maxRejectionLength {
				return false
			}
		}
	}
	status, present := m["status"]
	return !present || status == "deleted" || status == "failed"
}

func isExtensions(v any) bool {
	m, ok := record(v)
	if !ok {
		return false
	}
	format, ok := jsonNumber(m["copilotkit_format"])
	if !ok || format != envelopeFormat {
		return false
	}
	if m["copilotkit_transport"] != "tool" && m["copilotkit_transport"] != "markdown" {
		return false
	}
	targets, ok := m["copilotkit_targets"].([]any)
	if !ok {
		return false
	}
	for _, target := range targets {
		if !isTarget(target) {
			return false
		}
	}
	_, sent := m["copilotkit_contextSent"].(bool)
	return recordOf(m["copilotkit_surfaces"], isSurfaceEntry) && sent
}

// readEnvelope reads the generative UI envelope from forwardedProps, or nil when it is malformed.
func readEnvelope(forwardedProps any) map[string]any {
	envelope, ok := record(object(object(forwardedProps)["copilotkit"])["ui"])
	if ok && isCapabilities(envelope["1.0"]) && isRecord(envelope["metadata"]) && isExtensions(object(envelope["metadata"])["extensions"]) {
		return envelope
	}
	return nil
}

func extensionsOf(envelope map[string]any) map[string]any {
	return object(object(envelope["metadata"])["extensions"])
}

// generativeUIManifest is what the client renders: its catalog, functions, targets and surfaces.
type generativeUIManifest struct {
	catalogID     string
	catalogIDs    []string
	components    map[string]any
	functions     map[string]any
	targets       []any
	surfaces      map[string]any
	transport     string
	hasComponents bool
	action        map[string]any
}

// envelopeToManifest turns an envelope from readEnvelope into the manifest of the run.
func envelopeToManifest(envelope map[string]any) *generativeUIManifest {
	capabilities := object(envelope["1.0"])
	ids, _ := stringList(capabilities["supportedCatalogIds"])
	var catalog map[string]any
	inline, _ := capabilities["inlineCatalogs"].([]any)
	for _, entry := range inline {
		if object(entry)["catalogId"] == ids[0] {
			catalog = object(entry)
			break
		}
	}
	extensions := extensionsOf(envelope)
	targets, _ := extensions["copilotkit_targets"].([]any)
	manifest := &generativeUIManifest{catalogID: ids[0], catalogIDs: ids, components: map[string]any{}, functions: map[string]any{}, targets: targets, surfaces: object(extensions["copilotkit_surfaces"]), transport: str(extensions["copilotkit_transport"])}
	if catalog != nil {
		_, manifest.hasComponents = catalog["components"]
		manifest.components = object(catalog["components"])
		manifest.functions = object(catalog["functions"])
	}
	if action, ok := record(extensions["copilotkit_action"]); ok {
		manifest.action = action
	}
	return manifest
}

// readToolManifest returns the manifest of a "tool" run whose catalog has components.
func readToolManifest(forwardedProps any) *generativeUIManifest {
	envelope := readEnvelope(forwardedProps)
	if envelope == nil {
		return nil
	}
	manifest := envelopeToManifest(envelope)
	if manifest.transport != "tool" || !manifest.hasComponents {
		return nil
	}
	return manifest
}

// ---------------------------------------------------------------------------
// Component references (child-refs.ts)

type childRef struct {
	path []string
	kind string
}

// childRefKind returns "single" or "multiple" for a component reference schema.
func childRefKind(schema map[string]any) string {
	switch schema["$ref"] {
	case componentIDRef:
		return "single"
	case childListRef:
		return "multiple"
	}
	return ""
}

// collectChildRefs returns every component reference in a props schema, with its path
// ("*" for array items).
func collectChildRefs(schema any) []childRef {
	refs := []childRef{}
	seen := map[string]bool{}
	add := func(path []string, kind string) {
		key := strings.Join(path, "\x00")
		if seen[key] {
			return
		}
		seen[key] = true
		refs = append(refs, childRef{append([]string{}, path...), kind})
	}
	var visit func(node any, path []string)
	visit = func(node any, path []string) {
		m, ok := record(node)
		if !ok {
			return
		}
		if kind := childRefKind(m); kind != "" {
			add(path, kind)
			return
		}
		for _, key := range []string{"anyOf", "oneOf"} {
			variants, ok := m[key].([]any)
			if !ok || len(variants) == 0 {
				continue
			}
			kinds := make([]string, len(variants))
			for i, variant := range variants {
				if v, ok := record(variant); ok {
					kinds[i] = childRefKind(v)
				}
			}
			same, none := kinds[0] != "", true
			for _, kind := range kinds {
				same = same && kind == kinds[0]
				none = none && kind == ""
			}
			if same {
				add(path, kinds[0])
			} else if none {
				// A nested reference counts only when every alternative has it.
				perVariant := make([][]childRef, len(variants))
				for i, variant := range variants {
					perVariant[i] = collectChildRefs(variant)
				}
				for _, ref := range perVariant[0] {
					everywhere := true
					for _, other := range perVariant {
						found := false
						for _, candidate := range other {
							found = found || (candidate.kind == ref.kind && strings.Join(candidate.path, "\x00") == strings.Join(ref.path, "\x00"))
						}
						everywhere = everywhere && found
					}
					if everywhere {
						add(append(append([]string{}, path...), ref.path...), ref.kind)
					}
				}
			}
		}
		if all, ok := m["allOf"].([]any); ok {
			for _, variant := range all {
				visit(variant, path)
			}
		}
		if properties, ok := record(m["properties"]); ok {
			for _, key := range sortedKeys(properties) {
				visit(properties[key], append(append([]string{}, path...), key))
			}
		}
		if items, ok := record(m["items"]); ok {
			visit(items, append(append([]string{}, path...), "*"))
		}
	}
	visit(schema, nil)
	return refs
}

// ---------------------------------------------------------------------------
// Operation validation (validate-operation.ts)

var operationKinds = []string{"createSurface", "updateComponents", "updateDataModel", "deleteSurface", "callRendererFunction"}

const v09PathReason = `bind data with {"@path": "/x"}, not {"path": "/x"}`

var forbiddenSegments = map[string]bool{"__proto__": true, "constructor": true, "prototype": true}
var accessibilityKeys = []string{"label", "description", "live", "hidden"}
var liveValues = []string{"off", "polite", "assertive"}

// operationKind returns the one operation key of op, when it has exactly one.
func operationKind(op any) string {
	m, ok := record(op)
	if !ok {
		return ""
	}
	found := ""
	for _, kind := range operationKinds {
		if _, ok := m[kind]; ok {
			if found != "" {
				return ""
			}
			found = kind
		}
	}
	return found
}

// operationSurfaceID returns the surfaceId of a surface operation.
func operationSurfaceID(op any) (string, bool) {
	kind := operationKind(op)
	if kind == "" {
		return "", false
	}
	surface, ok := object(object(op)[kind])["surfaceId"].(string)
	return surface, ok
}

func isPathBinding(v any) bool {
	m, ok := record(v)
	return ok && len(m) == 1 && isString(m["@path"])
}
func isV09PathBinding(v any) bool {
	m, ok := record(v)
	return ok && len(m) == 1 && isString(m["path"])
}
func isCallBinding(v any) bool {
	m, ok := record(v)
	return ok && isString(m["@call"])
}
func isIndexCall(v any) bool {
	m, ok := record(v)
	if !ok || m["@call"] != indexFunction {
		return false
	}
	for key := range m {
		if key != "@call" && key != "args" {
			return false
		}
	}
	raw, present := m["args"]
	if !present {
		return true
	}
	args, ok := record(raw)
	if !ok {
		return false
	}
	for key := range args {
		if key != "offset" {
			return false
		}
	}
	if offset, present := args["offset"]; present {
		_, ok := jsonNumber(offset)
		return ok
	}
	return true
}

// allowedComponents is the set of component names that one target takes.
type allowedComponents struct {
	target string
	names  []string
}

type validation struct {
	manifest  *generativeUIManifest
	known     map[string]bool
	created   map[string]bool
	functions map[string]any
	allowed   *allowedComponents
	order     keyOrder
}

// validateOperation checks one A2UI 1.0 operation from the model. It returns the rejection
// reason, or "" for a valid operation. A nil functions map means the app declares none.
// order gives the key order of the decoded operation, when it is known.
func validateOperation(op any, manifest *generativeUIManifest, known, created map[string]bool, functions map[string]any, allowed *allowedComponents, order keyOrder) string {
	if created == nil {
		created = map[string]bool{}
	}
	options := &validation{manifest, known, created, functions, allowed, order}
	m, ok := record(op)
	if !ok {
		return "operation must be a JSON object"
	}
	if version, present := m["version"]; !present || version != a2uiVersion10 {
		if s, ok := version.(string); ok {
			return fmt.Sprintf(`unsupported version "%s"; use "%s"`, s, a2uiVersion10)
		}
		return fmt.Sprintf(`operation needs "version":"%s"`, a2uiVersion10)
	}
	kind := operationKind(op)
	if kind == "" {
		return "operation must contain exactly one of " + strings.Join(operationKinds, ", ")
	}
	if kind == "callRendererFunction" {
		return agentFunctionCallsOffReason
	}
	payload, ok := record(m[kind])
	if !ok || !nonEmptyString(payload["surfaceId"]) {
		return kind + ".surfaceId is required"
	}
	surfaceID := payload["surfaceId"].(string)
	if kind == "createSurface" {
		return createSurfaceProblem(payload, surfaceID, options)
	}
	if !known[surfaceID] {
		return fmt.Sprintf(`surface "%s" does not exist; send createSurface first`, surfaceID)
	}
	switch kind {
	case "updateDataModel":
		return dataModelProblem(payload)
	case "updateComponents":
		return componentsProblem(payload["components"], "updateComponents.components", options)
	}
	return ""
}

// catalogProblem accepts a catalogId of the run's catalog or one of its bases.
func catalogProblem(catalogID any, present bool, manifest *generativeUIManifest) string {
	ids := manifest.catalogIDs
	if len(ids) == 0 {
		ids = []string{manifest.catalogID}
	}
	if !present {
		return ""
	}
	if s, ok := catalogID.(string); ok && containsString(ids, s) {
		return ""
	}
	quoted := make([]string, len(ids))
	for i, id := range ids {
		quoted[i] = `"` + id + `"`
	}
	use := strings.Join(quoted, ", ")
	if len(ids) != 1 {
		use = "one of: " + use
	}
	return fmt.Sprintf(`unknown catalog "%s"; leave out catalogId or use %s`, jsString(catalogID), use)
}

func createSurfaceProblem(payload map[string]any, surfaceID string, options *validation) string {
	if options.known[surfaceID] {
		return fmt.Sprintf(`surface "%s" already exists`, surfaceID)
	}
	if options.created[surfaceID] {
		return fmt.Sprintf(`surface id "%s" was used before; use a new surfaceId`, surfaceID)
	}
	catalogID, present := payload["catalogId"]
	if reason := catalogProblem(catalogID, present, options.manifest); reason != "" {
		return reason
	}
	if dataModel, present := payload["dataModel"]; present && !isRecord(dataModel) {
		return "createSurface.dataModel must be a JSON object"
	}
	components, present := payload["components"]
	if !present {
		return ""
	}
	return componentsProblem(components, "createSurface.components", options)
}

func dataModelProblem(payload map[string]any) string {
	value, present := payload["value"]
	if !present {
		return `updateDataModel.value is required; use "value":null to delete`
	}
	path := payload["path"]
	if path == nil {
		path = "/"
	}
	pointer, ok := path.(string)
	if !ok || !strings.HasPrefix(pointer, "/") {
		return "updateDataModel.path must be an absolute JSON pointer"
	}
	if pointer == "/" {
		if !isRecord(value) {
			return "a root updateDataModel value must be a JSON object"
		}
		return ""
	}
	return pathProblem(pointer, "updateDataModel.path")
}

var pointerEscape = regexp.MustCompile(`~([01])`)

// pathProblem checks the segments of an absolute pointer or of a template-relative path.
func pathProblem(path, label string) string {
	segments := strings.Split(strings.TrimPrefix(path, "/"), "/")
	for _, segment := range segments {
		if segment == "" {
			return label + " must not contain empty segments"
		}
	}
	for _, segment := range segments {
		decoded := pointerEscape.ReplaceAllStringFunc(segment, func(match string) string {
			if match == "~1" {
				return "/"
			}
			return "~"
		})
		if forbiddenSegments[decoded] {
			return fmt.Sprintf(`path segment "%s" is not allowed in %s`, decoded, label)
		}
	}
	return ""
}

func componentsProblem(components any, label string, options *validation) string {
	list, ok := components.([]any)
	if !ok || len(list) == 0 {
		return label + " must be a non-empty array"
	}
	ids := map[string]bool{}
	for _, raw := range list {
		node, ok := record(raw)
		if !ok {
			return "component must be a JSON object"
		}
		if !nonEmptyString(node["id"]) {
			return "id is required"
		}
		id := node["id"].(string)
		if reason := nodeProblem(node, id, options); reason != "" {
			return fmt.Sprintf(`component "%s": %s`, id, reason)
		}
		if ids[id] {
			return fmt.Sprintf(`component "%s" appears twice in one update`, id)
		}
		ids[id] = true
	}
	return ""
}

func nodeProblem(node map[string]any, id string, options *validation) string {
	name, ok := node["component"].(string)
	if !ok {
		return "component type is required"
	}
	entry, ok := record(options.manifest.components[name])
	if !ok {
		return fmt.Sprintf(`unknown component "%s"`, name)
	}
	if allowed := options.allowed; allowed != nil && !containsString(allowed.names, name) {
		names := strings.Join(allowed.names, ", ")
		if names == "" {
			names = "none"
		}
		return fmt.Sprintf(`"%s" is not allowed in target "%s"; use one of: %s`, name, allowed.target, names)
	}
	props := object(entry["props"])
	properties, _ := record(props["properties"])
	events := object(entry["events"])
	slots := object(entry["slots"])
	for _, key := range options.order.keys(node) {
		value := node[key]
		switch {
		case key == "id" || key == "component":
			continue
		case key == "catalogId":
			if reason := catalogProblem(value, true, options.manifest); reason != "" {
				return key + ": " + reason
			}
			continue
		case key == "metadata":
			m, ok := record(value)
			if extensions, present := m["extensions"]; !ok || (present && !isRecord(extensions)) {
				return `metadata must be { "extensions": { ... } }`
			}
			continue
		case key == "accessibility":
			if reason := accessibilityProblem(value, options.order); reason != "" {
				return key + ": " + reason
			}
			continue
		}
		if _, ok := events[key]; ok {
			if reason := actionBindingProblem(value, options); reason != "" {
				return key + ": " + reason
			}
			continue
		}
		if slot, ok := slots[key]; ok && slot != nil {
			if reason := slotProblem(value, str(slot), id); reason != "" {
				return key + ": " + reason
			}
			continue
		}
		if _, ok := properties[key]; !ok {
			return fmt.Sprintf(`unknown prop "%s"`, key)
		}
		if isV09PathBinding(value) {
			return key + ": " + v09PathReason
		}
		if call, found := forbiddenCall(value, options.order); found {
			return fmt.Sprintf("%s: %s; a data prop can call only %s", key, call, valueFunctionList)
		}
	}
	for _, ref := range collectChildRefs(props) {
		if reason := childRefProblem(node, ref, id); reason != "" {
			return reason
		}
	}
	required, _ := props["required"].([]any)
	for _, prop := range required {
		if name, ok := prop.(string); ok {
			if _, present := node[name]; !present {
				return fmt.Sprintf(`missing required prop "%s"`, name)
			}
		}
	}
	return ""
}

func accessibilityProblem(value any, order keyOrder) string {
	m, ok := record(value)
	if !ok {
		return `must be { "label": "...", "description": "...", "live": "polite", "hidden": false }`
	}
	for _, key := range order.keys(m) {
		entry := m[key]
		if !containsString(accessibilityKeys, key) {
			return fmt.Sprintf(`unknown key "%s"`, key)
		}
		if isV09PathBinding(entry) {
			return key + ": " + v09PathReason
		}
		if isPathBinding(entry) || isCallBinding(entry) {
			if call, found := forbiddenCall(entry, order); found {
				return key + ": " + call
			}
			continue
		}
		switch key {
		case "live":
			if s, ok := entry.(string); !ok || !containsString(liveValues, s) {
				return "live must be one of " + strings.Join(liveValues, ", ")
			}
		case "hidden":
			if _, ok := entry.(bool); !ok {
				return "hidden must be a boolean"
			}
		default:
			if !isString(entry) {
				return key + " must be a string"
			}
		}
	}
	return ""
}

func actionBindingProblem(value any, options *validation) string {
	m, ok := record(value)
	if !ok {
		return "must be an action object"
	}
	_, call := m["functionCall"]
	_, event := m["event"]
	if len(m) != 1 || (!call && !event) {
		return `must be { "event": ... } or { "functionCall": ... }`
	}
	if call {
		return functionCallProblem(m["functionCall"], "functionCall", options)
	}
	return eventProblem(m["event"], options.order)
}

func functionCallProblem(raw any, label string, options *validation) string {
	call, ok := record(raw)
	if !ok {
		return label + ` must be { "@call": "<function>", "args": { ... } }`
	}
	name, _ := call["@call"].(string)
	if name == "" {
		if isString(call["call"]) {
			return label + ` names the function with "@call", not "call"`
		}
		return label + `["@call"] must be a function name`
	}
	args, present := call["args"]
	if present && !isRecord(args) {
		return label + ".args must be an object"
	}
	catalogID, hasCatalog := call["catalogId"]
	if reason := catalogProblem(catalogID, hasCatalog, options.manifest); reason != "" {
		return label + ": " + reason
	}
	argMap := object(args)
	for _, key := range options.order.keys(argMap) {
		if isV09PathBinding(argMap[key]) {
			return fmt.Sprintf("%s.args.%s: %s", label, key, v09PathReason)
		}
	}
	// A function the app declares under a built-in name is the app's own.
	var declared map[string]any
	if options.functions != nil {
		declared, _ = record(options.functions[name])
	}
	builtIn, isBuiltIn := generativeUIFunctions[name]
	if declared != nil {
		isBuiltIn = false
	}
	if declared == nil && !isBuiltIn {
		if options.functions == nil {
			return ""
		}
		return fmt.Sprintf(`function "%s" is not exposed to generative UI`, name)
	}
	if declared == nil && options.functions == nil {
		return ""
	}
	renderer, agent, activation := true, false, builtIn.requiresUserActivation
	if declared != nil {
		renderer, agent = functionCallers(declared)
		activation, _ = declared["requiresUserActivation"].(bool)
	}
	fromAgent := strings.HasPrefix(label, "callRendererFunction")
	if fromAgent && !agent {
		if activation {
			return fmt.Sprintf(`function "%s" runs only from a user gesture; the agent cannot call it`, name)
		}
		return fmt.Sprintf(`function "%s" runs only in the UI (allowedCallers "rendererOnly"); the agent cannot call it`, name)
	}
	if !fromAgent && !renderer {
		return fmt.Sprintf(`function "%s" runs only for the agent (allowedCallers "agentOnly"); the UI cannot call it`, name)
	}
	return ""
}

func eventProblem(raw any, order keyOrder) string {
	event, ok := record(raw)
	if !ok || !nonEmptyString(event["name"]) {
		return "event.name is required"
	}
	if message, present := event["userMessage"]; present {
		_, forbidden := forbiddenCall(message, order)
		valid := isString(message) || isPathBinding(message) || (isCallBinding(message) && !forbidden)
		if !valid {
			if isV09PathBinding(message) {
				return "event.userMessage: " + v09PathReason
			}
			return `event.userMessage must be a string, {"@path": "/x"} or a function value`
		}
	}
	raw, present := event["context"]
	if !present {
		return ""
	}
	context, ok := record(raw)
	if !ok {
		return "event.context must be an object"
	}
	for _, key := range order.keys(context) {
		entry := context[key]
		if isV09PathBinding(entry) {
			return fmt.Sprintf("event.context.%s: %s", key, v09PathReason)
		}
		if call, found := forbiddenCall(entry, order); found {
			return fmt.Sprintf("event.context.%s: %s; a context value can call only %s", key, call, valueFunctionList)
		}
	}
	return ""
}

func slotProblem(value any, kind, ownID string) string {
	template, isTemplate := record(value)
	if isTemplate {
		_, isTemplate = template["componentId"]
	}
	if kind == "single" && isTemplate {
		return `a template { "componentId", "path" } is only allowed in a "multiple" slot`
	}
	if kind == "multiple" && isTemplate {
		return templateProblem(template, ownID)
	}
	ids := []any{value}
	if kind == "multiple" {
		list, ok := value.([]any)
		if !ok {
			return `must be an array of component ids or a template { "componentId", "path" }`
		}
		ids = list
	}
	for _, id := range ids {
		if !nonEmptyString(id) {
			return "must reference component ids (strings)"
		}
		if id == ownID {
			return "a component cannot be its own child"
		}
	}
	return ""
}

func templateProblem(template map[string]any, ownID string) string {
	for key := range template {
		if key != "componentId" && key != "path" {
			return `a template takes only "componentId" and "path"`
		}
	}
	if !nonEmptyString(template["componentId"]) {
		return "template componentId must be a component id"
	}
	if template["componentId"] == ownID {
		return "a component cannot be its own child"
	}
	path, _ := template["path"].(string)
	if path == "" {
		return "template path must be a JSON pointer or a relative path"
	}
	return pathProblem(path, "template path")
}

// forbiddenCall returns the first function call in a data value that is not a value
// function, at any depth.
func forbiddenCall(value any, order keyOrder) (string, bool) {
	if list, ok := value.([]any); ok {
		for _, item := range list {
			if reason, found := forbiddenCall(item, order); found {
				return reason, true
			}
		}
		return "", false
	}
	m, ok := record(value)
	if !ok || isIndexCall(m) {
		return "", false
	}
	if m["@call"] == indexFunction {
		return "@index takes only an offset", true
	}
	if isString(m["call"]) {
		return `name the function with "@call", not "call"`, true
	}
	if _, ok := m["functionCall"]; ok {
		return "an event binding is not a value", true
	}
	if name, ok := m["@call"].(string); ok {
		if !isValueFunction(name) {
			if isBasicFunction(name) {
				return fmt.Sprintf(`"%s" runs only from an event`, name), true
			}
			return fmt.Sprintf(`"%s" is not a basic function`, name), true
		}
		args, present := m["args"]
		if !present {
			return "", false
		}
		if !isRecord(args) {
			return fmt.Sprintf(`the args of "%s" must be an object`, name), true
		}
		return forbiddenCall(args, order)
	}
	for _, key := range order.keys(m) {
		if reason, found := forbiddenCall(m[key], order); found {
			return reason, true
		}
	}
	return "", false
}

// childRefProblem checks the component ids at one typed reference of a node, at any depth.
func childRefProblem(node map[string]any, ref childRef, ownID string) string {
	labels := []string{}
	for _, step := range ref.path {
		if step != "*" {
			labels = append(labels, step)
		}
	}
	label := strings.Join(labels, ".")
	var visit func(value any, steps []string) string
	visit = func(value any, steps []string) string {
		// A bound or computed value is known only at render.
		if m, ok := record(value); ok {
			if _, computed := m["@call"]; computed || isPathBinding(m) {
				return ""
			}
		}
		if len(steps) == 0 {
			if reason := slotProblem(value, ref.kind, ownID); reason != "" {
				return label + ": " + reason
			}
			return ""
		}
		if steps[0] == "*" {
			list, ok := value.([]any)
			if !ok {
				return ""
			}
			for _, item := range list {
				if reason := visit(item, steps[1:]); reason != "" {
					return reason
				}
			}
			return ""
		}
		m, ok := record(value)
		if !ok {
			return ""
		}
		next, present := m[steps[0]]
		if !present {
			return ""
		}
		return visit(next, steps[1:])
	}
	return visit(node, ref.path)
}

// ---------------------------------------------------------------------------
// Streamed render_ui arguments (render-ui-args.ts)

// parseObject parses one JSON object and records its key order, or returns nil.
func parseObject(raw string, order keyOrder) map[string]any {
	value, err := decodeOrdered(raw, order)
	if err != nil {
		return nil
	}
	m, _ := record(value)
	return m
}

// renderUIArgsStream reads target and every complete operations[] element from streamed
// arguments. Each push scans only the new text. An element that is balanced but not a JSON
// object is reported as nil.
type renderUIArgsStream struct {
	text           string
	target         *string
	operations     []map[string]any
	emitted        int
	stack          []byte
	inString       bool
	escaped        bool
	stringStart    int
	pendingKey     *string
	currentKey     any
	expectingValue bool
	inOperations   bool
	elementStart   int
	order          keyOrder
}

func newRenderUIArgsStream(order keyOrder) *renderUIArgsStream {
	return &renderUIArgsStream{stringStart: -1, elementStart: -1, order: order}
}

// hasIncompleteOperation is true when the text so far ends inside an operations[] element.
func (s *renderUIArgsStream) hasIncompleteOperation() bool { return s.elementStart >= 0 }

// push adds a delta and returns the target so far and the operations not reported before.
func (s *renderUIArgsStream) push(delta string) (*string, []map[string]any) {
	start := len(s.text)
	s.text += delta
	text := s.text
	for index := start; index < len(text); index++ {
		char := text[index]
		if s.inString {
			if s.escaped {
				s.escaped = false
			} else if char == '\\' {
				s.escaped = true
			} else if char == '"' {
				s.inString = false
				if len(s.stack) == 1 {
					literal := text[s.stringStart : index+1]
					if s.expectingValue {
						if s.currentKey == "target" {
							var target string
							if json.Unmarshal([]byte(literal), &target) == nil {
								s.target = &target
							}
						}
						s.expectingValue = false
					} else {
						s.pendingKey = &literal
					}
				}
			}
			continue
		}
		switch char {
		case '"':
			s.inString = true
			s.stringStart = index
		case ':':
			if len(s.stack) == 1 && s.pendingKey != nil {
				var key string
				if json.Unmarshal([]byte(*s.pendingKey), &key) == nil {
					s.currentKey = key
				} else {
					s.currentKey = nil
				}
				s.pendingKey = nil
				s.expectingValue = true
			}
		case ',':
			if len(s.stack) == 1 {
				s.expectingValue = false
				s.currentKey = nil
			}
		case '{':
			if s.inOperations && len(s.stack) == 2 {
				s.elementStart = index
			}
			s.stack = append(s.stack, '{')
		case '[':
			if len(s.stack) == 1 && s.expectingValue && s.currentKey == "operations" {
				s.inOperations = true
			}
			s.stack = append(s.stack, '[')
		case '}', ']':
			if len(s.stack) > 0 {
				s.stack = s.stack[:len(s.stack)-1]
			}
			if char == '}' && s.inOperations && len(s.stack) == 2 && s.elementStart >= 0 {
				s.operations = append(s.operations, parseObject(text[s.elementStart:index+1], s.order))
				s.elementStart = -1
			}
			if char == ']' && s.inOperations && len(s.stack) == 1 {
				s.inOperations = false
				s.expectingValue = false
			}
		}
	}
	fresh := s.operations[s.emitted:]
	s.emitted = len(s.operations)
	return s.target, fresh
}

// ---------------------------------------------------------------------------
// The guide (prompt.ts, prompt-spec.ts, schema-render.ts)

const generativeUIWhenToShow = "Show UI when it conveys the answer better than prose: to illustrate a concept (a diagram, a chart of how something changes), to compare options side by side, to let the user explore or adjust values, or to collect input. A small, focused surface next to your explanation often lands better than a long description. Reply in prose alone for a quick fact, a short answer, or conversation, and never add UI only as decoration."

const toolIntro = "Call `" + generativeUIRenderTool + "` to show UI. Arguments: `target` first, then `operations` (A2UI v1.0 operations, applied in order)."

// promptItem is a rule, or rules that apply only when every feature holds.
type promptItem struct {
	features []string
	rules    []string
}

func rule(text string) promptItem { return promptItem{rules: []string{text}} }

var toolOperations = []promptItem{
	rule(`{"version":"1.0","createSurface":{"surfaceId":"<new id>","dataModel":{...},"components":[{"id":"root","component":"<Name>","children":["<child id>"]}]}}: the first operation of a new surface. "dataModel" and "components" are optional.`),
	rule(`{"version":"1.0","updateComponents":{"surfaceId":"<id>","components":[<component>, ...]}}: add or replace components by id.`),
	rule(`{"version":"1.0","updateDataModel":{"surfaceId":"<id>","path":"/some/path","value":<json>}}: set the value at "path". Always give "value". "value":null deletes the key at "path".`),
	rule(`{"version":"1.0","deleteSurface":{"surfaceId":"<id>"}}: remove the surface.`),
	{[]string{"agentCalls"}, []string{`{"version":"1.0","callRendererFunction":{"functionCallId":"<unique id>","callFunction":{"@call":"<function>","args":{...}}}}: run an app function now, with no click. It needs no surface.`}},
}

var toolRules = []promptItem{
	rule(`Components are flat objects: {"id":"...","component":"<Name>", ...props}. Every surface renders from the component with id "root". Reference children by id in slot props.`),
	rule(`A component may take "accessibility":{"label":"<1 to 3 words>","description":"<what it does>"} for screen readers: on the component it describes, when nothing visible names it. Not on every component, and "live":"polite" only on text that changes by itself.`),
	rule(`Stream progressively: put the initial data in "dataModel" and the root in "components" of the createSurface operation, then send one updateComponents operation per child, so the UI appears while you are still writing. The root must already list the ids of its children in its slot props (for example "children":["card-1","card-2"]), even though the children come later. A component that no slot references is never shown.`),
	rule("Updating a component replaces all of its props, so resend every prop."),
	rule(`Prop values are literals or data bindings {"@path":"/data/path"}. Never write {"path":"/data/path"} as a binding.`),
	{[]string{"events", "functions"}, []string{`Event props take an action. {"functionCall":{"@call":"<function>","args":{...}}} runs an app function in the browser immediately, and you are not told about it. {"event":{"name":"<name>","userMessage":"<text>","context":{...}}} sends the interaction back to you as a user message, with "userMessage" as its first line. "userMessage" is plain text: ${...} is not interpolated in it; put values in "context". Only call functions listed below.`}},
	{[]string{"events", "noFunctions"}, []string{`Event props take an action: {"event":{"name":"<name>","userMessage":"<text>","context":{...}}} sends the interaction back to you as a user message, with "userMessage" as its first line. "userMessage" is plain text: ${...} is not interpolated in it; put values in "context".`}},
	rule("To show a different view, create a new surface with a new surfaceId (for example, a checkout form after a cart summary). Update an existing surface only when the user asks to change that same view: then do not send createSurface, use its surfaceId, and pass its existing target. Never reuse an earlier chat surface for a different view, because that replaces the earlier UI and anything the user typed into it."),
	rule("Never use a surfaceId again, also after deleteSurface."),
	rule(`A prop can also be a function value that updates with the data: {"@call":"formatCurrency","args":{"value":{"@path":"/total"},"currency":"EUR"}}. Only call functions listed below. formatString interpolates ${/path} and ${fn(arg: value)} in its value.`),
	rule(`${...} is evaluated only in the value of formatString and in the item of series; in other strings it stays literal text. Inside formatString, ${...} does not support operators. For arithmetic use calc, with the values as named args: {"@call":"calc","args":{"expression":"seats * 29 * (annual ? 0.8 : 1)","seats":{"@path":"/seats"},"annual":{"@path":"/annual"}}}.`),
	rule("For a computed list (chart data, template items) use series. Its description under Functions gives the rules and an example."),
	{[]string{"checks"}, []string{`Validate an input with "checks": [{"condition":{"@call":"email","args":{"value":{"@path":"/form/email"}}},"message":"Enter a valid email"}]. The check functions are required, regex, length, numeric and email. A failed check shows the message under the input and disables a Button that has the same checks.`}},
	{[]string{"templates"}, []string{`To repeat a component for each item of a list, give a multiple slot a template: "children":{"componentId":"row","path":"/items"}. Inside the template, paths are relative to the item ("name", not "/name"). {"@call":"@index"} gives the position of the item, from 0; {"@call":"@index","args":{"offset":1}} counts from 1.`}},
	{[]string{"agentCalls"}, []string{
		"Give every callRendererFunction a new functionCallId. Call only a function marked (UI or agent) or (agent only); a function with no mark is for the UI only. A function marked (agent only) is only for callRendererFunction: do not bind an event to it.",
		`The result of a callRendererFunction comes back to you in a new turn, as a developer message: {"version":"1.0","rendererFunctionResponse":{"functionCallId":"<id>","value":...}}. If the call failed, it has "error" in place of "value". Do not wait for the result in this reply, and do not guess it.`,
	}},
}

func hasChildList(schema any) bool {
	if list, ok := schema.([]any); ok {
		for _, item := range list {
			if hasChildList(item) {
				return true
			}
		}
		return false
	}
	m, ok := record(schema)
	if !ok {
		return false
	}
	if m["$ref"] == childListRef {
		return true
	}
	for _, value := range m {
		if hasChildList(value) {
			return true
		}
	}
	return false
}

// promptFeatures returns which optional rule groups apply to the manifest.
func promptFeatures(manifest *generativeUIManifest) map[string]bool {
	functions := false
	for name := range manifest.functions {
		functions = functions || !isBasicFunction(name)
	}
	features := map[string]bool{"functions": functions, "noFunctions": !functions, "agentCalls": false}
	for _, raw := range manifest.components {
		component := object(raw)
		props := object(component["props"])
		if len(object(component["events"])) > 0 {
			features["events"] = true
		}
		multiple := false
		for _, kind := range object(component["slots"]) {
			multiple = multiple || kind == "multiple"
		}
		if multiple || hasChildList(props) {
			features["templates"] = true
		}
		if properties, ok := record(props["properties"]); ok {
			if _, ok := properties["checks"]; ok {
				features["checks"] = true
			}
		}
	}
	return features
}

func selectRules(items []promptItem, features map[string]bool) []string {
	selected := []string{}
	for _, item := range items {
		applies := true
		for _, feature := range item.features {
			applies = applies && features[feature]
		}
		if applies {
			selected = append(selected, item.rules...)
		}
	}
	return selected
}

var lineBreak = regexp.MustCompile(`\s*\n\s*`)

// componentList returns the component list of the tool guide, in the "json-schema" notation.
func componentList(components map[string]any) string {
	entries := []string{}
	for _, name := range sortedKeys(components) {
		component := object(components[name])
		line := "- **" + name + "**"
		if description, _ := component["description"].(string); description != "" {
			line += ": " + lineBreak.ReplaceAllString(description, " ")
		}
		lines := []string{line, "  props: " + compactJSON(component["props"])}
		if events, present := component["events"]; present && events != nil {
			lines = append(lines, "  event props: "+compactJSON(events))
		}
		if slots, present := component["slots"]; present && slots != nil {
			lines = append(lines, "  slot props (component ids): "+compactJSON(slots))
		}
		entries = append(entries, strings.Join(lines, "\n"))
	}
	return strings.Join(entries, "\n")
}

func utf16Length(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func shorten(text string) string {
	if utf8.RuneCountInString(text) > maxUserValuesLength {
		return string([]rune(text)[:maxUserValuesLength]) + "..."
	}
	return text
}

// buildGenerativeUIPrompt returns the guide the runtime adds to a tool-transport run.
func buildGenerativeUIPrompt(manifest *generativeUIManifest) string {
	targets := []string{}
	for _, raw := range manifest.targets {
		target := object(raw)
		place := "a named area of the app"
		if target["kind"] == "chat" {
			place = "inside the chat transcript"
		}
		limit := ""
		if components, ok := target["components"].([]any); ok {
			names := make([]string, len(components))
			for i, name := range components {
				names[i] = str(name)
			}
			list := strings.Join(names, ", ")
			if list == "" {
				list = "no components"
			}
			limit = "; only " + list
		}
		description := ""
		if text, _ := target["description"].(string); text != "" {
			description = ": " + text
		}
		targets = append(targets, fmt.Sprintf(`- "%s" (%s%s)%s`, str(target["id"]), place, limit, description))
	}
	functions := []string{}
	for _, name := range sortedKeys(manifest.functions) {
		fn := object(manifest.functions[name])
		parameters := object(fn["parameters"])
		// A built-in function carries its short signature in the description of its parameters.
		args := compactJSON(fn["parameters"])
		if signature, ok := parameters["description"].(string); ok && strings.HasPrefix(signature, "{") && len(parameters) == 2 {
			args = signature
		}
		description := ""
		if text, _ := fn["description"].(string); text != "" {
			description = ": " + text
		}
		functions = append(functions, fmt.Sprintf("- **%s**%s\n  args: %s", name, description, args))
	}
	surfaces := []string{}
	hasNotes := false
	for _, id := range sortedKeys(manifest.surfaces) {
		summary := object(manifest.surfaces[id])
		state := ""
		switch summary["status"] {
		case "deleted":
			state = ", deleted: never use this id again"
		case "failed":
			state = ", not created: send a corrected createSurface with this id"
		}
		lines := []string{fmt.Sprintf(`- "%s" (target "%s"%s)`, id, str(summary["target"]), state)}
		if dataModel := summary["dataModel"]; dataModel != nil {
			lines = append(lines, "  user values: "+shorten(compactJSON(dataModel)))
		}
		rejected, _ := summary["rejected"].([]any)
		for _, rejection := range rejected {
			lines = append(lines, "  rejected: "+str(rejection))
		}
		if _, ok := summary["dataModel"]; ok || len(rejected) > 0 {
			hasNotes = true
		}
		surfaces = append(surfaces, strings.Join(lines, "\n"))
	}
	notes := ""
	if hasNotes {
		notes = "User values are what the user entered, by path. Your writes to those paths are ignored. Rejected operations were dropped: send them again with the problem fixed.\n"
	}
	features := promptFeatures(manifest)
	operations := []string{}
	for _, op := range selectRules(toolOperations, features) {
		operations = append(operations, "- "+op)
	}
	rules := []string{}
	for index, text := range selectRules(toolRules, features) {
		rules = append(rules, fmt.Sprintf("%d. %s", index+1, text))
	}
	orNone := func(text string) string {
		if text == "" {
			return "- none"
		}
		return text
	}
	return strings.Join([]string{
		"## Generative UI\n" + toolIntro + "\n\n" + generativeUIWhenToShow + "\n\n" + `Every operation has "version":"1.0" and exactly one of:` + "\n" + strings.Join(operations, "\n") + "\n\nRules:\n" + strings.Join(rules, "\n"),
		"### Targets\n" + orNone(strings.Join(targets, "\n")),
		"### Components\n" + orNone(componentList(manifest.components)),
		"### Functions\n" + orNone(strings.Join(functions, "\n")),
		"### Existing surfaces\n" + notes + orNone(strings.Join(surfaces, "\n")),
	}, "\n\n")
}

// ---------------------------------------------------------------------------
// The middleware (generative-ui-middleware.ts)

// surfaceMessageID returns the activity message id of a surface. One message per surface.
func surfaceMessageID(surfaceID string) string { return "genui:" + surfaceID }

// prepareGenerativeUI adds the render_ui tool and the generative UI guide to input.
func prepareGenerativeUI(manifest *generativeUIManifest, input map[string]any) {
	tools := []any{}
	existing, _ := input["tools"].([]any)
	for _, tool := range existing {
		if object(tool)["name"] != generativeUIRenderTool {
			tools = append(tools, tool)
		}
	}
	targetIDs := make([]any, len(manifest.targets))
	for i, target := range manifest.targets {
		targetIDs[i] = object(target)["id"]
	}
	input["tools"] = append(tools, map[string]any{
		"name":        generativeUIRenderTool,
		"description": "Render or update generative UI surfaces, or call app functions, with A2UI v1.0 operations. Follow the generative UI guide in context.",
		"parameters": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"target":     map[string]any{"type": "string", "enum": targetIDs, "description": `Where the surface is shown: "chat" or a named inline target.`},
				"operations": map[string]any{"type": "array", "description": "A2UI v1.0 operations, applied in order.", "items": map[string]any{"type": "object"}},
			},
			"required": []any{"target", "operations"},
		},
	})
	context := []any{}
	entries, _ := input["context"].([]any)
	for _, entry := range entries {
		if object(entry)["description"] != generativeUIContextDescription {
			context = append(context, entry)
		}
	}
	input["context"] = append(context, map[string]any{"description": generativeUIContextDescription, "value": buildGenerativeUIPrompt(manifest)})
}

type renderCall struct {
	stream    *renderUIArgsStream
	target    *string
	buffered  []map[string]any
	nextIndex int
	applied   int
	rejected  []any
	touched   []string
	finished  bool
}

func (c *renderCall) touch(surfaceID string) bool {
	if containsString(c.touched, surfaceID) {
		return false
	}
	c.touched = append(c.touched, surfaceID)
	return true
}

// generativeUIRun keeps the surfaces, created ids and render_ui calls of one run.
type generativeUIRun struct {
	manifest         *generativeUIManifest
	surfaces         map[string]string
	created          map[string]bool
	targetComponents map[string][]string
	catalogIDs       []string
	calls            map[string]*renderCall
	order            []string
	answered         map[string]bool
	out              []Event
	keys             keyOrder
}

// newGenerativeUIRun turns render_ui calls into surface events. Each complete operation in
// the streamed arguments is validated against the client's catalog and committed at once:
// ACTIVITY_SNAPSHOT for a new surface, ACTIVITY_DELTA for every further operation on it.
func newGenerativeUIRun(manifest *generativeUIManifest, input map[string]any) *generativeUIRun {
	run := &generativeUIRun{manifest: manifest, surfaces: map[string]string{}, created: map[string]bool{}, targetComponents: map[string][]string{}, catalogIDs: manifest.catalogIDs, calls: map[string]*renderCall{}, answered: map[string]bool{}, keys: keyOrder{}}
	for id, raw := range manifest.surfaces {
		summary := object(raw)
		// Only live surfaces take updates; a deleted or never-created one has a status.
		if status, _ := summary["status"].(string); status == "" {
			run.surfaces[id] = str(summary["target"])
		}
		// A surface id is unique for the life of the page. A failed create can be retried.
		if summary["status"] != "failed" {
			run.created[id] = true
		}
	}
	for _, raw := range manifest.targets {
		target := object(raw)
		if components, ok := stringList(target["components"]); ok {
			run.targetComponents[str(target["id"])] = components
		}
	}
	if len(run.catalogIDs) == 0 {
		run.catalogIDs = []string{manifest.catalogID}
	}
	messages, _ := input["messages"].([]any)
	for _, message := range messages {
		if m := object(message); m["role"] == "tool" {
			run.answered[str(m["toolCallId"])] = true
		}
	}
	return run
}

func (r *generativeUIRun) patch(surfaceID string, ops []any) {
	r.out = append(r.out, Event{"type": "ACTIVITY_DELTA", "messageId": surfaceMessageID(surfaceID), "activityType": generativeUIActivityType, "patch": ops})
}

// beginUpdate marks a surface streaming and clears its rejections the first time a call
// touches it.
func (r *generativeUIRun) beginUpdate(call *renderCall, surfaceID string) []any {
	if !call.touch(surfaceID) {
		return nil
	}
	return []any{map[string]any{"op": "replace", "path": "/status", "value": "streaming"}, map[string]any{"op": "replace", "path": "/rejected", "value": []any{}}}
}

func (r *generativeUIRun) reject(call *renderCall, index int, reason, surfaceID string) {
	entry := map[string]any{"index": index, "reason": reason}
	call.rejected = append(call.rejected, entry)
	if _, live := r.surfaces[surfaceID]; surfaceID != "" && live {
		r.patch(surfaceID, append(r.beginUpdate(call, surfaceID), map[string]any{"op": "add", "path": "/rejected/-", "value": entry}))
	}
}

// withCatalogID keeps a listed catalogId of a createSurface and gives it the run's catalog otherwise.
func (r *generativeUIRun) withCatalogID(op map[string]any) map[string]any {
	create, ok := record(op["createSurface"])
	if !ok {
		return op
	}
	catalogID, _ := create["catalogId"].(string)
	if !containsString(r.catalogIDs, catalogID) {
		catalogID = r.manifest.catalogID
	}
	copyCreate := map[string]any{}
	for k, v := range create {
		copyCreate[k] = v
	}
	copyCreate["catalogId"] = catalogID
	copyOp := map[string]any{}
	for k, v := range op {
		copyOp[k] = v
	}
	copyOp["createSurface"] = copyCreate
	return copyOp
}

func (r *generativeUIRun) process(call *renderCall, op map[string]any) {
	index := call.nextIndex
	call.nextIndex++
	if op == nil {
		r.reject(call, index, "operation is not valid JSON", "")
		return
	}
	surfaceID, _ := operationSurfaceID(op)
	defer func() {
		// One bad operation must not take down the run; the tool result reports it.
		if failure := recover(); failure != nil {
			r.reject(call, index, fmt.Sprintf("operation could not be processed: %v", failure), surfaceID)
		}
	}()
	r.apply(call, index, r.withCatalogID(op), surfaceID)
}

func (r *generativeUIRun) apply(call *renderCall, index int, op map[string]any, surfaceID string) {
	kind := operationKind(op)
	var target *string
	if kind == "createSurface" {
		target = call.target
	} else if existing, ok := r.surfaces[surfaceID]; ok {
		target = &existing
	}
	var allowed *allowedComponents
	if target != nil {
		if names, ok := r.targetComponents[*target]; ok {
			allowed = &allowedComponents{target: *target, names: names}
		}
	}
	known := map[string]bool{}
	for id := range r.surfaces {
		known[id] = true
	}
	if reason := validateOperation(op, r.manifest, known, r.created, r.manifest.functions, allowed, r.keys); reason != "" {
		r.reject(call, index, reason, surfaceID)
		return
	}
	if kind == "createSurface" {
		r.create(call, index, surfaceID, op)
		return
	}
	r.patch(surfaceID, append(r.beginUpdate(call, surfaceID), map[string]any{"op": "add", "path": "/operations/-", "value": op}))
	if kind == "deleteSurface" {
		delete(r.surfaces, surfaceID)
	}
	call.applied++
}

func (r *generativeUIRun) create(call *renderCall, index int, surfaceID string, op map[string]any) {
	if call.target == nil {
		r.reject(call, index, "render_ui was called without a target", "")
		return
	}
	target := *call.target
	mounted := false
	for _, entry := range r.manifest.targets {
		mounted = mounted || object(entry)["id"] == target
	}
	if !mounted {
		r.reject(call, index, fmt.Sprintf(`target "%s" is not mounted`, target), "")
		return
	}
	r.surfaces[surfaceID] = target
	r.created[surfaceID] = true
	catalogID, _ := object(op["createSurface"])["catalogId"].(string)
	if catalogID == "" {
		catalogID = r.manifest.catalogID
	}
	r.out = append(r.out, Event{"type": "ACTIVITY_SNAPSHOT", "messageId": surfaceMessageID(surfaceID), "activityType": generativeUIActivityType, "content": map[string]any{"surfaceId": surfaceID, "target": target, "catalogId": catalogID, "operations": []any{op}, "status": "streaming", "rejected": []any{}}, "replace": true})
	call.touch(surfaceID)
	call.applied++
}

// accept holds operations until the target is known.
func (r *generativeUIRun) accept(call *renderCall, op map[string]any) {
	if call.target == nil {
		call.buffered = append(call.buffered, op)
	} else {
		r.process(call, op)
	}
}

// recoverOperations recovers operations that the model sent as a JSON-encoded string.
func (r *generativeUIRun) recoverOperations(call *renderCall) {
	args := parseObject(call.stream.text, r.keys)
	if args == nil {
		return
	}
	if target, ok := args["target"].(string); ok && call.target == nil {
		call.target = &target
	}
	operations := args["operations"]
	if text, ok := operations.(string); ok {
		var err error
		if operations, err = decodeOrdered(text, r.keys); err != nil {
			return
		}
	}
	list, ok := operations.([]any)
	if !ok {
		return
	}
	for _, op := range list {
		m, _ := record(op)
		r.accept(call, m)
	}
}

func (r *generativeUIRun) finish(call *renderCall) {
	if call.finished {
		return
	}
	call.finished = true
	if call.nextIndex == 0 && len(call.buffered) == 0 {
		r.recoverOperations(call)
	}
	if call.target == nil {
		// Function calls need no target; every other operation is rejected.
		buffered := call.buffered
		call.buffered = nil
		for _, op := range buffered {
			if operationKind(op) == "callRendererFunction" {
				r.process(call, op)
				continue
			}
			call.rejected = append(call.rejected, map[string]any{"index": call.nextIndex, "reason": "render_ui was called without a target"})
			call.nextIndex++
		}
	}
	if call.stream.hasIncompleteOperation() {
		// The arguments ended inside an element, for example at the output limit.
		call.rejected = append(call.rejected, map[string]any{"index": call.nextIndex, "reason": "operation was truncated"})
		call.nextIndex++
	}
	for _, surfaceID := range call.touched {
		r.patch(surfaceID, []any{map[string]any{"op": "replace", "path": "/status", "value": "ready"}})
	}
}

// handle passes one event through and returns it with the surface events it caused.
func (r *generativeUIRun) handle(event Event) []Event {
	r.out = []Event{event}
	id, ok := event["toolCallId"].(string)
	if !ok {
		return r.out
	}
	switch event["type"] {
	case "TOOL_CALL_RESULT":
		r.answered[id] = true
	case "TOOL_CALL_START":
		if event["toolCallName"] == generativeUIRenderTool {
			if _, exists := r.calls[id]; !exists {
				r.order = append(r.order, id)
			}
			r.calls[id] = &renderCall{stream: newRenderUIArgsStream(r.keys)}
		}
	case "TOOL_CALL_ARGS":
		call := r.calls[id]
		delta, isText := event["delta"].(string)
		if call == nil || call.finished || !isText {
			break
		}
		target, operations := call.stream.push(delta)
		if target != nil && call.target == nil {
			call.target = target
			buffered := call.buffered
			call.buffered = nil
			for _, op := range buffered {
				r.process(call, op)
			}
		}
		for _, op := range operations {
			r.accept(call, op)
		}
	case "TOOL_CALL_END":
		if call := r.calls[id]; call != nil {
			r.finish(call)
		}
	}
	return r.out
}

// complete finishes every call and, before RUN_FINISHED, answers the unanswered ones.
func (r *generativeUIRun) complete(finished bool) []Event {
	r.out = []Event{}
	for _, id := range r.order {
		r.finish(r.calls[id])
	}
	if !finished {
		return r.out
	}
	for _, id := range r.order {
		if r.answered[id] {
			continue
		}
		call := r.calls[id]
		rejected := append([]any{}, call.rejected...)
		content := newOrdered().set("status", "rendered").set("applied", call.applied).set("calls", 0).set("rejected", rejected)
		if call.applied == 0 && len(rejected) == 0 {
			content.set("status", "error").set("reason", "operations must be a JSON array of A2UI operation objects; nothing was rendered")
		}
		r.out = append(r.out, Event{"type": "TOOL_CALL_RESULT", "messageId": uuid(), "toolCallId": id, "content": compactJSON(content)})
	}
	return r.out
}
