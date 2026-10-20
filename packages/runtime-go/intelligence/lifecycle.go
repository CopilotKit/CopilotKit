package intelligence

import (
	"encoding/json"
	"log"
	"net/url"
	"strings"
	"sync"
)

// ThreadDeletedPayload identifies a completed deletion and its explicit caller scope.
type ThreadDeletedPayload struct {
	ThreadID string `json:"threadId"`
	UserID   string `json:"userId"`
	AgentID  string `json:"agentId"`
}

// OnThreadCreated registers a synchronous listener and returns its unsubscribe function.
func (c *Client) OnThreadCreated(callback func(Thread)) func() { return c.created.subscribe(callback) }

// OnThreadUpdated registers a listener for updates and archives.
func (c *Client) OnThreadUpdated(callback func(Thread)) func() { return c.updated.subscribe(callback) }

// OnThreadDeleted registers a listener for completed deletions.
func (c *Client) OnThreadDeleted(callback func(ThreadDeletedPayload)) func() {
	return c.deleted.subscribe(callback)
}

type listener[T any] struct {
	id       uint64
	callback func(T)
}

type listeners[T any] struct {
	mu      sync.Mutex
	next    uint64
	entries []listener[T]
}

// subscribe assigns an independent registration ID; Go function values are not comparable.
func (l *listeners[T]) subscribe(callback func(T)) func() {
	if callback == nil {
		panic("Intelligence thread listener must not be nil")
	}
	l.mu.Lock()
	l.next++
	id := l.next
	l.entries = append(l.entries, listener[T]{id: id, callback: callback})
	l.mu.Unlock()
	return func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		for i, entry := range l.entries {
			if entry.id == id {
				copy(l.entries[i:], l.entries[i+1:])
				l.entries[len(l.entries)-1] = listener[T]{}
				l.entries = l.entries[:len(l.entries)-1]
				return
			}
		}
	}
}

// notify snapshots registration order, then invokes application code outside the mutex.
func (l *listeners[T]) notify(event string, payload T) {
	l.mu.Lock()
	entries := append([]listener[T](nil), l.entries...)
	l.mu.Unlock()
	for _, entry := range entries {
		func() {
			defer func() {
				if cause := recover(); cause != nil {
					log.Printf("Intelligence thread %s listener failed (%T)", event, cause)
				}
			}()
			entry.callback(payload)
		}()
	}
}

// notifyThreadMutation observes successful SDK and Runtime writes, excluding lock and subscription calls.
func (c *Client) notifyThreadMutation(method, path string, body, result []byte) {
	const prefix = "/api/threads/"
	target := strings.TrimPrefix(path, prefix)
	threadPath := target != path && target != "" && !strings.ContainsAny(target, "/?")
	if (method == "POST" && path == "/api/threads") || (method == "PATCH" && threadPath) {
		var envelope struct {
			Thread *Thread `json:"thread"`
		}
		if json.Unmarshal(result, &envelope) != nil || envelope.Thread == nil || strings.TrimSpace(envelope.Thread.ID) == "" {
			return
		}
		if method == "POST" {
			c.created.notify("created", *envelope.Thread)
		} else {
			c.updated.notify("updated", *envelope.Thread)
		}
	} else if method == "DELETE" && threadPath {
		var payload ThreadDeletedPayload
		if json.Unmarshal(body, &payload) != nil || payload.UserID == "" || payload.AgentID == "" {
			return
		}
		var err error
		payload.ThreadID, err = url.PathUnescape(target)
		if err == nil {
			c.deleted.notify("deleted", payload)
		}
	}
}
