package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestTelemetryDoesNotFollowRedirects(t *testing.T) {
	calls := 0
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(202) }))
	defer target.Close()
	sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer sink.Close()
	rate := 1.0
	rt, err := New(Config{APIKey: "secret", TelemetryURL: sink.URL, TelemetrySampleRate: &rate, IdentifyUser: func(*http.Request) (User, error) { return User{}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	rt.Close()
	if calls != 0 {
		t.Fatal("telemetry followed a redirect")
	}
}

func TestTelemetryDefaultRateAndEnvironmentOverride(t *testing.T) {
	exporter, err := newTelemetry(Config{TelemetryDisabled: true})
	if err != nil {
		t.Fatal(err)
	}
	defer exporter.close()
	if exporter.rate != .05 {
		t.Fatalf("default rate %v", exporter.rate)
	}
	t.Setenv("COPILOTKIT_TELEMETRY_SAMPLE_RATE", "0")
	t.Setenv("CPK_TELEMETRY_ID", "environment-id")
	rate := 1.0
	other, err := newTelemetry(Config{TelemetryDisabled: true, TelemetrySampleRate: &rate, TelemetryID: "\t "})
	if err != nil {
		t.Fatal(err)
	}
	defer other.close()
	if other.rate != 0 || other.identity != "environment-id" {
		t.Fatalf("env did not win rate=%v id=%q", other.rate, other.identity)
	}
}

func TestAppErrorCallbackIsSeparateAndCannotBreakRequest(t *testing.T) {
	called := false
	rt, err := New(Config{APIKey: "secret", TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{}, errors.New("private app error") }, OnError: func(event RuntimeError) {
		called = true
		if event.Operation != "identify_user" || event.Err.Error() != "private app error" {
			t.Error(event)
		}
		panic("callback failure")
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer rt.Close()
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("GET", "/copilotkit/threads", nil))
	if !called || response.Code != 401 {
		t.Fatalf("callback=%v status=%v", called, response.Code)
	}
}

func TestTelemetrySamplingIdentityAndCanonicalEnvelope(t *testing.T) {
	var bodies []map[string]any
	var identity string
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		bodies = append(bodies, body)
		identity = r.Header.Get("X-CopilotKit-Telemetry-Id")
		mu.Unlock()
		w.WriteHeader(202)
	}))
	defer server.Close()
	rate := 1.0
	rt, err := New(Config{APIKey: "secret", TelemetryURL: server.URL, TelemetryID: "\t customer-1 ", TelemetrySampleRate: &rate, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "u", Name: "U"}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	rt.capture("oss.runtime.agent_execution_stream_started", map[string]any{})
	if err := rt.FlushTelemetry(context.Background()); err != nil {
		t.Fatal(err)
	}
	rt.Close()
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 2 {
		t.Fatal(bodies)
	}
	if identity != "customer-1" {
		t.Fatal(identity)
	}
	globals := object(bodies[0]["global_properties"])
	if globals["sampleRate"] != float64(1) || globals["sampleWeight"] != float64(1) || globals["telemetry_identified"] != false {
		t.Fatal(globals)
	}
	if object(bodies[0]["properties"])["actionsAmount"] != float64(0) {
		t.Fatal(bodies[0])
	}
	if bodies[0]["ts"].(float64) > float64(time.Now().Unix()+1) {
		t.Fatal("not Unix seconds")
	}
}
func TestTelemetryRejectsInvalidSampleRateAtStartup(t *testing.T) {
	t.Setenv("COPILOTKIT_TELEMETRY_SAMPLE_RATE", "NaN")
	if _, err := New(Config{APIKey: "secret", IdentifyUser: func(*http.Request) (User, error) { return User{}, nil }}); err == nil {
		t.Fatal("NaN accepted")
	}
}
func TestTelemetryQueueIsBoundedAndCloseCancelsBlockedSink(t *testing.T) {
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case entered <- struct{}{}:
		default:
		}
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)
	rate := 1.0
	rt, err := New(Config{APIKey: "secret", TelemetryURL: server.URL, TelemetrySampleRate: &rate, IdentifyUser: func(*http.Request) (User, error) { return User{}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	<-entered
	for i := 0; i < 1000; i++ {
		rt.capture("oss.runtime.agent_execution_stream_started", map[string]any{})
	}
	if queued := len(rt.telemetry.queue); queued > 128 {
		t.Fatalf("unbounded queue %d", queued)
	}
	started := time.Now()
	rt.Close()
	if time.Since(started) > 4*time.Second {
		t.Fatal("close exceeded flush deadline")
	}
}
