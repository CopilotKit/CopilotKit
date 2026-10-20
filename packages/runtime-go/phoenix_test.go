package runtime

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// socketFixture exchanges real Phoenix frames with one callback per received frame.
func socketFixture(t *testing.T, handle func(*websocket.Conn, []any)) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{Subprotocols: []string{"phoenix"}}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			var frame []any
			if conn.ReadJSON(&frame) != nil {
				return
			}
			handle(conn, frame)
		}
	}))
	t.Cleanup(server.Close)
	return strings.Replace(server.URL, "http:", "ws:", 1) + "/runner"
}

// acknowledge mirrors the Phoenix reply reference and topic.
func acknowledge(conn *websocket.Conn, frame []any) {
	conn.WriteJSON([]any{frame[0], frame[1], frame[2], "phx_reply", map[string]any{"status": "ok", "response": map[string]any{}}})
}

func TestPublisherReceivesAuthoritativeGatewayStop(t *testing.T) {
	url := socketFixture(t, func(conn *websocket.Conn, frame []any) {
		acknowledge(conn, frame)
		if frame[3] == "phx_join" {
			conn.WriteJSON([]any{frame[0], nil, frame[2], "ag-ui", map[string]any{"type": "CUSTOM", "name": "stop"}})
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	p, err := newPublisher(context.Background(), url, "secret", "thread", "run", cancel)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.close)

	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("authoritative ag-ui stop did not cancel the agent")
	}
}

func TestPublisherHeartbeatsWhileAgentIsIdle(t *testing.T) {
	heartbeats := make(chan []any, 4)
	url := socketFixture(t, func(conn *websocket.Conn, frame []any) {
		acknowledge(conn, frame)
		if frame[3] == "heartbeat" {
			heartbeats <- frame
		}
	})
	p, err := newPublisherWithHeartbeat(context.Background(), url, "secret", "thread", "run", func() {}, 20*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.close)

	select {
	case frame := <-heartbeats:
		if frame[0] != nil || frame[2] != "phoenix" {
			t.Fatalf("invalid heartbeat scope: %v", frame)
		}
	case <-time.After(time.Second):
		t.Fatal("idle socket sent no Phoenix heartbeat")
	}
}

func TestPublisherHeartbeatDoesNotAcknowledgePendingEvent(t *testing.T) {
	heartbeat := make(chan struct{}, 1)
	url := socketFixture(t, func(conn *websocket.Conn, frame []any) {
		if frame[3] == "event" {
			return
		}
		acknowledge(conn, frame)
		if frame[3] == "heartbeat" {
			select {
			case heartbeat <- struct{}{}:
			default:
			}
		}
	})
	p, err := newPublisherWithHeartbeat(context.Background(), url, "secret", "thread", "run", func() {}, 20*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.close)
	result := make(chan error, 1)
	go func() { result <- p.publish(Event{"type": "RUN_FINISHED"}) }()
	select {
	case <-heartbeat:
	case <-time.After(time.Second):
		t.Fatal("pending ACK blocked heartbeat")
	}
	select {
	case err := <-result:
		t.Fatalf("heartbeat released pending event: %v", err)
	case <-time.After(40 * time.Millisecond):
	}
	p.close()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("closed publisher acknowledged event")
		}
	case <-time.After(time.Second):
		t.Fatal("close left publisher blocked")
	}
}

func TestPublisherNegotiatesBoundedBatches(t *testing.T) {
	batches := make(chan []any, 81)
	url := socketFixture(t, func(conn *websocket.Conn, frame []any) {
		if frame[3] == "phx_join" {
			conn.WriteJSON([]any{frame[0], frame[1], frame[2], "phx_reply", map[string]any{"status": "ok", "response": map[string]any{"capabilities": []string{"runner_event_batch_v1"}}}})
			return
		}
		if frame[3] == "events" {
			batches <- object(frame[4])["events"].([]any)
		}
		acknowledge(conn, frame)
	})
	p, err := newPublisher(context.Background(), url, "secret", "thread", "run", func() {})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.close)
	for i := 0; i < 80; i++ {
		if err := p.publish(Event{"type": "TEXT_MESSAGE_CONTENT", "delta": "x"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := p.publish(Event{"type": "RUN_FINISHED"}); err != nil {
		t.Fatal(err)
	}
	total, combined := 0, false
	for len(batches) > 0 {
		batch := <-batches
		total += len(batch)
		combined = combined || len(batch) > 1
		if len(batch) > 32 {
			t.Fatalf("oversized batch: %d", len(batch))
		}
	}
	if total != 81 || !combined {
		t.Fatalf("expected 81 batched events with aggregation, got %d", total)
	}
}

func TestPublisherReplaysImmutableBatchAfterDisconnect(t *testing.T) {
	frames := make(chan []any, 2)
	var deliveries atomic.Int32
	url := socketFixture(t, func(conn *websocket.Conn, frame []any) {
		if frame[3] == "phx_join" {
			conn.WriteJSON([]any{frame[0], frame[1], frame[2], "phx_reply", map[string]any{"status": "ok", "response": map[string]any{"capabilities": []string{"runner_event_batch_v1"}}}})
			return
		}
		if frame[3] == "events" {
			frames <- object(frame[4])["events"].([]any)
			if deliveries.Add(1) == 1 {
				conn.Close()
				return
			}
		}
		acknowledge(conn, frame)
	})
	p, err := newPublisher(context.Background(), url, "secret", "thread", "run", func() {})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.close)
	event := Event{"type": "TEXT_MESSAGE_CONTENT", "delta": "original"}
	if err := p.publish(event); err != nil {
		t.Fatal(err)
	}
	event["delta"] = "caller mutation"
	if err := p.publish(Event{"type": "RUN_FINISHED"}); err != nil {
		t.Fatal(err)
	}
	first, second := <-frames, <-frames
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("replay changed immutable batch: %v != %v", first, second)
	}
	if len(first) != 2 || object(first[0])["delta"] != "original" {
		t.Fatalf("batch snapshot changed: %v", first)
	}
}
