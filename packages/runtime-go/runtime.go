// Package runtime mounts native Intelligence-only CopilotKit HTTP APIs.
package runtime

import (
	"bytes"
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

// MemoryGrant controls access; the default denies both scopes.
type MemoryGrant struct {
	User    string `json:"user"`
	Project string `json:"project"`
}

// Config contains host-controlled credentials, transports, agents and policies.
type Config struct {
	APIKey, APIURL, RunnerURL, ClientURL, BasePath string
	IdentifyUser                                   func(*http.Request) (User, error)
	Agents                                         map[string]Agent
	HTTPClient                                     *http.Client
	MemoryAccess                                   func(*http.Request, User) (MemoryGrant, error)
	LearningContainer                              func(*http.Request, User, map[string]any) (string, error)
	TelemetryURL, TelemetryID                      string
	TelemetryDisabled                              bool
	AllowedOrigins                                 []string
	LockTTL, HeartbeatInterval                     time.Duration
}
type activeRun struct {
	cancel context.CancelFunc
	runID  string
}

// Runtime implements http.Handler. Close drains its background work.
type Runtime struct {
	config Config
	client *http.Client
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	active map[string]activeRun
	wg     sync.WaitGroup
}

// New validates configuration before accepting requests.
func New(c Config) (*Runtime, error) {
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
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	c.Agents = cloneAgents(c.Agents)
	ctx, cancel := context.WithCancel(context.Background())
	r := &Runtime{config: c, client: client, ctx: ctx, cancel: cancel, active: map[string]activeRun{}}
	r.capture("oss.runtime.instance_created", map[string]any{"agentsAmount": len(c.Agents)})
	return r, nil
}
func cloneAgents(m map[string]Agent) map[string]Agent {
	n := map[string]Agent{}
	for k, v := range m {
		n[k] = v
	}
	return n
}

// Close cancels running agents and waits for event publishers and telemetry.
func (r *Runtime) Close() error { r.cancel(); r.wg.Wait(); return nil }

type platformError struct{ status int }

func (e platformError) Error() string { return "Intelligence platform request failed" }
func (r *Runtime) platform(ctx context.Context, method, path string, body any, headers map[string]string) (any, error) {
	var reader io.Reader
	if body != nil {
		b, e := json.Marshal(body)
		if e != nil {
			return nil, e
		}
		reader = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, method, strings.TrimRight(r.config.APIURL, "/")+path, reader)
	if e != nil {
		return nil, e
	}
	req.Header.Set("Authorization", "Bearer "+r.config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, e := r.client.Do(req)
	if e != nil {
		return nil, e
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil, platformError{res.StatusCode}
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, 16<<20))
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
	if req.Method == "OPTIONS" {
		w.WriteHeader(204)
		return
	}
	path := strings.TrimPrefix(req.URL.Path, strings.TrimRight(r.config.BasePath, "/"))
	if path == req.URL.Path {
		bad(w, 404, "Not found")
		return
	}
	r.capture("oss.runtime.copilot_request_created", map[string]any{"requestType": req.Method})
	if path == "/info" {
		if req.Method != "GET" {
			bad(w, 405, "Method not allowed")
			return
		}
		r.info(w, req)
		return
	}
	user, e := r.config.IdentifyUser(req)
	if e != nil {
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
		if e != nil {
			bad(w, 400, "Invalid JSON input")
			return
		}
		switch parts[2] {
		case "run":
			r.run(w, req, user, parts[1], agent, body)
			return
		case "connect":
			r.connect(w, req, user, parts[1], body)
			return
		case "stop":
			if len(parts) != 4 {
				break
			}
			if _, err := r.platform(req.Context(), "GET", "/api/threads/"+url.PathEscape(parts[3])+"?userId="+url.QueryEscape(user.ID), nil, nil); err != nil {
				bad(w, statusOf(err), "Thread access denied")
				return
			}
			r.mu.Lock()
			active, ok := r.active[parts[3]]
			r.mu.Unlock()
			if ok && (str(body["runId"]) == "" || str(body["runId"]) == active.runID) {
				active.cancel()
			}
			reply(w, 200, map[string]any{"stopped": ok})
			return
		}
	}
	r.rest(w, req, user, parts)
}
func (r *Runtime) info(w http.ResponseWriter, req *http.Request) {
	ent, e := r.platform(req.Context(), "GET", "/api/entitlements/runtime", nil, nil)
	if e != nil {
		ent = map[string]any{"status": "unavailable", "error": map[string]any{"code": "PLATFORM_UNAVAILABLE", "message": "Intelligence unavailable", "retryable": true}}
	}
	agents := map[string]any{}
	for id := range r.config.Agents {
		agents[id] = map[string]any{"name": id, "description": "", "className": "Agent"}
	}
	reply(w, 200, map[string]any{"version": "0.1.0", "mode": "intelligence", "agents": agents, "intelligence": map[string]any{"wsUrl": r.config.ClientURL}, "runtimeEntitlements": ent, "threadEndpoints": map[string]any{"list": true, "inspect": true, "mutations": true, "realtimeMetadata": true}, "a2uiEnabled": false, "audioFileTranscriptionEnabled": false, "openGenerativeUIEnabled": false, "telemetryDisabled": r.config.TelemetryDisabled})
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
