package runtime

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// HTTPAgent streams AG-UI from a remote HTTP endpoint, preserving all extension events.
type HTTPAgent struct {
	URL             string
	Headers         map[string]string
	Client          *http.Client
	DescriptionText string
}

// Description returns the text exposed by runtime discovery.
func (a *HTTPAgent) Description() string { return a.DescriptionText }

// Run executes an AG-UI SSE request with bounded event frames and cancellation.
func (a *HTTPAgent) Run(ctx context.Context, input map[string]any, emit func(Event) error) error {
	data, e := json.Marshal(input)
	if e != nil {
		return e
	}
	req, e := http.NewRequestWithContext(ctx, "POST", a.URL, bytes.NewReader(data))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	for k, v := range a.Headers {
		req.Header.Set(k, v)
	}
	client := a.Client
	if client == nil {
		client = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	res, e := client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return errors.New("Agent HTTP request failed")
	}
	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 4096), 4<<20)
	var lines []string
	flush := func() error {
		if len(lines) == 0 {
			return nil
		}
		raw := strings.Join(lines, "\n")
		lines = nil
		if raw == "[DONE]" {
			return nil
		}
		var event Event
		if e := json.Unmarshal([]byte(raw), &event); e != nil {
			return errors.New("Invalid AG-UI event JSON")
		}
		if str(event["type"]) == "" {
			return errors.New("AG-UI event has no type")
		}
		return emit(event)
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if e := flush(); e != nil {
				return e
			}
		} else if strings.HasPrefix(line, "data:") {
			lines = append(lines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if e := scanner.Err(); e != nil {
		return e
	}
	return flush()
}
func (r *Runtime) run(w http.ResponseWriter, req *http.Request, u User, agentID string, agent Agent, input map[string]any) {
	ctx, cancelCause := context.WithCancelCause(r.ctx)
	cancel := func() { cancelCause(context.Canceled) }
	stop := func() { cancelCause(errUserStopped) }
	stopRequest := context.AfterFunc(req.Context(), cancel)
	defer stopRequest()
	transferred := false
	defer func() {
		if !transferred {
			cancel()
		}
	}()
	req = req.WithContext(ctx)
	thread, runID := str(input["threadId"]), str(input["runId"])
	if !identifier(thread) || !identifier(runID) {
		bad(w, 400, "Invalid threadId or runId")
		return
	}
	messages, ok := input["messages"].([]any)
	if !ok {
		bad(w, 400, "messages must be an array")
		return
	}
	for _, v := range messages {
		if !identifier(str(object(v)["id"])) || str(object(v)["role"]) == "" {
			bad(w, 400, "Invalid message")
			return
		}
	}
	a2ui := resolveA2UI(r.config.A2UI, agentID, object(input["forwardedProps"])["a2uiCatalogAvailable"] == true)
	if a2ui != nil {
		processA2UIAction(input)
		messages = input["messages"].([]any)
	}
	servers := []MCPServer{}
	if r.config.MCPApps != nil {
		for _, server := range r.config.MCPApps.Servers {
			if server.AgentID == "" || server.AgentID == agentID {
				servers = append(servers, server)
			}
		}
	}
	_, proxied := object(input["forwardedProps"])["__proxiedMCPRequest"]
	if a2ui != nil || len(servers) > 0 || proxied {
		agent = &uiAgent{next: agent, a2ui: a2ui, mcp: servers}
	}
	body := map[string]any{"threadId": thread, "runId": runID, "userId": u.ID, "agentId": agentID, "ttlSeconds": int(r.config.LockTTL.Seconds())}
	if r.config.LearningContainer != nil {
		container, e := r.config.LearningContainer(req, u, input)
		if e != nil {
			bad(w, 500, "Learning container resolution failed")
			return
		}
		if container != "" {
			body["learningContainerId"] = container
		}
	}
	path := "/api/threads/" + url.PathEscape(thread)
	_, e := r.platform(req.Context(), "GET", path+"?userId="+url.QueryEscape(u.ID), nil, nil)
	if e != nil {
		if statusOf(e) != 404 {
			bad(w, statusOf(e), e.Error())
			return
		}
		_, e = r.platform(req.Context(), "POST", "/api/threads", body, nil)
		if statusOf(e) == 409 {
			_, e = r.platform(req.Context(), "GET", path+"?userId="+url.QueryEscape(u.ID), nil, nil)
		}
		if e != nil {
			bad(w, statusOf(e), e.Error())
			return
		}
	}
	lock, e := r.platform(req.Context(), "POST", path+"/lock", body, nil)
	if e != nil {
		status := 502
		if statusOf(e) == 409 {
			status = 409
		}
		bad(w, status, "Thread lock denied")
		return
	}
	credentials := object(lock)
	canonicalThread, canonicalRun, token := str(credentials["threadId"]), str(credentials["runId"]), str(credentials["joinToken"])
	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		cleanupThread, cleanupRun := canonicalThread, canonicalRun
		if cleanupThread == "" {
			cleanupThread = thread
		}
		if cleanupRun == "" {
			cleanupRun = runID
		}
		r.platform(ctx, "DELETE", "/api/threads/"+url.PathEscape(cleanupThread)+"/lock", map[string]any{"runId": cleanupRun}, nil)
	}
	if !identifier(canonicalThread) || !identifier(canonicalRun) || token == "" {
		cleanup()
		bad(w, 502, "Missing run credentials")
		return
	}
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(r.config.HeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_, err := r.platform(ctx, "PATCH", "/api/threads/"+url.PathEscape(canonicalThread)+"/lock", map[string]any{"runId": canonicalRun, "ttlSeconds": int(r.config.LockTTL.Seconds())}, nil)
				if err != nil {
					cancelCause(errLockLost)
					return
				}
			}
		}
	}()
	defer func() {
		if !transferred {
			cancel()
			<-heartbeatDone
		}
	}()
	history, e := r.platform(req.Context(), "GET", "/api/threads/"+url.PathEscape(canonicalThread)+"/messages?userId="+url.QueryEscape(u.ID), nil, nil)
	if e != nil {
		cleanup()
		bad(w, 502, "Thread history lookup failed")
		return
	}
	seen := map[string]bool{}
	if old, ok := object(history)["messages"].([]any); ok {
		for _, v := range old {
			seen[str(object(v)["id"])] = true
		}
	}
	fresh := []any{}
	for _, m := range messages {
		if !seen[str(object(m)["id"])] {
			fresh = append(fresh, m)
		}
	}
	input["threadId"], input["runId"] = canonicalThread, canonicalRun
	publisherContext, cancelPublisher := context.WithCancel(r.ctx)
	stopPublisher := context.AfterFunc(ctx, func() {
		if !errors.Is(context.Cause(ctx), errUserStopped) {
			cancelPublisher()
		}
	})
	defer func() {
		if !transferred {
			stopPublisher()
			cancelPublisher()
		}
	}()
	pub, e := newPublisher(publisherContext, r.config.RunnerURL, r.config.APIKey, canonicalThread, canonicalRun, stop)
	if e != nil {
		cancel()
		cleanup()
		bad(w, 502, "Failed to start runner")
		return
	}
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		pub.close()
		cancel()
		cleanup()
		bad(w, 503, "Runtime shutting down")
		return
	}
	if _, exists := r.active[canonicalThread]; exists {
		r.mu.Unlock()
		pub.close()
		cancel()
		cleanup()
		bad(w, 409, "Thread already running")
		return
	}
	r.active[canonicalThread] = activeRun{cancel: stop, runID: canonicalRun}
	r.wg.Add(1)
	r.mu.Unlock()
	stopRequest()
	transferred = true
	go func() {
		select {
		case <-pub.done:
			cancelCause(errors.New("gateway connection permanently failed"))
		case <-ctx.Done():
		}
	}()
	go func() {
		defer r.wg.Done()
		defer cancel()
		defer pub.close()
		defer cancelPublisher()
		defer stopPublisher()
		defer func() { r.mu.Lock(); delete(r.active, canonicalThread); r.mu.Unlock() }()
		defer func() { cancel(); <-heartbeatDone }()
		r.capture("oss.runtime.agent_execution_stream_started", map[string]any{})
		started, terminal := false, false
		var finalizer eventFinalizer
		var deliveryError error
		emit := func(event Event) error {
			if terminal {
				return errors.New("event after terminal")
			}
			event["threadId"], event["runId"] = canonicalThread, canonicalRun
			if str(event["type"]) == "RUN_STARTED" {
				if started {
					return errors.New("duplicate RUN_STARTED")
				}
				started = true
				copyInput := map[string]any{}
				base := input
				if source, ok := event["input"].(map[string]any); ok {
					base = source
				}
				for k, v := range base {
					copyInput[k] = v
				}
				copyInput["messages"] = fresh
				event["input"] = copyInput
			}
			if !started {
				return errors.New("event before RUN_STARTED")
			}
			if e := pub.publish(event); e != nil {
				deliveryError = e
				return e
			}
			finalizer.observe(event)
			terminal = str(event["type"]) == "RUN_FINISHED" || str(event["type"]) == "RUN_ERROR"
			return nil
		}
		e := ctx.Err()
		if e == nil {
			e = agent.Run(ctx, input, func(event Event) error {
				if !started && str(event["type"]) != "RUN_STARTED" {
					if err := emit(Event{"type": "RUN_STARTED"}); err != nil {
						return err
					}
				}
				return emit(event)
			})
		}
		if !started {
			if err := emit(Event{"type": "RUN_STARTED"}); err != nil {
				e = err
			}
		}
		cause := context.Cause(ctx)
		if cause == nil {
			cause = e
		}
		stopped := errors.Is(cause, errUserStopped)
		if deliveryError == nil {
			for _, event := range finalizer.finish(cause, stopped) {
				if err := emit(event); err != nil {
					e = err
					break
				}
			}
		}
		if stopped && deliveryError == nil {
			e = nil
		}
		streamCompleted := e == nil && deliveryError == nil
		if finalizer.failed && e == nil {
			e = errors.New("agent emitted RUN_ERROR")
		}
		if deliveryError != nil {
			e = deliveryError
		}
		if e != nil {
			cleanup()
			r.reportError(RuntimeError{Operation: "agent.run", AgentID: agentID, ThreadID: canonicalThread, RunID: canonicalRun, Err: e})
			r.capture("oss.runtime.agent_execution_stream_errored", map[string]any{"error": "AGENT_EXECUTION_FAILED"})
		}
		if streamCompleted {
			r.capture("oss.runtime.agent_execution_stream_ended", map[string]any{})
		}
	}()
	reply(w, 200, map[string]any{"threadId": canonicalThread, "runId": canonicalRun, "joinToken": token, "realtime": r.realtime(canonicalThread)})
}
