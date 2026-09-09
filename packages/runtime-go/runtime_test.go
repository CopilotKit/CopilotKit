package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPAgentPreservesUnknownFieldsAndMultilineSSE(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte("data: {\"type\":\"ACTIVITY_SNAPSHOT\",\n" + "data: \"content\":{\"surface\":1}}\n\n"))
	}))
	defer server.Close()
	var events []Event
	err := (&HTTPAgent{URL: server.URL}).Run(context.Background(), map[string]any{}, func(e Event) error { events = append(events, e); return nil })
	if err != nil || len(events) != 1 || object(events[0]["content"])["surface"] != float64(1) {
		t.Fatalf("events=%v err=%v", events, err)
	}
}

func TestMemoryPolicyDefaultsToDeny(t *testing.T) {
	rt, err := New(Config{APIKey: "secret", TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "u", Name: "U"}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer rt.Close()
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("GET", "/copilotkit/memories", nil))
	if response.Code != 403 {
		t.Fatalf("status=%d", response.Code)
	}
}

func TestRejectsMissingCredentials(t *testing.T) {
	if _, err := New(Config{}); err == nil {
		t.Fatal("missing key accepted")
	}
}

func TestThreadIdentityCannotBeSpoofed(t *testing.T) {
	var got string
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.Query().Get("userId")
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Error("missing platform auth")
		}
		json.NewEncoder(w).Encode(map[string]any{"threads": []any{}})
	}))
	defer platform.Close()
	rt, err := New(Config{APIKey: "secret", APIURL: platform.URL, TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "trusted", Name: "Trusted"}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer rt.Close()
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("GET", "/copilotkit/threads?userId=attacker&agentId=default", nil))
	if response.Code != 200 || got != "trusted" {
		t.Fatalf("status %d identity %q", response.Code, got)
	}
}

func TestMalformedRunNeverCallsPlatform(t *testing.T) {
	rt, err := New(Config{APIKey: "secret", TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "u", Name: "U"}, nil }, Agents: map[string]Agent{"default": &HTTPAgent{URL: "http://127.0.0.1:1"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer rt.Close()
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("POST", "/copilotkit/agent/default/run", strings.NewReader(`{"threadId":"x"}`)))
	if response.Code != 400 {
		t.Fatalf("status %d", response.Code)
	}
}

func TestPrivatePlatformRoutesCannotBeProxied(t *testing.T) {
	calls := 0
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(204) }))
	defer platform.Close()
	rt, err := New(Config{APIKey: "secret", APIURL: platform.URL, TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "trusted", Name: "Trusted"}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer rt.Close()
	for _, path := range []string{"/threads/victim/lock", "/threads/victim/connect", "/threads/victim/unknown", "/memories/a/b"} {
		for _, method := range []string{"GET", "POST", "PATCH", "DELETE"} {
			response := httptest.NewRecorder()
			rt.ServeHTTP(response, httptest.NewRequest(method, "/copilotkit"+path, strings.NewReader(`{"runId":"victim-run"}`)))
			if response.Code != 404 {
				t.Errorf("%s %s: %d", method, path, response.Code)
			}
		}
	}
	if calls != 0 {
		t.Fatalf("private routes made %d platform calls", calls)
	}
}
