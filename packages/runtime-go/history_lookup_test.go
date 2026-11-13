package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const historyLookupRunBody = `{"threadId":"thread","runId":"run","messages":[{"id":"msg-existing","role":"user","content":"First turn"},{"id":"msg-new","role":"user","content":"Second turn"}]}`

func TestHistoryLookupRequestsOnlyMessageIDs(t *testing.T) {
	for name, history := range map[string][]any{
		"ids only": {map[string]any{"id": "msg-existing"}},
		"full transcript from a server that ignores fields": {
			map[string]any{"id": "msg-existing", "role": "user", "content": "First turn"},
			map[string]any{"id": "msg-reply", "role": "assistant", "content": "Reply"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			queries := make(chan url.Values, 1)
			started := make(chan Event, 1)
			socket := socketFixture(t, func(conn *websocket.Conn, frame []any) {
				if frame[3] == "event" && str(object(frame[4])["type"]) == "RUN_STARTED" {
					started <- Event(object(frame[4]))
				}
				acknowledge(conn, frame)
			})
			platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if strings.HasSuffix(req.URL.Path, "/messages") {
					queries <- req.URL.Query()
					json.NewEncoder(w).Encode(map[string]any{"messages": history})
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"threadId": "thread", "runId": "run", "joinToken": "token"})
			}))
			t.Cleanup(platform.Close)
			rt, err := New(Config{APIKey: "secret", APIURL: platform.URL, RunnerURL: socket, TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "user", Name: "User"}, nil }, Agents: map[string]Agent{"default": lifecycleAgent(func(_ context.Context, _ map[string]any, emit func(Event) error) error {
				if err := emit(Event{"type": "RUN_STARTED"}); err != nil {
					return err
				}
				return emit(Event{"type": "RUN_FINISHED"})
			})}})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { rt.Close() })

			recorder := httptest.NewRecorder()
			rt.ServeHTTP(recorder, httptest.NewRequest("POST", "/copilotkit/agent/default/run", strings.NewReader(historyLookupRunBody)))
			if recorder.Code != 200 {
				t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
			}

			select {
			case query := <-queries:
				if query.Get("fields") != "id" || query.Get("userId") != "user" {
					t.Fatalf("unexpected history query: %v", query)
				}
			case <-time.After(time.Second):
				t.Fatal("history was not requested")
			}
			select {
			case event := <-started:
				messages, _ := object(event["input"])["messages"].([]any)
				if len(messages) != 1 || str(object(messages[0])["id"]) != "msg-new" {
					t.Fatalf("expected only the unseen input message, got %v", messages)
				}
			case <-time.After(time.Second):
				t.Fatal("run did not start")
			}
		})
	}
}

func TestHistoryLookupFailureReturns502AndReleasesLock(t *testing.T) {
	released := make(chan struct{}, 1)
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if strings.HasSuffix(req.URL.Path, "/messages") {
			w.WriteHeader(500)
			return
		}
		if req.Method == "DELETE" && strings.HasSuffix(req.URL.Path, "/lock") {
			released <- struct{}{}
			w.WriteHeader(204)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"threadId": "thread", "runId": "run", "joinToken": "token"})
	}))
	t.Cleanup(platform.Close)
	rt, err := New(Config{APIKey: "secret", APIURL: platform.URL, TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "user", Name: "User"}, nil }, Agents: map[string]Agent{"default": lifecycleAgent(func(context.Context, map[string]any, func(Event) error) error {
		t.Error("agent started after failed history lookup")
		return nil
	})}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { rt.Close() })

	recorder := httptest.NewRecorder()
	rt.ServeHTTP(recorder, httptest.NewRequest("POST", "/copilotkit/agent/default/run", strings.NewReader(historyLookupRunBody)))
	if recorder.Code != 502 || !strings.Contains(recorder.Body.String(), "Thread history lookup failed") {
		t.Fatalf("expected 502 history failure, got %d: %s", recorder.Code, recorder.Body.String())
	}
	select {
	case <-released:
	case <-time.After(time.Second):
		t.Fatal("thread lock was not released")
	}
}
