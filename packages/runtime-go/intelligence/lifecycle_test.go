package intelligence_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/CopilotKit/CopilotKit/packages/runtime-go/intelligence"
)

func lifecycleClient(t *testing.T, handler http.HandlerFunc) *intelligence.Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client, err := intelligence.New(intelligence.Config{APIKey: "key", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	return client
}

func TestLifecyclePayloadsAndUnsubscribe(t *testing.T) {
	client := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"thread":{"id":"canonical","name":"Title"}}`)
	})
	var seen []string
	var deleted intelligence.ThreadDeletedPayload
	unsubscribe := client.OnThreadCreated(func(thread intelligence.Thread) { seen = append(seen, "created:"+thread.ID) })
	client.OnThreadUpdated(func(thread intelligence.Thread) { seen = append(seen, "updated:"+thread.ID) })
	client.OnThreadDeleted(func(event intelligence.ThreadDeletedPayload) { deleted = event; seen = append(seen, "deleted") })
	ctx := context.Background()

	if _, err := client.CreateThread(ctx, intelligence.CreateThreadParams{ThreadID: "thread", UserID: "user", AgentID: "agent"}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UpdateThread(ctx, "thread", "user", "agent", map[string]any{"name": "New"}); err != nil {
		t.Fatal(err)
	}
	if err := client.ArchiveThread(ctx, "thread", "user", "agent"); err != nil {
		t.Fatal(err)
	}
	if err := client.DeleteThread(ctx, "thread/id+space", "user", "agent"); err != nil {
		t.Fatal(err)
	}
	unsubscribe()
	unsubscribe()
	if _, err := client.CreateThread(ctx, intelligence.CreateThreadParams{ThreadID: "other", UserID: "user", AgentID: "agent"}); err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(seen, []string{"created:canonical", "updated:canonical", "updated:canonical", "deleted"}) {
		t.Fatalf("unexpected events: %v", seen)
	}
	if deleted != (intelligence.ThreadDeletedPayload{ThreadID: "thread/id+space", UserID: "user", AgentID: "agent"}) {
		t.Fatalf("wrong deletion scope: %+v", deleted)
	}
}

func TestLifecyclePanicAndSelfUnsubscribe(t *testing.T) {
	client := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{"thread":{"id":"thread"}}`) })
	client.OnThreadCreated(func(intelligence.Thread) { panic("private application error") })
	count := 0
	var unsubscribe func()
	unsubscribe = client.OnThreadCreated(func(intelligence.Thread) { count++; unsubscribe() })

	for i := 0; i < 2; i++ {
		thread, err := client.CreateThread(context.Background(), intelligence.CreateThreadParams{ThreadID: "thread", UserID: "user", AgentID: "agent"})
		if err != nil || thread.ID != "thread" {
			t.Fatalf("listener replaced successful response: %v", err)
		}
	}

	if count != 1 {
		t.Fatalf("self unsubscribe or failure isolation failed: %d", count)
	}
}

func TestCreationNotificationsDistinguishConflicts(t *testing.T) {
	for _, statuses := range [][]int{{200}, {404, 200}, {404, 409, 200}} {
		calls := 0
		client := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(statuses[calls])
			calls++
			io.WriteString(w, `{"thread":{"id":"thread"}}`)
		})
		count := 0
		client.OnThreadCreated(func(intelligence.Thread) { count++ })

		_, created, err := client.GetOrCreateThread(context.Background(), intelligence.CreateThreadParams{ThreadID: "thread", UserID: "user", AgentID: "agent"})

		if err != nil {
			t.Fatal(err)
		}
		expected := 0
		if len(statuses) == 2 {
			expected = 1
		}
		if count != expected || created != (expected == 1) {
			t.Fatalf("wrong notification for %v: %d %v", statuses, count, created)
		}
	}
}

func TestUnrelatedAndFailedWritesDoNotNotify(t *testing.T) {
	for _, status := range []int{200, 403, 409, 503} {
		client := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			io.WriteString(w, `{"thread":{"id":"thread"}}`)
		})
		count := 0
		client.OnThreadCreated(func(intelligence.Thread) { count++ })
		client.OnThreadUpdated(func(intelligence.Thread) { count++ })
		client.OnThreadDeleted(func(intelligence.ThreadDeletedPayload) { count++ })
		operations := [][2]string{{"POST", "/api/threads/subscribe"}, {"PATCH", "/api/threads/thread/lock"}, {"DELETE", "/api/threads/thread/lock"}, {"GET", "/api/threads/thread"}, {"POST", "/api/memories"}}
		if status != 200 {
			operations = append(operations, [2]string{"POST", "/api/threads"}, [2]string{"PATCH", "/api/threads/thread"}, [2]string{"DELETE", "/api/threads/thread"})
		}

		for _, operation := range operations {
			_, err := client.Request(context.Background(), operation[0], operation[1], map[string]any{"userId": "user", "agentId": "agent"}, nil)
			if (err == nil) != (status == 200) {
				t.Fatalf("unexpected status outcome: %v", err)
			}
		}

		if count != 0 {
			t.Fatalf("unexpected event: %d", count)
		}
	}
}

func TestConcurrentLifecycleRegistration(t *testing.T) {
	client := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{"thread":{"id":"thread"}}`) })
	var count atomic.Int64
	var workers sync.WaitGroup
	for i := 0; i < 8; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			unsubscribe := client.OnThreadCreated(func(intelligence.Thread) { count.Add(1) })
			unsubscribe()
			unsubscribe()
		}()
	}
	workers.Wait()
	client.OnThreadCreated(func(intelligence.Thread) { count.Add(1) })

	for i := 0; i < 8; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			_, err := client.CreateThread(context.Background(), intelligence.CreateThreadParams{ThreadID: "thread", UserID: "user", AgentID: "agent"})
			if err != nil {
				t.Error(err)
			}
		}()
	}
	workers.Wait()

	if count.Load() != 8 {
		t.Fatalf("unexpected concurrent notifications: %d", count.Load())
	}
}

func TestMalformedThreadMutationDoesNotNotify(t *testing.T) {
	for _, body := range []string{"null", "[]", "{}", `{"thread":{}}`, `{"thread":{"id":3}}`} {
		client := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, body) })
		count := 0
		client.OnThreadCreated(func(intelligence.Thread) { count++ })

		_, err := client.CreateThread(context.Background(), intelligence.CreateThreadParams{ThreadID: "thread", UserID: "user", AgentID: "agent"})

		if err == nil || count != 0 {
			t.Fatalf("invalid response notified success: %q %v %d", body, err, count)
		}
	}
}
