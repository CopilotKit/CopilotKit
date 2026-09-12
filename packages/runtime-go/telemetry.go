package runtime

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var telemetryIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var telemetryLicensePayloadPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

const telemetryQueueCapacity = 128
const telemetryTimeout = 3 * time.Second

// ECMAScript String.trim includes BOM but excludes NEL, unlike Go TrimSpace.
const telemetryLicenseWhitespace = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004" +
	"\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

type telemetryJob struct {
	body    []byte
	barrier chan struct{}
}

// telemetryExporter has exactly one worker and a bounded, nonblocking producer queue.
type telemetryExporter struct {
	queue              chan telemetryJob
	done               chan struct{}
	ctx                context.Context
	cancel             context.CancelFunc
	mu                 sync.Mutex
	closed, disabled   bool
	identified         bool
	rate               float64
	identity, endpoint string
	client             *http.Client
}

func telemetryIdentity(values ...string) string {
	for _, value := range values {
		value = strings.Trim(value, " \t")
		if telemetryIDPattern.MatchString(value) {
			return value
		}
	}
	return ""
}

// licenseTelemetryIdentity extracts a legacy analytics claim, without verifying
// signatures or granting access. Only the validated claim can reach the sink.
func licenseTelemetryIdentity(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || len(parts[1])%4 == 1 || !telemetryLicensePayloadPattern.MatchString(parts[1]) {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims map[string]any
	if json.Unmarshal(payload, &claims) != nil {
		return ""
	}
	return telemetryIdentity(str(claims["telemetry_id"]))
}
func disabledEnvironment() bool {
	for _, key := range []string{"DO_NOT_TRACK", "COPILOTKIT_TELEMETRY_DISABLED"} {
		if value := os.Getenv(key); value == "true" || value == "1" {
			return true
		}
	}
	return false
}
func newTelemetry(c Config) (*telemetryExporter, error) {
	rate := 0.05
	if c.TelemetrySampleRate != nil {
		rate = *c.TelemetrySampleRate
	}
	if raw, exists := os.LookupEnv("COPILOTKIT_TELEMETRY_SAMPLE_RATE"); exists && raw != "" {
		parsed, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return nil, errors.New("telemetry sample rate must be finite and between zero and one")
		}
		rate = parsed
	}
	if math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 || rate > 1 {
		return nil, errors.New("telemetry sample rate must be finite and between zero and one")
	}
	endpoint := c.TelemetryURL
	if endpoint == "" {
		endpoint = os.Getenv("COPILOTKIT_TELEMETRY_URL")
	}
	if endpoint == "" {
		endpoint = "https://telemetry.copilotkit.ai/ingest"
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, errors.New("invalid telemetry sink URL")
	}
	ctx, cancel := context.WithCancel(context.Background())
	exporter := &telemetryExporter{queue: make(chan telemetryJob, telemetryQueueCapacity), done: make(chan struct{}), ctx: ctx, cancel: cancel, disabled: c.TelemetryDisabled || disabledEnvironment(), rate: rate, identity: telemetryIdentity(c.TelemetryID, os.Getenv("CPK_TELEMETRY_ID")), endpoint: endpoint, client: &http.Client{Timeout: telemetryTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	if !exporter.disabled && exporter.identity == "" {
		token := c.LicenseToken
		if strings.Trim(token, telemetryLicenseWhitespace) == "" {
			token = os.Getenv("COPILOTKIT_LICENSE_TOKEN")
		}
		exporter.identity = licenseTelemetryIdentity(token)
		exporter.identified = exporter.identity != ""
		if exporter.identified {
			exporter.rate = 1
		}
	}
	go exporter.work()
	return exporter, nil
}
func (e *telemetryExporter) work() {
	defer close(e.done)
	for {
		select {
		case <-e.ctx.Done():
			return
		case job, ok := <-e.queue:
			if !ok {
				return
			}
			if job.barrier != nil {
				close(job.barrier)
				continue
			}
			e.send(job.body)
		}
	}
}
func (e *telemetryExporter) send(body []byte) {
	ctx, cancel := context.WithTimeout(e.ctx, telemetryTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "POST", e.endpoint, bytes.NewReader(body))
	if err != nil {
		return
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "CopilotKit-Runtime/0.1.0 (copilotkit-runtime-go)")
	if e.identity != "" {
		request.Header.Set("X-CopilotKit-Telemetry-Id", e.identity)
	}
	response, err := e.client.Do(request)
	if err == nil {
		response.Body.Close()
	}
}
func (e *telemetryExporter) capture(event string, properties map[string]any) {
	if e.disabled || e.rate == 0 || (e.rate < 1 && rand.Float64() >= e.rate) {
		return
	}
	body, err := json.Marshal(map[string]any{"event": event, "properties": properties, "global_properties": map[string]any{"sampleRate": e.rate, "sampleRateAdjustmentFactor": 1 - e.rate, "sampleWeight": 1 / e.rate, "telemetry_identified": e.identified, "telemetry_emitter": "runtime-go", "telemetry_transport": "lambda"}, "package": map[string]any{"name": "copilotkit-runtime-go", "version": "0.1.0"}, "ts": time.Now().Unix()})
	if err != nil {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return
	}
	select {
	case e.queue <- telemetryJob{body: body}:
	default:
	}
}
func (e *telemetryExporter) flush(ctx context.Context) error {
	barrier := make(chan struct{})
	enqueued := false
	for !enqueued {
		e.mu.Lock()
		if e.closed {
			e.mu.Unlock()
			select {
			case <-e.done:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		select {
		case e.queue <- telemetryJob{barrier: barrier}:
			e.mu.Unlock()
			enqueued = true
		default:
			e.mu.Unlock()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-e.done:
				return nil
			case <-time.After(time.Millisecond):
			}
		}
	}
	select {
	case <-barrier:
		return nil
	case <-e.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (e *telemetryExporter) close() {
	e.mu.Lock()
	if !e.closed {
		e.closed = true
		close(e.queue)
	}
	e.mu.Unlock()
	timer := time.NewTimer(telemetryTimeout)
	defer timer.Stop()
	select {
	case <-e.done:
	case <-timer.C:
		e.cancel()
		<-e.done
	}
	e.cancel()
}
func (r *Runtime) capture(event string, properties map[string]any) {
	r.telemetry.capture(event, properties)
}

// FlushTelemetry waits for queued events without changing runtime availability.
func (r *Runtime) FlushTelemetry(ctx context.Context) error { return r.telemetry.flush(ctx) }
