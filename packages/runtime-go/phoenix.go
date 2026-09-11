package runtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

type publishRequest struct {
	event  map[string]any
	result chan error
}

// publisher gives one goroutine ownership of socket writes, replies and retries.
type publisher struct {
	ctx                   context.Context
	cancel                context.CancelFunc
	url, key, thread, run string
	conn                  *websocket.Conn
	ref, seq              int
	frames                chan []any
	connectionDone        chan struct{}
	connectionCancel      context.CancelFunc
	done                  chan struct{}
	requests              chan publishRequest
	stop                  context.CancelFunc
	heartbeatInterval     time.Duration
	ticker                *time.Ticker
	heartbeatRef          string
	batch                 atomic.Bool
}

func newPublisher(ctx context.Context, raw, key, thread, run string, stop context.CancelFunc) (*publisher, error) {
	return newPublisherWithHeartbeat(ctx, raw, key, thread, run, stop, 15*time.Second)
}

func newPublisherWithHeartbeat(ctx context.Context, raw, key, thread, run string, stop context.CancelFunc, interval time.Duration) (*publisher, error) {
	ctx, cancel := context.WithCancel(ctx)
	p := &publisher{ctx: ctx, cancel: cancel, url: raw, key: key, thread: thread, run: run, seq: 1, stop: stop,
		heartbeatInterval: interval, done: make(chan struct{}), requests: make(chan publishRequest, 32)}
	startup := make(chan error, 1)
	go p.loop(startup)
	if err := <-startup; err != nil {
		p.close()
		return nil, err
	}
	return p, nil
}

// loop keeps idle sockets healthy without competing with event acknowledgements.
func (p *publisher) loop(startup chan<- error) {
	defer close(p.done)
	defer p.cancel()
	defer p.disconnect()
	p.ticker = time.NewTicker(p.heartbeatInterval)
	defer p.ticker.Stop()
	if err := p.reconnect(time.Now().Add(60 * time.Second)); err != nil {
		startup <- err
		return
	}
	startup <- nil
	for {
		select {
		case <-p.ctx.Done():
			return
		case request := <-p.requests:
			requests := []publishRequest{request}
			if p.batch.Load() {
				timer := time.NewTimer(2 * time.Millisecond)
			collect:
				for len(requests) < 32 {
					last := str(requests[len(requests)-1].event["type"])
					if last == "RUN_FINISHED" || last == "RUN_ERROR" {
						break
					}
					select {
					case next := <-p.requests:
						requests = append(requests, next)
					case <-timer.C:
						break collect
					case <-p.ctx.Done():
						timer.Stop()
						return
					}
				}
				timer.Stop()
			}
			events := make([]any, 0, len(requests))
			for _, item := range requests {
				item.event["threadId"], item.event["runId"] = p.thread, p.run
				item.event["thread_id"], item.event["run_id"] = p.thread, p.run
				metadata := object(item.event["metadata"])
				metadata["cpki_event_id"], metadata["cpki_event_seq"] = uuid(), p.seq
				p.seq++
				item.event["metadata"] = metadata
				events = append(events, item.event)
			}
			name, payload := "event", request.event
			if p.batch.Load() {
				name, payload = "events", map[string]any{"events": events}
			}
			err := p.deliver(name, payload)
			for _, item := range requests {
				item.result <- err
			}
			if err != nil {
				return
			}
		case <-p.ticker.C:
			if err := p.push("heartbeat", map[string]any{}, 5*time.Second); err != nil {
				if p.reconnect(time.Now().Add(60*time.Second)) != nil {
					return
				}
			}
		case <-p.connectionDone:
			if p.reconnect(time.Now().Add(60*time.Second)) != nil {
				return
			}
		case frame := <-p.frames:
			p.consume(frame)
		}
	}
}

// connect joins the authenticated ingestion topic before any agent work begins.
func (p *publisher) connect() error {
	u, err := url.Parse(p.url)
	if err != nil {
		return err
	}
	u.Path = strings.TrimRight(u.Path, "/")
	if !strings.HasSuffix(u.Path, "/websocket") {
		u.Path += "/websocket"
	}
	query := u.Query()
	query.Set("vsn", "2.0.0")
	u.RawQuery = query.Encode()
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second, Subprotocols: []string{"phoenix", "base64url.bearer.phx." + base64.RawURLEncoding.EncodeToString([]byte(p.key))}}
	conn, response, err := dialer.DialContext(p.ctx, u.String(), http.Header{})
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	if err != nil {
		return err
	}
	p.conn = conn
	p.frames = make(chan []any, 64)
	p.connectionDone = make(chan struct{})
	p.heartbeatRef = ""
	conn.SetReadLimit(4 << 20)
	frames, done := p.frames, p.connectionDone
	connectionContext, cancel := context.WithCancel(p.ctx)
	p.connectionCancel = cancel
	go func() {
		defer close(done)
		defer cancel()
		for {
			var frame []any
			if conn.ReadJSON(&frame) != nil {
				return
			}
			select {
			case frames <- frame:
			case <-connectionContext.Done():
				return
			}
		}
	}()
	go func() { <-connectionContext.Done(); conn.Close() }()
	return p.push("phx_join", map[string]any{"thread_id": p.thread, "run_id": p.run}, 10*time.Second)
}

// consume handles control traffic independently from the current event's reply.
func (p *publisher) consume(frame []any) {
	if len(frame) != 5 {
		return
	}
	if str(frame[2]) == "ingestion:"+p.run && str(frame[3]) == "ag-ui" {
		event := object(frame[4])
		if str(event["type"]) == "CUSTOM" && str(event["name"]) == "stop" {
			p.stop()
		}
	}
	if str(frame[2]) == "phoenix" && str(frame[1]) == p.heartbeatRef && str(frame[3]) == "phx_reply" && str(object(frame[4])["status"]) == "ok" {
		p.heartbeatRef = ""
	}
}

func (p *publisher) write(event string, payload any) (string, error) {
	p.ref++
	ref := strconv.Itoa(p.ref)
	var joinRef any = "1"
	topic := "ingestion:" + p.run
	if event == "heartbeat" {
		joinRef, topic = nil, "phoenix"
	}
	p.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return ref, p.conn.WriteJSON([]any{joinRef, ref, topic, event, payload})
}

func (p *publisher) push(event string, payload any, timeout time.Duration) error {
	ref, err := p.write(event, payload)
	if err != nil {
		return err
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case <-p.ctx.Done():
			return p.ctx.Err()
		case <-p.connectionDone:
			return errors.New("gateway disconnected")
		case <-timer.C:
			return errors.New("gateway acknowledgment timeout")
		case <-p.ticker.C:
			if event == "phx_join" || event == "heartbeat" {
				continue
			}
			if p.heartbeatRef != "" {
				return errors.New("gateway heartbeat acknowledgment timeout")
			}
			p.heartbeatRef, err = p.write("heartbeat", map[string]any{})
			if err != nil {
				return err
			}
		case frame := <-p.frames:
			p.consume(frame)
			topic := "ingestion:" + p.run
			if event == "heartbeat" {
				topic = "phoenix"
			}
			if len(frame) != 5 || str(frame[1]) != ref || str(frame[2]) != topic || str(frame[3]) != "phx_reply" {
				continue
			}
			body := object(frame[4])
			if str(body["status"]) != "ok" {
				response := object(body["response"])
				if response["retryable"] == false || (event == "phx_join" && response["retryable"] != true && response["reason"] != "gateway_draining") {
					return permanentRejection{}
				}
				return errors.New("gateway rejected push")
			}
			if event == "phx_join" {
				capabilities, _ := object(body["response"])["capabilities"].([]any)
				for _, capability := range capabilities {
					if capability == "runner_event_batch_v1" {
						p.batch.Store(true)
					}
				}
			}
			return nil
		}
	}
}

type permanentRejection struct{}

func (permanentRejection) Error() string { return "gateway permanently rejected event" }

func (p *publisher) reconnect(deadline time.Time) error {
	delay := 100 * time.Millisecond
	for {
		p.disconnect()
		err := p.connect()
		if err == nil {
			return nil
		}
		var rejected permanentRejection
		if errors.As(err, &rejected) || p.ctx.Err() != nil || time.Now().After(deadline) {
			return err
		}
		select {
		case <-p.ctx.Done():
			return p.ctx.Err()
		case <-time.After(delay):
		}
		delay = min(delay*2, 2*time.Second)
	}
}

func (p *publisher) deliver(name string, event map[string]any) error {
	deadline := time.Now().Add(60 * time.Second)
	for {
		err := p.push(name, event, 5*time.Second)
		if err == nil {
			return nil
		}
		var rejected permanentRejection
		if errors.As(err, &rejected) || p.ctx.Err() != nil || time.Now().After(deadline) {
			return err
		}
		if err = p.reconnect(deadline); err != nil {
			return err
		}
	}
}

// publish snapshots caller data before handing it to the socket owner.
func (p *publisher) publish(event Event) error {
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if len(raw) > 4<<20 {
		return errors.New("runner event exceeds 4 MB")
	}
	var immutable map[string]any
	if err := json.Unmarshal(raw, &immutable); err != nil {
		return err
	}
	request := publishRequest{event: immutable, result: make(chan error, 1)}
	terminal := str(immutable["type"]) == "RUN_FINISHED" || str(immutable["type"]) == "RUN_ERROR"
	select {
	case p.requests <- request:
	case <-p.ctx.Done():
		return p.ctx.Err()
	}
	if p.batch.Load() && !terminal {
		return nil
	}
	select {
	case err := <-request.result:
		return err
	case <-p.ctx.Done():
		return p.ctx.Err()
	}
}

func (p *publisher) disconnect() {
	if p.connectionCancel != nil {
		p.connectionCancel()
		p.connectionCancel = nil
	}
	if p.conn != nil {
		p.conn.Close()
		p.conn = nil
	}
}
func (p *publisher) close() { p.cancel(); <-p.done }
