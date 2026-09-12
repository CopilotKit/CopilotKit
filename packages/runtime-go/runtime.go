// Package runtime mounts native Intelligence-only CopilotKit HTTP APIs.
package runtime

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/CopilotKit/CopilotKit/packages/runtime-go/intelligence"
)

// User is a trusted application identity, resolved by the host application.
type User struct {
	ID   string
	Name string
}

// Event retains AG-UI extension fields without loss.
type Event map[string]any

// Agent executes one run. Implementations must honor context cancellation.
type Agent interface {
	Run(context.Context, map[string]any, func(Event) error) error
}

// DescribedAgent optionally supplies discovery text without changing Agent.
type DescribedAgent interface {
	Agent
	Description() string
}

// MemoryGrant restricts user and project access when a host policy is configured.
type MemoryGrant struct {
	User    string `json:"user"`
	Project string `json:"project"`
}

// Config contains host-controlled credentials, transports, agents and policies.
type Config struct {
	Intelligence                                   *intelligence.Client
	APIKey, APIURL, RunnerURL, ClientURL, BasePath string
	IdentifyUser                                   func(*http.Request) (User, error)
	Agents                                         map[string]Agent
	HTTPClient                                     *http.Client
	MemoryAccess                                   func(*http.Request, User) (MemoryGrant, error)
	LearningContainer                              func(*http.Request, User, map[string]any) (string, error)
	TelemetryURL, TelemetryID                      string
	// LicenseToken supplies only a legacy analytics claim. It grants no access.
	LicenseToken               string
	TelemetryDisabled          bool
	TelemetrySampleRate        *float64
	OnError                    func(RuntimeError)
	AllowedOrigins             []string
	LockTTL, HeartbeatInterval time.Duration
	A2UI                       *A2UIConfig
	MCPApps                    *MCPAppsConfig
}
type activeRun struct {
	cancel context.CancelFunc
	runID  string
}

// Runtime implements http.Handler. Close drains its background work.
type Runtime struct {
	intelligence      *intelligence.Client
	ownedIntelligence bool
	config            Config
	ctx               context.Context
	cancel            context.CancelFunc
	mu                sync.Mutex
	active            map[string]activeRun
	wg                sync.WaitGroup
	telemetry         *telemetryExporter
	closed            bool
}

// New validates configuration before accepting requests.
func New(c Config) (*Runtime, error) {
	if c.Intelligence != nil {
		sdkConfig := c.Intelligence.Configuration()
		if c.APIURL != "" {
			c.APIURL = strings.TrimRight(c.APIURL, "/")
		}
		for _, pair := range []struct {
			target *string
			value  string
		}{
			{&c.APIKey, sdkConfig.APIKey}, {&c.APIURL, sdkConfig.APIURL},
			{&c.RunnerURL, sdkConfig.RunnerURL}, {&c.ClientURL, sdkConfig.ClientURL},
		} {
			if *pair.target != "" && *pair.target != pair.value {
				return nil, errors.New("Runtime transport configuration must match Intelligence")
			}
			*pair.target = pair.value
		}
		if c.HTTPClient != nil && c.HTTPClient != sdkConfig.HTTPClient {
			return nil, errors.New("configure the HTTP client on Intelligence")
		}
		c.HTTPClient = sdkConfig.HTTPClient
	}
	if strings.TrimSpace(c.APIKey) == "" || c.IdentifyUser == nil {
		return nil, errors.New("APIKey and IdentifyUser are required")
	}
	if c.APIURL == "" {
		c.APIURL = "https://api.intelligence.copilotkit.ai"
	}
	if c.RunnerURL == "" {
		c.RunnerURL = "wss://realtime.intelligence.copilotkit.ai/runner"
	}
	if c.ClientURL == "" {
		c.ClientURL = "wss://realtime.intelligence.copilotkit.ai/client"
	}
	if c.BasePath == "" {
		c.BasePath = "/copilotkit"
	}
	for _, raw := range []string{c.APIURL, c.RunnerURL, c.ClientURL} {
		u, e := url.Parse(raw)
		if e != nil || u.Host == "" || u.User != nil {
			return nil, errors.New("invalid platform URL")
		}
	}
	if c.LockTTL == 0 {
		c.LockTTL = 20 * time.Second
	}
	if c.HeartbeatInterval == 0 {
		c.HeartbeatInterval = 15 * time.Second
	}
	if c.HeartbeatInterval >= c.LockTTL || c.HeartbeatInterval <= 0 {
		return nil, errors.New("heartbeat interval must be positive and shorter than lock TTL")
	}
	sdk := c.Intelligence
	if sdk == nil {
		var err error
		sdk, err = intelligence.New(intelligence.Config{APIKey: c.APIKey, APIURL: c.APIURL, RunnerURL: c.RunnerURL, ClientURL: c.ClientURL, HTTPClient: c.HTTPClient})
		if err != nil {
			return nil, err
		}
	}
	c.Agents = cloneAgents(c.Agents)
	if c.A2UI != nil {
		raw, err := json.Marshal(c.A2UI)
		if err != nil {
			return nil, errors.New("invalid A2UI configuration")
		}
		var copy A2UIConfig
		if err = json.Unmarshal(raw, &copy); err != nil {
			return nil, err
		}
		c.A2UI = &copy
		switch c.A2UI.InjectA2UITool.(type) {
		case nil, bool, string:
		default:
			return nil, errors.New("injectA2UITool must be a boolean or tool name")
		}
	}
	if c.MCPApps != nil {
		raw, err := json.Marshal(c.MCPApps)
		if err != nil {
			return nil, err
		}
		var copy MCPAppsConfig
		if err = json.Unmarshal(raw, &copy); err != nil {
			return nil, err
		}
		c.MCPApps = &copy
		ids := map[string]bool{}
		for _, server := range c.MCPApps.Servers {
			u, err := url.Parse(server.URL)
			if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") || server.Type != "http" {
				return nil, errors.New("MCP Apps requires a configured HTTP endpoint")
			}
			if server.ServerID != "" {
				if ids[server.ServerID] {
					return nil, errors.New("duplicate MCP server ID")
				}
				ids[server.ServerID] = true
			}
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	exporter, err := newTelemetry(c)
	if err != nil {
		cancel()
		return nil, err
	}
	r := &Runtime{config: c, intelligence: sdk, ownedIntelligence: c.Intelligence == nil, ctx: ctx, cancel: cancel, active: map[string]activeRun{}, telemetry: exporter}
	r.capture("oss.runtime.instance_created", map[string]any{"actionsAmount": 0, "endpointTypes": []string{}, "endpointsAmount": 0, "agentsAmount": len(c.Agents), "cloud.api_key_provided": false})
	return r, nil
}
func cloneAgents(m map[string]Agent) map[string]Agent {
	n := map[string]Agent{}
	for k, v := range m {
		n[k] = v
	}
	return n
}

// Close cancels running agents and allows ten seconds for shutdown.
func (r *Runtime) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return r.CloseContext(ctx)
}

// CloseContext cancels running agents and bounds draining by the caller's context.
// An agent that ignores cancellation may outlive the deadline.
func (r *Runtime) CloseContext(ctx context.Context) error {
	if r.ownedIntelligence {
		defer r.intelligence.Close()
	}
	r.mu.Lock()
	r.closed = true
	r.cancel()
	r.mu.Unlock()
	done := make(chan struct{})
	go func() { r.wg.Wait(); r.telemetry.close(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		r.telemetry.cancel()
		return ctx.Err()
	}
}

// RuntimeError is delivered only to the application, never to the analytics sink.
type RuntimeError struct {
	Operation, AgentID, ThreadID, RunID string
	Err                                 error
}

// reportError isolates application callback panics from request/run cleanup.
func (r *Runtime) reportError(event RuntimeError) {
	if r.config.OnError == nil {
		return
	}
	defer func() { recover() }()
	r.config.OnError(event)
}

type platformError struct{ status int }

func (e platformError) Error() string { return "Intelligence platform request failed" }
func (r *Runtime) platform(ctx context.Context, method, path string, body any, headers map[string]string) (any, error) {
	b, e := r.intelligence.Request(ctx, method, path, body, headers)
	if e != nil {
		return nil, e
	}
	if len(b) == 0 {
		return nil, nil
	}
	var result any
	e = json.Unmarshal(b, &result)
	return result, e
}
func statusOf(e error) int {
	var sdkError *intelligence.Error
	if errors.As(e, &sdkError) {
		return sdkError.Status
	}
	var p platformError
	if errors.As(e, &p) {
		return p.status
	}
	return 502
}
func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(status)
	if v != nil {
		json.NewEncoder(w).Encode(v)
	}
}
func bad(w http.ResponseWriter, status int, message string) {
	reply(w, status, map[string]any{"error": message})
}
func str(v any) string { s, _ := v.(string); return s }
func object(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}
func identifier(v string) bool {
	return strings.TrimSpace(v) != "" && len(v) <= 128 && !strings.ContainsAny(v, "/:\\\x00\r\n")
}
func uuid() string {
	var b [16]byte
	_, e := rand.Read(b[:])
	if e != nil {
		panic(e)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	h := hex.EncodeToString(b[:])
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}
func decode(r *http.Request) (map[string]any, error) {
	var m map[string]any
	d := json.NewDecoder(io.LimitReader(r.Body, 4<<20))
	if e := d.Decode(&m); e != nil {
		return nil, e
	}
	var tail any
	if e := d.Decode(&tail); e != io.EOF {
		return nil, errors.New("trailing JSON")
	}
	if m == nil {
		return nil, errors.New("expected object")
	}
	return m, nil
}

// ServeHTTP routes the multi-route browser protocol.
func (r *Runtime) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		bad(w, 503, "Runtime shutting down")
		return
	}
	r.wg.Add(1)
	r.mu.Unlock()
	defer r.wg.Done()
	if r.ctx.Err() != nil {
		bad(w, 503, "Runtime shutting down")
		return
	}
	origin := req.Header.Get("Origin")
	for _, allowed := range r.config.AllowedOrigins {
		if origin == allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
	}
	path := strings.TrimPrefix(req.URL.Path, strings.TrimRight(r.config.BasePath, "/"))
	if path == req.URL.Path {
		bad(w, 404, "Not found")
		return
	}
	if req.Method == "OPTIONS" {
		w.WriteHeader(204)
		return
	}
	if path == "/info" {
		if req.Method != "GET" {
			bad(w, 405, "Method not allowed")
			return
		}
		r.info(w, req)
		return
	}
	if path == "/inspector-metadata" {
		if req.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			bad(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}
		r.inspectorMetadata(w, req)
		return
	}
	user, e := r.config.IdentifyUser(req)
	if e != nil {
		r.reportError(RuntimeError{Operation: "identify_user", Err: e})
		bad(w, 401, "Failed to identify user")
		return
	}
	if !identifier(user.ID) || strings.TrimSpace(user.Name) == "" {
		bad(w, 400, "Invalid application identity")
		return
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) >= 3 && parts[0] == "agent" {
		agent := r.config.Agents[parts[1]]
		if agent == nil {
			bad(w, 404, "Agent not found")
			return
		}
		if req.Method != "POST" {
			bad(w, 405, "Method not allowed")
			return
		}
		body, e := decode(req)
		if parts[2] == "stop" && errors.Is(e, io.EOF) {
			body, e = map[string]any{}, nil
		}
		if e != nil {
			bad(w, 400, "Invalid JSON input")
			return
		}
		switch parts[2] {
		case "run":
			r.capture("oss.runtime.copilot_request_created", map[string]any{"requestType": "run", "cloud.guardrails.enabled": false, "cloud.api_key_provided": false})
			r.run(w, req, user, parts[1], agent, body)
			return
		case "connect":
			r.capture("oss.runtime.copilot_request_created", map[string]any{"requestType": "connect", "cloud.guardrails.enabled": false, "cloud.api_key_provided": false})
			r.connect(w, req, user, parts[1], body)
			return
		case "stop":
			if len(parts) != 4 {
				break
			}
			runID := ""
			if value, present := body["runId"]; present {
				var valid bool
				runID, valid = value.(string)
				if !valid || strings.TrimSpace(runID) == "" {
					bad(w, 400, "Invalid runId")
					return
				}
			}
			thread, err := r.platform(req.Context(), "GET", "/api/threads/"+url.PathEscape(parts[3])+"?userId="+url.QueryEscape(user.ID), nil, nil)
			if err != nil {
				status := statusOf(err)
				if status < 400 || status >= 500 {
					status = 502
				}
				bad(w, status, "Thread access denied")
				return
			}
			threadSummary := object(object(thread)["thread"])
			canonicalThread := str(threadSummary["id"])
			if strings.TrimSpace(canonicalThread) == "" {
				bad(w, 502, "Invalid thread response")
				return
			}
			if agentID, present := threadSummary["agentId"]; present && agentID != parts[1] {
				bad(w, 403, "Thread access denied")
				return
			}
			r.mu.Lock()
			active, ok := r.active[canonicalThread]
			r.mu.Unlock()
			stopped := ok && (runID == "" || runID == active.runID)
			if stopped {
				active.cancel()
			}
			reply(w, 200, map[string]any{"stopped": stopped})
			return
		}
	}
	r.rest(w, req, user, parts)
}
func (r *Runtime) info(w http.ResponseWriter, req *http.Request) {
	ent, e := r.intelligence.GetRuntimeEntitlements(req.Context())
	if e != nil {
		var failure *intelligence.RuntimeEntitlementError
		if errors.As(e, &failure) && !failure.Retryable {
			ent = &intelligence.RuntimeEntitlementResponse{Status: "misconfigured", Error: &intelligence.RuntimeEntitlementProblem{Code: "runtime_entitlements_misconfigured", Message: "Runtime entitlement lookup is misconfigured", Retryable: false}}
		} else {
			ent = &intelligence.RuntimeEntitlementResponse{Status: "unavailable", Error: &intelligence.RuntimeEntitlementProblem{Code: "runtime_entitlements_unavailable", Message: "Runtime entitlement lookup failed", Retryable: true}}
		}
	}
	licenseStatus := "none"
	if ent.Entitlement != nil && ent.Entitlement.Active {
		licenseStatus = "valid"
	} else if ent.Error != nil && ent.Error.Retryable {
		licenseStatus = "unknown"
	}
	agents := map[string]any{}
	for id, agent := range r.config.Agents {
		description := ""
		if described, ok := agent.(DescribedAgent); ok {
			description = described.Description()
		}
		agents[id] = map[string]any{"name": id, "description": description, "className": "Agent"}
	}
	info := map[string]any{"version": "0.1.0", "mode": "intelligence", "agents": agents, "intelligence": map[string]any{"wsUrl": r.config.ClientURL}, "runtimeEntitlements": ent, "threadEndpoints": map[string]any{"list": true, "inspect": true, "mutations": true, "realtimeMetadata": true}, "a2uiEnabled": r.config.A2UI != nil && (r.config.A2UI.Enabled == nil || *r.config.A2UI.Enabled), "audioFileTranscriptionEnabled": false, "openGenerativeUIEnabled": false, "telemetryDisabled": r.config.TelemetryDisabled}
	info["telemetryDisabled"] = r.telemetry.disabled
	info["inspectorMetadata"] = true
	info["licenseStatus"] = licenseStatus
	if info["a2uiEnabled"] == true {
		a2ui := map[string]any{"enabled": true}
		if len(r.config.A2UI.Agents) > 0 {
			a2ui["agents"] = r.config.A2UI.Agents
		}
		info["a2ui"] = a2ui
	}
	reply(w, 200, info)
}

// inspectorMetadata exposes project display data, never browser credentials or shared cache entries.
func (r *Runtime) inspectorMetadata(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	metadata, err := r.intelligence.GetInspectorMetadata(req.Context())
	if err != nil {
		r.reportError(RuntimeError{Operation: "inspector.metadata", Err: err})
	}
	if err != nil || metadata == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(metadata)
}

func (r *Runtime) connect(w http.ResponseWriter, req *http.Request, u User, id string, b map[string]any) {
	thread := str(b["threadId"])
	if !identifier(thread) {
		bad(w, 400, "Invalid threadId")
		return
	}
	v, e := r.platform(req.Context(), "POST", "/api/threads/"+url.PathEscape(thread)+"/connect", map[string]any{"userId": u.ID, "agentId": id}, nil)
	if e != nil {
		bad(w, statusOf(e), e.Error())
		return
	}
	if v == nil {
		reply(w, 204, nil)
		return
	}
	m := object(v)
	reply(w, 200, map[string]any{"threadId": m["threadId"], "joinToken": m["joinToken"], "realtime": r.realtime(str(m["threadId"]))})
}
func (r *Runtime) realtime(thread string) map[string]any {
	return map[string]any{"clientUrl": r.config.ClientURL, "topic": "thread:" + thread}
}
