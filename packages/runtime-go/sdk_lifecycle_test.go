package runtime

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/CopilotKit/CopilotKit/packages/runtime-go/intelligence"
)

func TestRuntimeMutationsNotifySharedSDK(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["userId"] != "trusted" {
			t.Errorf("untrusted identity: %v", body)
		}
		io.WriteString(w, `{"thread":{"id":"canonical"}}`)
	}))
	defer server.Close()
	sdk, err := intelligence.New(intelligence.Config{APIKey: "key", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer sdk.Close()
	var seen []string
	var deleted intelligence.ThreadDeletedPayload
	sdk.OnThreadUpdated(func(thread intelligence.Thread) { seen = append(seen, thread.ID) })
	sdk.OnThreadDeleted(func(event intelligence.ThreadDeletedPayload) { deleted = event; seen = append(seen, "deleted") })
	runtime, err := New(Config{Intelligence: sdk, TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "trusted", Name: "Customer"}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()

	for _, operation := range [][2]string{{"PATCH", "/copilotkit/threads/thread"}, {"POST", "/copilotkit/threads/thread/archive"}, {"DELETE", "/copilotkit/threads/thread"}} {
		response := httptest.NewRecorder()
		runtime.ServeHTTP(response, httptest.NewRequest(operation[0], operation[1], strings.NewReader(`{"agentId":"agent","userId":"spoof","name":"New"}`)))
		if response.Code != 200 {
			t.Fatalf("mutation failed: %d %s", response.Code, response.Body.String())
		}
	}

	if !reflect.DeepEqual(seen, []string{"canonical", "canonical", "deleted"}) {
		t.Fatalf("unexpected notifications: %v", seen)
	}
	if deleted != (intelligence.ThreadDeletedPayload{ThreadID: "thread", UserID: "trusted", AgentID: "agent"}) {
		t.Fatalf("wrong deletion scope: %+v", deleted)
	}
}

func TestRuntimeCreationNotifiesBeforeLaterLockFailure(t *testing.T) {
	creations := make(chan map[string]any, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.WriteHeader(404)
			return
		}
		if r.URL.Path == "/api/threads" {
			var created map[string]any
			if err := json.NewDecoder(r.Body).Decode(&created); err != nil {
				t.Error(err)
			}
			creations <- created
			io.WriteString(w, `{"thread":{"id":"canonical"}}`)
			return
		}
		w.WriteHeader(409)
	}))
	defer server.Close()
	sdk, err := intelligence.New(intelligence.Config{APIKey: "key", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer sdk.Close()
	var seen []string
	sdk.OnThreadCreated(func(thread intelligence.Thread) { seen = append(seen, thread.ID) })
	runtime, err := New(Config{Intelligence: sdk, TelemetryDisabled: true,
		IdentifyUser:      func(*http.Request) (User, error) { return User{ID: "trusted", Name: "Customer"}, nil },
		Agents:            map[string]Agent{"default": &HTTPAgent{URL: "http://127.0.0.1:1"}},
		LearningContainer: func(*http.Request, User, map[string]any) (string, error) { return "existing-container", nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()

	response := httptest.NewRecorder()
	runtime.ServeHTTP(response, httptest.NewRequest("POST", "/copilotkit/agent/default/run", strings.NewReader(`{"threadId":"thread","runId":"run","messages":[],"tools":[],"context":[],"state":{}}`)))

	if response.Code != 409 || !reflect.DeepEqual(seen, []string{"canonical"}) {
		t.Fatalf("creation notification lost: %d %v", response.Code, seen)
	}
	created := <-creations
	if created["learningContainerId"] != "existing-container" || created["userId"] != "trusted" {
		t.Fatalf("wrong creation scope: %v", created)
	}
}
