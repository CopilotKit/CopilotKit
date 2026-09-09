package runtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type publisher struct {
	ctx                   context.Context
	url, key, thread, run string
	conn                  *websocket.Conn
	ref, seq              int
	frames                chan []any
	done                  chan struct{}
	stop                  context.CancelFunc
}

func newPublisher(ctx context.Context, raw, key, thread, run string, stop context.CancelFunc) (*publisher, error) {
	p := &publisher{ctx: ctx, url: raw, key: key, thread: thread, run: run, seq: 1, stop: stop}
	if e := p.connect(); e != nil {
		p.close()
		return nil, e
	}
	return p, nil
}
func (p *publisher) connect() error {
	u, e := url.Parse(p.url)
	if e != nil {
		return e
	}
	u.Path = strings.TrimRight(u.Path, "/")
	if !strings.HasSuffix(u.Path, "/websocket") {
		u.Path += "/websocket"
	}
	q := u.Query()
	q.Set("vsn", "2.0.0")
	u.RawQuery = q.Encode()
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second, Subprotocols: []string{"phoenix", "base64url.bearer.phx." + base64.RawURLEncoding.EncodeToString([]byte(p.key))}}
	conn, resp, e := dialer.DialContext(p.ctx, u.String(), http.Header{})
	if resp != nil && resp.Body != nil {
		resp.Body.Close()
	}
	if e != nil {
		return e
	}
	p.conn = conn
	p.frames = make(chan []any, 64)
	p.done = make(chan struct{})
	conn.SetReadLimit(4 << 20)
	frames, done := p.frames, p.done
	go func() {
		defer close(done)
		for {
			var frame []any
			if e := conn.ReadJSON(&frame); e != nil {
				return
			}
			if len(frame) == 5 && str(frame[3]) == "ag_ui_event" {
				event := object(frame[4])
				if str(event["type"]) == "CUSTOM" && str(event["name"]) == "stop" {
					p.stop()
				}
				continue
			}
			select {
			case frames <- frame:
			case <-p.ctx.Done():
				return
			}
		}
	}()
	return p.push("phx_join", map[string]any{"thread_id": p.thread, "run_id": p.run}, 10*time.Second)
}
func (p *publisher) push(event string, payload any, timeout time.Duration) error {
	p.ref++
	ref := strconv.Itoa(p.ref)
	p.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if e := p.conn.WriteJSON([]any{"1", ref, "ingestion:" + p.run, event, payload}); e != nil {
		return e
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case <-p.ctx.Done():
			return p.ctx.Err()
		case <-p.done:
			return errors.New("gateway disconnected")
		case <-timer.C:
			return errors.New("gateway acknowledgment timeout")
		case frame := <-p.frames:
			if len(frame) != 5 || str(frame[1]) != ref || str(frame[3]) != "phx_reply" {
				continue
			}
			body := object(frame[4])
			if str(body["status"]) != "ok" {
				response := object(body["response"])
				if response["retryable"] == false {
					return permanentRejection{}
				}
				return errors.New("gateway rejected push")
			}
			return nil
		}
	}
}

type permanentRejection struct{}

func (permanentRejection) Error() string { return "gateway permanently rejected event" }
func (p *publisher) publish(event Event) error {
	event["thread_id"], event["run_id"] = p.thread, p.run
	metadata := object(event["metadata"])
	metadata["cpki_event_id"], metadata["cpki_event_seq"] = uuid(), p.seq
	p.seq++
	event["metadata"] = metadata
	raw, e := json.Marshal(event)
	if e != nil {
		return e
	}
	var immutable map[string]any
	if e = json.Unmarshal(raw, &immutable); e != nil {
		return e
	}
	deadline := time.Now().Add(60 * time.Second)
	delay := 100 * time.Millisecond
	for {
		e = p.push("event", immutable, 5*time.Second)
		if e == nil {
			return nil
		}
		var rejected permanentRejection
		if errors.As(e, &rejected) || p.ctx.Err() != nil || time.Now().After(deadline) {
			return e
		}
		select {
		case <-p.ctx.Done():
			return p.ctx.Err()
		case <-time.After(delay):
		}
		if delay < 2*time.Second {
			delay *= 2
		}
		p.close()
		if err := p.connect(); err != nil {
			if time.Now().After(deadline) {
				return err
			}
			continue
		}
	}
}
func (p *publisher) close() {
	if p.conn != nil {
		p.conn.Close()
	}
}
