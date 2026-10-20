package intelligence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSDKNormalizesRuntimeEntitlements(t *testing.T) {
	for _, payload := range []string{
		`{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{"memory":true},"limits":{"threads":100},"planCode":"pro"}}`,
		`{"organizationId":"org","active":true,"source":"managedOrgSubscription","features":{"memory":true},"limits":{"threads":100},"planCode":"pro"}`,
	} {
		t.Run(payload, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				if r.URL.Path != "/api/entitlements/runtime" || r.Method != http.MethodGet || len(body) != 0 || r.Header.Get("Authorization") != "Bearer secret" {
					t.Error("entitlement request lost its path, method, or server credential")
				}
				io.WriteString(w, payload)
			}))
			defer server.Close()
			client, err := New(Config{APIKey: "secret", APIURL: server.URL})
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()

			response, err := client.GetRuntimeEntitlements(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(response)
			if err != nil {
				t.Fatal(err)
			}
			var result map[string]any
			if err := json.Unmarshal(encoded, &result); err != nil {
				t.Fatal(err)
			}
			if result["status"] != "ready" || !reflect.DeepEqual(result["entitlement"], map[string]any{"active": true, "source": "managedOrgSubscription", "features": map[string]any{"memory": true}, "limits": map[string]any{"threads": float64(100)}, "planCode": "pro"}) {
				t.Fatalf("wrong normalized entitlement: %s", encoded)
			}
		})
	}
}

func TestSDKCloseCancelsEntitlementLookup(t *testing.T) {
	started, canceled := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(canceled)
	}))
	defer server.Close()
	client, err := New(Config{APIKey: "key", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	result := make(chan error, 1)
	go func() { _, err := client.GetRuntimeEntitlements(context.Background()); result <- err }()
	<-started

	client.Close()
	select {
	case <-canceled:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Close left the entitlement request active")
	}
	if err := <-result; err == nil {
		t.Fatal("closed lookup returned a grant")
	}
}

func TestSDKEntitlementCacheTTLsAndFailureCopies(t *testing.T) {
	for _, active := range []bool{true, false} {
		t.Run(fmt.Sprint(active), func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) > 1 {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				fmt.Fprintf(w, `{"status":"ready","entitlement":{"active":%t,"source":"managedOrgSubscription","features":{},"limits":{}}}`, active)
			}))
			defer server.Close()
			client, err := New(Config{APIKey: "key", APIURL: server.URL})
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			if _, err := client.GetRuntimeEntitlements(context.Background()); err != nil {
				t.Fatal(err)
			}
			client.entitlements.mu.Lock()
			ttl := time.Until(client.entitlements.expires)
			client.entitlements.expires = time.Now().Add(-time.Second)
			client.entitlements.mu.Unlock()
			expectedTTL := 5 * time.Second
			if active {
				expectedTTL = 30 * time.Second
			}
			if ttl <= expectedTTL-time.Second || ttl > expectedTTL {
				t.Fatalf("wrong grant TTL: %v", ttl)
			}

			result, err := client.GetRuntimeEntitlements(context.Background())
			var failure *RuntimeEntitlementError
			if result != nil || !errors.As(err, &failure) || failure.Status != 503 || !failure.Retryable {
				t.Fatalf("expired grant survived failed refresh: %v %v", result, err)
			}
			failure.Status, failure.Retryable = 200, false
			_, cachedErr := client.GetRuntimeEntitlements(context.Background())
			var cached *RuntimeEntitlementError
			if !errors.As(cachedErr, &cached) || cached == failure || cached.Status != 503 || !cached.Retryable || calls.Load() != 2 {
				t.Fatal("failure cache reused mutable errors or made another request")
			}
			client.entitlements.mu.Lock()
			ttl = time.Until(client.entitlements.expires)
			client.entitlements.mu.Unlock()
			if ttl <= 4*time.Second || ttl > 5*time.Second {
				t.Fatalf("wrong failure TTL: %v", ttl)
			}
		})
	}
}

func TestSDKConcurrentEntitlementCallersKeepIndependentCancellation(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		io.WriteString(w, `{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}}`)
	}))
	defer server.Close()
	client, err := New(Config{APIKey: "key", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first := make(chan error, 1)
	go func() { _, err := client.GetRuntimeEntitlements(ctx); first <- err }()
	<-started
	others := make(chan error, 7)
	for index := 0; index < 7; index++ {
		go func() { _, err := client.GetRuntimeEntitlements(context.Background()); others <- err }()
	}
	deadline := time.Now().Add(time.Second)
	for {
		client.entitlements.mu.Lock()
		flight := client.entitlements.flight
		ready := flight != nil && flight.waiters == 8
		client.entitlements.mu.Unlock()
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("callers did not join the shared request")
		}
		time.Sleep(time.Millisecond)
	}

	cancel()
	if err := <-first; !errors.Is(err, context.Canceled) {
		t.Fatalf("first caller did not cancel: %v", err)
	}
	releaseOnce.Do(func() { close(release) })
	for index := 0; index < 7; index++ {
		if err := <-others; err != nil {
			t.Fatalf("another caller lost the shared request: %v", err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("concurrent callers sent %d requests", calls.Load())
	}
}

func TestSDKCanceledEntitlementCallerDoesNotWaitForAnotherLookup(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		io.WriteString(w, `{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}}`)
	}))
	defer server.Close()
	client, err := New(Config{APIKey: "key", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	defer close(release)
	first := make(chan error, 1)
	go func() { _, err := client.GetRuntimeEntitlements(context.Background()); first <- err }()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	second := make(chan error, 1)
	go func() { _, err := client.GetRuntimeEntitlements(ctx); second <- err }()

	select {
	case err := <-second:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("caller cancellation lost: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("canceled caller waited for shared transport")
	}
}

func TestSDKLastEntitlementCallerCancellationDoesNotPoisonCache(t *testing.T) {
	started, canceled := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
			<-r.Context().Done()
			close(canceled)
			return
		}
		io.WriteString(w, `{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}}`)
	}))
	defer server.Close()
	client, err := New(Config{APIKey: "key", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := client.GetRuntimeEntitlements(ctx); result <- err }()
	<-started
	cancel()

	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("caller cancellation lost: %v", err)
	}
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("unused request did not cancel")
	}
	response, err := client.GetRuntimeEntitlements(context.Background())
	if err != nil || response == nil || response.Status != "ready" || calls.Load() != 2 {
		t.Fatalf("cancellation poisoned cache: %v %v", response, err)
	}
}

func TestSDKCachesIndependentEntitlementCopies(t *testing.T) {
	for _, payload := range []string{
		`{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{"memory":true},"limits":{"threads":100},"planCode":"pro"}}`,
		`{"status":"degraded","error":{"code":"BUSY","message":"Try later","retryable":true,"requestId":"request"}}`,
	} {
		t.Run(payload, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				io.WriteString(w, payload)
			}))
			defer server.Close()
			client, err := New(Config{APIKey: "key", APIURL: server.URL})
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()

			first, err := client.GetRuntimeEntitlements(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if first.Entitlement != nil {
				first.Entitlement.Features["memory"] = false
				first.Entitlement.Limits["threads"] = 0
				*first.Entitlement.PlanCode = "changed"
			} else {
				first.Error.Code = "changed"
				*first.Error.RequestID = "changed"
			}
			second, err := client.GetRuntimeEntitlements(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(second)
			if requests.Load() != 1 || string(encoded) != payload {
				t.Fatalf("cache changed or fetched again: calls=%d result=%s", requests.Load(), encoded)
			}
		})
	}
}

type entitlementTransport func(*http.Request) (*http.Response, error)

func (transport entitlementTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

type entitlementErrorBody struct {
	reads  int
	closed bool
}

func (body *entitlementErrorBody) Read([]byte) (int, error) {
	body.reads++
	return 0, errors.New("private-provider-content")
}
func (body *entitlementErrorBody) Close() error { body.closed = true; return nil }

func TestSDKEntitlementFailuresRetainSafeStatusWithoutReadingBodies(t *testing.T) {
	for _, status := range []int{301, 307, 400, 401, 403, 404, 408, 425, 429, 500, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			body := &entitlementErrorBody{}
			httpClient := &http.Client{Transport: entitlementTransport(func(request *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: status, Header: make(http.Header), Body: body, Request: request}, nil
			})}
			client, err := New(Config{APIKey: "key", HTTPClient: httpClient})
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()

			_, err = client.GetRuntimeEntitlements(context.Background())
			var failure *RuntimeEntitlementError
			retryable := status == 408 || status == 425 || status == 429 || status >= 500
			if !errors.As(err, &failure) || failure.Status != status || failure.Retryable != retryable {
				t.Fatalf("wrong error classification: %T %v", err, err)
			}
			if body.reads != 0 || !body.closed {
				t.Fatal("rejected response body must close without a read")
			}
			if errors.Unwrap(failure) != nil {
				t.Fatal("private transport details must not escape")
			}
		})
	}
}

func TestSDKEntitlementDeadlineCoversResponseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	client, err := New(Config{APIKey: "key", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	started := time.Now()

	_, err = client.GetRuntimeEntitlements(ctx)
	var failure *RuntimeEntitlementError
	if !errors.As(err, &failure) || failure.Status != 504 || !failure.Retryable {
		t.Fatalf("wrong timeout classification: %T %v", err, err)
	}
	if elapsed := time.Since(started); elapsed < time.Second || elapsed >= 2500*time.Millisecond {
		t.Fatalf("wrong request deadline: %v", elapsed)
	}
}

func TestSDKRejectsMalformedEntitlementAuthority(t *testing.T) {
	for _, payload := range []string{
		`null`, `[]`, `{}`, `{"status":"unknown"}`, `{"status":{}}`, `{"status":[]}`,
		`{"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}`,
		`{"organizationId":null,"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}`,
		`{"status":"ready","extra":true,"entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}}`,
		`{"status":"ready","entitlement":{"active":true,"source":"unknown","features":{},"limits":{}}}`,
		`{"status":"ready","entitlement":{"source":"managedOrgSubscription","features":{},"limits":{}}}`,
		`{"status":"ready","entitlement":{"active":null,"source":"managedOrgSubscription","features":{},"limits":{}}}`,
		`{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":null,"limits":{}}}`,
		`{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{"memory":null},"limits":{}}}`,
		`{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{"threads":null}}}`,
		`{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{"threads":1e400}}}`,
		`{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{},"planCode":null}}`,
		`{"status":"unavailable","error":{"code":"ERROR","message":"retry"}}`,
		`{"status":"unavailable","error":{"code":"ERROR","message":"retry","retryable":null}}`,
		`{"status":"unavailable","error":{"code":"ERROR","message":"retry","retryable":true,"traceId":null}}`,
		`{"status":"unavailable","error":{"code":"ERROR","message":"retry","retryable":true},"entitlement":{}}`,
	} {
		t.Run(payload, func(t *testing.T) {
			_, err := parseRuntimeEntitlements([]byte(payload))
			var failure *RuntimeEntitlementError
			if !errors.As(err, &failure) || failure.Status != 502 || failure.Retryable {
				t.Fatalf("malformed authority must produce a nonretryable 502: %v", err)
			}
		})
	}
}

func TestSDKEntitlementTransportErrorsDoNotExposePrivateDetails(t *testing.T) {
	var calls atomic.Int32
	httpClient := &http.Client{Transport: entitlementTransport(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, errors.New("private-provider-content")
	})}
	client, err := New(Config{APIKey: "key", HTTPClient: httpClient})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	for index := 0; index < 2; index++ {
		_, err := client.GetRuntimeEntitlements(context.Background())
		var failure *RuntimeEntitlementError
		if !errors.As(err, &failure) || failure.Status != 502 || !failure.Retryable || failure.Error() != "Runtime entitlement request failed" || errors.Unwrap(failure) != nil {
			t.Fatalf("unsafe transport error: %T %v", err, err)
		}
	}
	if calls.Load() != 1 {
		t.Fatal("transport failure was not cached")
	}
}

func TestSDKRetainsStructuredEntitlementProblems(t *testing.T) {
	for _, status := range []string{"degraded", "misconfigured", "unavailable"} {
		t.Run(status, func(t *testing.T) {
			payload := `{"status":"` + status + `","error":{"code":"BUSY","message":"Try later","retryable":true,"requestId":"","traceId":"trace"}}`
			response, err := parseRuntimeEntitlements([]byte(payload))
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(response)
			if err != nil {
				t.Fatal(err)
			}
			if string(encoded) != payload {
				t.Fatalf("structured problem changed: %s", encoded)
			}
		})
	}
}
