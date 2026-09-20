package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type lifecycleAgent func(context.Context, map[string]any, func(Event) error) error

func (agent lifecycleAgent) Run(ctx context.Context, input map[string]any, emit func(Event) error) error {
	return agent(ctx, input, emit)
}

func TestLockLossUnblocksPendingPublisherAndCancelsAgent(t *testing.T) {
	url := socketFixture(t, func(conn *websocket.Conn, frame []any) {
		if frame[3] != "event" {
			acknowledge(conn, frame)
		}
	})
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method == "PATCH" {
			w.WriteHeader(409)
			return
		}
		if request.Method == "DELETE" {
			w.WriteHeader(204)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"threadId": "thread", "runId": "run", "joinToken": "token", "messages": []any{}})
	}))
	t.Cleanup(platform.Close)
	finished := make(chan struct{})
	agent := lifecycleAgent(func(ctx context.Context, input map[string]any, emit func(Event) error) error {
		defer close(finished)
		return emit(Event{"type": "RUN_STARTED"})
	})
	rt, err := New(Config{APIKey: "secret", APIURL: platform.URL, RunnerURL: url, TelemetryDisabled: true,
		HeartbeatInterval: 20 * time.Millisecond, LockTTL: time.Second,
		IdentifyUser: func(*http.Request) (User, error) { return User{ID: "user", Name: "User"}, nil }, Agents: map[string]Agent{"default": agent}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { rt.Close() })
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("POST", "/copilotkit/agent/default/run", strings.NewReader(`{"threadId":"thread","runId":"run","messages":[]}`)))
	if response.Code != 200 {
		t.Fatalf("start status %d", response.Code)
	}

	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("lease loss left the agent blocked on a stale publisher")
	}
}

func TestRuntimeCloseHasDeadlineForNonCooperativeAgent(t *testing.T) {
	rt, err := New(Config{APIKey: "secret", TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "user", Name: "User"}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	release := make(chan struct{})
	rt.wg.Add(1)
	go func() { defer rt.wg.Done(); <-release }()
	t.Cleanup(func() { close(release) })
	closed := make(chan error, 1)
	go func() { closed <- rt.Close() }()

	select {
	case err := <-closed:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected shutdown deadline, got %v", err)
		}
	case <-time.After(11 * time.Second):
		t.Fatal("Close waited forever for a non-cooperative agent")
	}
}

func TestStartupRenewsLeaseWhileHistoryIsPending(t *testing.T) {
	renewed := make(chan struct{}, 1)
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method == "PATCH" {
			renewed <- struct{}{}
			w.WriteHeader(409)
			return
		}
		if strings.Contains(request.URL.Path, "/messages") {
			<-request.Context().Done()
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"threadId": "thread", "runId": "run", "joinToken": "token"})
	}))
	t.Cleanup(platform.Close)
	rt, err := New(Config{APIKey: "secret", APIURL: platform.URL, TelemetryDisabled: true, HeartbeatInterval: 20 * time.Millisecond, LockTTL: time.Second, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "user", Name: "User"}, nil }, Agents: map[string]Agent{"default": lifecycleAgent(func(context.Context, map[string]any, func(Event) error) error {
		t.Error("agent started without lease")
		return nil
	})}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { rt.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		rt.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/copilotkit/agent/default/run", strings.NewReader(`{"threadId":"thread","runId":"run","messages":[]}`)).WithContext(ctx))
	}()
	select {
	case <-renewed:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("history startup did not renew its acquired lease")
	}
	select {
	case <-done:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("lease loss did not cancel startup history")
	}
}

func TestPermanentIdleGatewayFailureCancelsAgent(t *testing.T) {
	var joins atomic.Int32
	agentStarted := make(chan struct{})
	url := socketFixture(t, func(conn *websocket.Conn, frame []any) {
		if frame[3] != "phx_join" {
			acknowledge(conn, frame)
			return
		}
		if joins.Add(1) == 1 {
			acknowledge(conn, frame)
			<-agentStarted
			conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(1012, "restart"), time.Now().Add(time.Second))
		} else {
			conn.WriteJSON([]any{frame[0], frame[1], frame[2], "phx_reply", map[string]any{"status": "error", "response": map[string]any{"retryable": false}}})
		}
	})
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"threadId": "thread", "runId": "run", "joinToken": "token", "messages": []any{}})
	}))
	t.Cleanup(platform.Close)
	finished := make(chan struct{})
	rt, err := New(Config{APIKey: "secret", APIURL: platform.URL, RunnerURL: url, TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "user", Name: "User"}, nil }, Agents: map[string]Agent{"default": lifecycleAgent(func(ctx context.Context, _ map[string]any, _ func(Event) error) error {
		close(agentStarted)
		<-ctx.Done()
		close(finished)
		return ctx.Err()
	})}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { rt.Close() })
	rt.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/copilotkit/agent/default/run", strings.NewReader(`{"threadId":"thread","runId":"run","messages":[]}`)))
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("permanent idle gateway failure left agent running")
	}
}

func TestStopBeforeJoinAcknowledgementPreventsInitialAgentSideEffect(t *testing.T) {
	terminal := make(chan Event, 1)
	url := socketFixture(t, func(conn *websocket.Conn, frame []any) {
		if frame[3] == "phx_join" {
			conn.WriteJSON([]any{frame[0], nil, frame[2], "ag-ui", map[string]any{"type": "CUSTOM", "name": "stop"}})
		}
		if frame[3] == "event" && str(object(frame[4])["type"]) == "RUN_FINISHED" {
			terminal <- Event(object(frame[4]))
		}
		acknowledge(conn, frame)
	})
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"threadId": "thread", "runId": "run", "joinToken": "token", "messages": []any{}})
	}))
	t.Cleanup(platform.Close)
	var calls atomic.Int32
	rt, err := New(Config{APIKey: "secret", APIURL: platform.URL, RunnerURL: url, TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "user", Name: "User"}, nil }, Agents: map[string]Agent{"default": lifecycleAgent(func(context.Context, map[string]any, func(Event) error) error { calls.Add(1); return nil })}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { rt.Close() })
	rt.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/copilotkit/agent/default/run", strings.NewReader(`{"threadId":"thread","runId":"run","messages":[]}`)))
	select {
	case <-terminal:
	case <-time.After(time.Second):
		t.Fatal("early stop did not finalize")
	}
	if calls.Load() != 0 {
		t.Fatal("agent ran after authoritative startup stop")
	}
}
