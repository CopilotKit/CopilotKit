package intelligence_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/CopilotKit/CopilotKit/packages/runtime-go/intelligence"
)

func TestMemorySDKWithoutRuntime(t *testing.T) {
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls = append(calls, r.Method+" "+r.URL.EscapedPath())
		if r.Header.Get("Authorization") != "Bearer secret" || r.Header.Get("X-Cpki-User-Id") != "customer" {
			t.Error("missing trusted identity")
		}
		if r.Method == "GET" && len(body) != 0 {
			t.Error("GET must not carry JSON null")
		}
		if len(calls) == 1 && r.Header.Get("X-Cpki-Memory-Grant") != `{"user":"read-write","project":"read"}` {
			t.Error("grant changed")
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"memories":[{"id":"memory","content":"Python","kind":"topical","scope":"user"}]}`)
	}))
	defer server.Close()
	client, err := intelligence.New(intelligence.Config{APIKey: "secret", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.ListMemories(context.Background(), intelligence.ListMemoriesParams{UserID: "customer", Grant: &intelligence.MemoryGrant{User: intelligence.ReadWrite, Project: intelligence.Read}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Memories) != 1 || result.Memories[0].Content != "Python" {
		t.Fatalf("unexpected memories: %+v", result)
	}
	if len(calls) != 1 {
		t.Fatalf("unexpected request count: %d", len(calls))
	}
}

func TestSDKThreadCreationAssignsLearningContainer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/api/threads" || body["learningContainerId"] != "support-quality" || body["userId"] != "customer" {
			t.Errorf("wrong request: %v", body)
		}
		io.WriteString(w, `{"thread":{"id":"canonical","name":"Support"}}`)
	}))
	defer server.Close()
	client, err := intelligence.New(intelligence.Config{APIKey: "secret", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	thread, err := client.CreateThread(context.Background(), intelligence.CreateThreadParams{ThreadID: "thread", UserID: "customer", AgentID: "support", LearningContainerID: "support-quality"})
	if err != nil {
		t.Fatal(err)
	}
	if thread.ID != "canonical" {
		t.Fatalf("canonical ID lost: %+v", thread)
	}
}

func TestSDKPreservesStatusAndRejectsRedirects(t *testing.T) {
	for _, status := range []int{307, 401, 403, 404, 429, 500, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				w.Header().Set("Location", "https://untrusted.example")
				w.WriteHeader(status)
				io.WriteString(w, "private credential")
			}))
			defer server.Close()
			client, err := intelligence.New(intelligence.Config{APIKey: "secret", APIURL: server.URL})
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.ListMemories(context.Background(), intelligence.ListMemoriesParams{UserID: "customer"})
			var platformError *intelligence.Error
			if !errors.As(err, &platformError) || platformError.Status != status {
				t.Fatalf("wrong error: %v", err)
			}
			if strings.Contains(err.Error(), "private credential") || requests != 1 {
				t.Fatal("unsafe error or retry")
			}
		})
	}
}

func TestSDKCancellationPropagates(t *testing.T) {
	client, err := intelligence.New(intelligence.Config{APIKey: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = client.ListMemories(ctx, intelligence.ListMemoriesParams{UserID: "customer"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
}

func TestSDKGetOrCreateHandlesConcurrentCreation(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch calls {
		case 1:
			w.WriteHeader(404)
		case 2:
			w.WriteHeader(409)
		default:
			if r.URL.Query().Get("userId") != "user" {
				t.Error("race read lost scope")
			}
			io.WriteString(w, `{"thread":{"id":"existing"}}`)
		}
	}))
	defer server.Close()
	client, err := intelligence.New(intelligence.Config{APIKey: "secret", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	thread, created, err := client.GetOrCreateThread(context.Background(), intelligence.CreateThreadParams{ThreadID: "thread", UserID: "user", AgentID: "agent"})
	if err != nil || created || thread.ID != "existing" || calls != 3 {
		t.Fatalf("wrong race result: %+v %v %v calls=%d", thread, created, err, calls)
	}
}

func TestSDKResourceMethods(t *testing.T) {
	tests := []struct {
		name, method, path string
		call               func(context.Context, *intelligence.Client) error
	}{
		{"create memory", "POST", "/api/memories", func(ctx context.Context, c *intelligence.Client) error {
			_, err := c.CreateMemory(ctx, intelligence.SaveMemoryParams{UserID: "user", Content: "Fact", Kind: "topical"})
			return err
		}},
		{"update memory", "PATCH", "/api/memories/id%2Fwith%20space", func(ctx context.Context, c *intelligence.Client) error {
			_, err := c.UpdateMemory(ctx, "id/with space", intelligence.SaveMemoryParams{UserID: "user", Content: "New fact", Kind: "topical"})
			return err
		}},
		{"remove memory", "DELETE", "/api/memories/id%2Fwith%20space", func(ctx context.Context, c *intelligence.Client) error {
			return c.RemoveMemory(ctx, "id/with space", "user", nil)
		}},
		{"recall", "POST", "/api/memories/recall", func(ctx context.Context, c *intelligence.Client) error {
			_, err := c.RecallMemories(ctx, intelligence.RecallMemoriesParams{UserID: "user", Query: "Fact", Limit: 3, Scope: "project"})
			return err
		}},
		{"list threads", "GET", "/api/threads", func(ctx context.Context, c *intelligence.Client) error {
			_, err := c.ListThreads(ctx, intelligence.ListThreadsParams{UserID: "user", AgentID: "agent", Cursor: "opaque", Limit: 4})
			return err
		}},
		{"update thread", "PATCH", "/api/threads/thread", func(ctx context.Context, c *intelligence.Client) error {
			_, err := c.UpdateThread(ctx, "thread", "user", "agent", map[string]any{"name": "Name", "userId": "spoofed"})
			return err
		}},
		{"archive", "PATCH", "/api/threads/thread", func(ctx context.Context, c *intelligence.Client) error {
			return c.ArchiveThread(ctx, "thread", "user", "agent")
		}},
		{"delete", "DELETE", "/api/threads/thread", func(ctx context.Context, c *intelligence.Client) error {
			return c.DeleteThread(ctx, "thread", "user", "agent")
		}},
		{"messages", "GET", "/api/threads/thread/messages", func(ctx context.Context, c *intelligence.Client) error {
			_, err := c.GetThreadMessages(ctx, "thread", "user")
			return err
		}},
		{"events", "GET", "/api/_inspect/threads/thread/events", func(ctx context.Context, c *intelligence.Client) error {
			_, err := c.GetThreadEvents(ctx, "thread")
			return err
		}},
		{"state", "GET", "/api/_inspect/threads/thread/state", func(ctx context.Context, c *intelligence.Client) error {
			_, err := c.GetThreadState(ctx, "thread")
			return err
		}},
		{"annotation", "PUT", "/connector/annotate/event%2Fid", func(ctx context.Context, c *intelligence.Client) error {
			_, err := c.Annotate(ctx, intelligence.AnnotationParams{UserID: "user", ThreadID: "thread", Type: "user_action", ClientEventID: "event/id", Payload: map[string]any{"action": "save"}})
			return err
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != test.method || r.URL.EscapedPath() != test.path {
					t.Errorf("wrong route: %s %s", r.Method, r.URL.EscapedPath())
				}
				body, _ := io.ReadAll(r.Body)
				if r.Method == "GET" && len(body) != 0 {
					t.Error("GET body is not empty")
				}
				if test.name == "update thread" {
					var values map[string]any
					json.Unmarshal(body, &values)
					if values["userId"] != "user" {
						t.Error("updates replaced trusted identity")
					}
				}
				if test.name == "create memory" && !strings.Contains(string(body), `"sourceThreadIds":[]`) {
					t.Error("source IDs must default to an empty array")
				}
				if test.name == "list threads" && (r.URL.Query().Get("cursor") != "opaque" || r.URL.Query().Get("limit") != "4") {
					t.Error("pagination lost")
				}
				io.WriteString(w, `{"thread":{"id":"thread"},"id":"memory","memories":[],"threads":[],"nextCursor":"next"}`)
			}))
			defer server.Close()
			client, err := intelligence.New(intelligence.Config{APIKey: "secret", APIURL: server.URL})
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			if err = test.call(context.Background(), client); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSDKInvalidGrantsFailBeforeNetwork(t *testing.T) {
	client, err := intelligence.New(intelligence.Config{APIKey: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, err = client.ListMemories(context.Background(), intelligence.ListMemoriesParams{UserID: "user", Grant: &intelligence.MemoryGrant{User: "admin", Project: intelligence.Read}})
	if err == nil || !strings.Contains(err.Error(), "invalid memory grant") {
		t.Fatalf("invalid grant accepted: %v", err)
	}
}

func TestSDKTransportRejectsNonPathTargets(t *testing.T) {
	client, err := intelligence.New(intelligence.Config{APIKey: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, err = client.Request(context.Background(), "GET", "@untrusted.example/api", nil, nil)
	var platformError *intelligence.Error
	if !errors.As(err, &platformError) || platformError.Status != 400 {
		t.Fatalf("invalid path was not rejected: %v", err)
	}
}
