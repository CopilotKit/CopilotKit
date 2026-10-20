package runtime

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func stopFixture(t *testing.T, thread map[string]any, status int) (*Runtime, *atomic.Int32) {
	t.Helper()
	calls := &atomic.Int32{}
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		if req.Method != "GET" || req.URL.Query().Get("userId") != "trusted-user" {
			t.Error("stop ownership lookup did not use trusted identity")
		}
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]any{"thread": thread})
	}))
	t.Cleanup(platform.Close)
	rt, err := New(Config{APIKey: "secret", APIURL: platform.URL, TelemetryDisabled: true,
		IdentifyUser: func(*http.Request) (User, error) { return User{ID: "trusted-user", Name: "User"}, nil },
		Agents:       map[string]Agent{"default": &HTTPAgent{URL: "http://127.0.0.1:1"}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { rt.Close() })
	return rt, calls
}

func TestStopRejectsMalformedRunIDBeforeOwnershipLookup(t *testing.T) {
	for _, body := range []string{`{"runId":false}`, `{"runId":null}`, `{"runId":42}`, `{"runId":[]}`, `{"runId":""}`, `{"runId":" "}`} {
		t.Run(body, func(t *testing.T) {
			rt, calls := stopFixture(t, map[string]any{"id": "thread", "agentId": "default"}, 200)
			cancelled := false
			rt.active["thread"] = activeRun{runID: "active-run", cancel: func() { cancelled = true }}
			response := httptest.NewRecorder()
			rt.ServeHTTP(response, httptest.NewRequest("POST", "/copilotkit/agent/default/stop/thread", strings.NewReader(body)))
			if response.Code != 400 || cancelled || calls.Load() != 0 {
				t.Fatalf("status=%d cancelled=%v ownership calls=%d", response.Code, cancelled, calls.Load())
			}
		})
	}
}

func TestStopUsesCanonicalThreadAndRequestedRunID(t *testing.T) {
	rt, _ := stopFixture(t, map[string]any{"id": "canonical", "agentId": "default"}, 200)
	canonical, alias := false, false
	rt.active["canonical"] = activeRun{runID: "active-run", cancel: func() { canonical = true }}
	rt.active["alias"] = activeRun{runID: "active-run", cancel: func() { alias = true }}
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("POST", "/copilotkit/agent/default/stop/alias", strings.NewReader(`{"runId":"active-run"}`)))
	if response.Code != 200 || !canonical || alias {
		t.Fatalf("status=%d canonical=%v alias=%v", response.Code, canonical, alias)
	}
}

func TestStopRejectsThreadFromDifferentAgent(t *testing.T) {
	rt, _ := stopFixture(t, map[string]any{"id": "thread", "agentId": "other-agent"}, 200)
	cancelled := false
	rt.active["thread"] = activeRun{runID: "run", cancel: func() { cancelled = true }}
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("POST", "/copilotkit/agent/default/stop/thread", strings.NewReader(`{}`)))
	if response.Code != 403 || cancelled {
		t.Fatalf("status=%d cancelled=%v", response.Code, cancelled)
	}
}

func TestStopDeniesRevokedOwnershipBeforeActiveLookup(t *testing.T) {
	rt, _ := stopFixture(t, map[string]any{"id": "thread"}, 403)
	cancelled := false
	rt.active["thread"] = activeRun{runID: "run", cancel: func() { cancelled = true }}
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("POST", "/copilotkit/agent/default/stop/thread", strings.NewReader(`{}`)))
	if response.Code != 403 || cancelled {
		t.Fatalf("status=%d cancelled=%v", response.Code, cancelled)
	}
}

func TestStopRejectsMissingCanonicalThreadID(t *testing.T) {
	rt, _ := stopFixture(t, map[string]any{"agentId": "default"}, 200)
	cancelled := false
	rt.active["thread"] = activeRun{runID: "run", cancel: func() { cancelled = true }}
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("POST", "/copilotkit/agent/default/stop/thread", strings.NewReader(`{}`)))
	if response.Code != 502 || cancelled {
		t.Fatalf("status=%d cancelled=%v", response.Code, cancelled)
	}
}

func TestStopAllowsEmptyBodyAndOptionalRunID(t *testing.T) {
	rt, _ := stopFixture(t, map[string]any{"id": "thread", "agentId": "default"}, 200)
	cancelled := false
	rt.active["thread"] = activeRun{runID: "run", cancel: func() { cancelled = true }}
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("POST", "/copilotkit/agent/default/stop/thread", nil))
	if response.Code != 200 || !cancelled {
		t.Fatalf("status=%d cancelled=%v", response.Code, cancelled)
	}
}

func TestMemoryDeniedAndInvalidGrantsNeverReachPlatform(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		grant  MemoryGrant
		status int
	}{
		{"both-none", MemoryGrant{User: "none", Project: "none"}, 403},
		{"invalid-enum", MemoryGrant{User: "admin", Project: "read-write"}, 500},
		{"zero-value", MemoryGrant{}, 500},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			rt, calls := stopFixture(t, map[string]any{}, 200)
			rt.config.MemoryAccess = func(*http.Request, User) (MemoryGrant, error) { return scenario.grant, nil }
			response := httptest.NewRecorder()
			rt.ServeHTTP(response, httptest.NewRequest("GET", "/copilotkit/memories", nil))
			if response.Code != scenario.status || calls.Load() != 0 {
				t.Fatalf("status=%d calls=%d", response.Code, calls.Load())
			}
		})
	}
}

func TestStopCanonicalThreadStillRejectsStaleRun(t *testing.T) {
	rt, _ := stopFixture(t, map[string]any{"id": "canonical", "agentId": "default"}, 200)
	cancelled := false
	rt.active["canonical"] = activeRun{runID: "current", cancel: func() { cancelled = true }}
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("POST", "/copilotkit/agent/default/stop/alias", strings.NewReader(`{"runId":"stale"}`)))
	if response.Code != 200 || cancelled || !strings.Contains(response.Body.String(), `"stopped":false`) {
		t.Fatalf("status=%d cancelled=%v body=%s", response.Code, cancelled, response.Body.String())
	}
}

func TestMemoryPolicyErrorNeverDelegatesToPlatform(t *testing.T) {
	rt, calls := stopFixture(t, map[string]any{}, 200)
	rt.config.MemoryAccess = func(*http.Request, User) (MemoryGrant, error) {
		return MemoryGrant{}, errors.New("policy service unavailable")
	}
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("GET", "/copilotkit/memories", nil))
	if response.Code != 403 || calls.Load() != 0 {
		t.Fatalf("status=%d calls=%d", response.Code, calls.Load())
	}
}
