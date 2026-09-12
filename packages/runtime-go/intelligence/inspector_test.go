package intelligence_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/CopilotKit/CopilotKit/packages/runtime-go/intelligence"
)

func TestInspectorMetadataUsesServerAuthAndSanitizesModules(t *testing.T) {
	requests := make(chan *http.Request, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil || len(body) != 0 {
			t.Error("metadata GET must have no body")
		}
		requests <- r.Clone(context.Background())
		io.WriteString(w, `{"schemaVersion":1,"identity":{"organizationName":" Org ","projectName":" App ","private":"secret"},"plan":{"code":" team ","label":" Team "},"license":{"state":"valid","private":"secret"},"action":{"kind":"manage_plan","url":" https://cloud.test/manage "},"usage":{"used":3,"limit":{"kind":"finite","value":10},"expiringSoonCount":0},"private":"secret"}`)
	}))
	defer server.Close()
	client, err := intelligence.New(intelligence.Config{APIKey: "server-key", APIURL: server.URL + "/base"})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	metadata, err := client.GetInspectorMetadata(context.Background())

	if err != nil || metadata == nil {
		t.Fatalf("metadata missing: %v", err)
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	var actual, expected any
	json.Unmarshal(encoded, &actual)
	json.Unmarshal([]byte(`{"schemaVersion":1,"identity":{"organizationName":"Org","projectName":"App"},"plan":{"code":"team","label":"Team"},"license":{"state":"valid"},"action":{"kind":"manage_plan","url":"https://cloud.test/manage"},"usage":{"used":3,"limit":{"kind":"finite","value":10},"expiringSoonCount":0}}`), &expected)
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("wrong sanitized metadata: %s", encoded)
	}
	request := <-requests
	if request.Method != "GET" || request.URL.Path != "/base/api/inspector/metadata" || request.Header.Get("Authorization") != "Bearer server-key" || request.Header.Get("X-Cpki-User-Id") != "" {
		t.Fatal("wrong server-owned metadata request")
	}
}

type inspectorTransport func(*http.Request) (*http.Response, error)

func (transport inspectorTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

type inspectorBody struct {
	io.Reader
	reads  int
	closed bool
}

func (body *inspectorBody) Read(buffer []byte) (int, error) {
	body.reads++
	return body.Reader.Read(buffer)
}
func (body *inspectorBody) Close() error { body.closed = true; return nil }

func TestInspectorAbsenceSkipsBodyAndClosesResponse(t *testing.T) {
	for _, status := range []int{204, 404} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			body := &inspectorBody{Reader: strings.NewReader("private malformed JSON")}
			client, err := intelligence.New(intelligence.Config{APIKey: "key", HTTPClient: &http.Client{Transport: inspectorTransport(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: status, Header: make(http.Header), Body: body}, nil
			})}})
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()

			metadata, err := client.GetInspectorMetadata(context.Background())

			if metadata != nil || err != nil {
				t.Fatalf("expected absence, got %+v, %v", metadata, err)
			}
			if body.reads != 0 || !body.closed {
				t.Fatal("absence body must close without reading")
			}
		})
	}
}

func TestInspectorRequestHasFiveSecondDeadline(t *testing.T) {
	client, err := intelligence.New(intelligence.Config{APIKey: "key", HTTPClient: &http.Client{Transport: inspectorTransport(func(request *http.Request) (*http.Response, error) {
		deadline, present := request.Context().Deadline()
		remaining := time.Until(deadline)
		if !present || remaining <= 0 || remaining > 5*time.Second {
			t.Errorf("expected at most five seconds, got %v", remaining)
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"schemaVersion":1}`))}, nil
	})}})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	if _, err := client.GetInspectorMetadata(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func inspectorPayload(t *testing.T, payload string) (*intelligence.InspectorMetadata, error) {
	t.Helper()
	client, err := intelligence.New(intelligence.Config{APIKey: "key", HTTPClient: &http.Client{Transport: inspectorTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(payload))}, nil
	})}})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	return client.GetInspectorMetadata(context.Background())
}

func TestInspectorActionURLPolicy(t *testing.T) {
	for _, safe := range []string{"https://cloud.test/manage", "http://localhost/manage", "http://localhost:3000/manage", "http://127.0.0.1:3000/manage", "http://[::1]:3000/manage"} {
		t.Run(safe, func(t *testing.T) {
			payload, _ := json.Marshal(map[string]any{"schemaVersion": 1, "action": map[string]any{"kind": "renew", "url": safe}})
			metadata, err := inspectorPayload(t, string(payload))
			if err != nil || metadata == nil || metadata.Action == nil || metadata.Action.URL != safe {
				t.Fatalf("valid URL rejected: %+v %v", metadata, err)
			}
		})
	}
	for _, unsafe := range []string{"", " ", "/manage", "mailto:billing@cloud.test", "ftp://cloud.test/manage", "http://cloud.test/manage", "http://localhost.example.com/manage", "http://sub.localhost/manage", "http://127.0.0.2/manage", "http://[::2]/manage", "http://0.0.0.0/manage", "https://@cloud.test/manage", "https://user:pass@cloud.test/manage", "https://cloud.test/manage?", "https://cloud.test/manage?key=private", "https://cloud.test/manage#", "https://bad host/manage", "https://cloud.test:65536/manage", "https://cloud.test:bad/manage", "https://[broken/manage", "https://[broken]/manage", "https://%20/manage"} {
		t.Run(unsafe, func(t *testing.T) {
			payload, _ := json.Marshal(map[string]any{"schemaVersion": 1, "action": map[string]any{"kind": "renew", "url": unsafe}, "plan": map[string]any{"code": "team", "label": "Team"}})
			metadata, err := inspectorPayload(t, string(payload))
			if err != nil || metadata == nil || metadata.Action != nil || metadata.Plan == nil {
				t.Fatalf("unsafe URL accepted or valid plan lost: %+v %v", metadata, err)
			}
		})
	}
}

func TestInspectorUsageNumbersAndIndependentModules(t *testing.T) {
	for _, invalid := range []string{`null`, `true`, `-1`, `1.5`, `9007199254740992`, `"1"`} {
		t.Run(invalid, func(t *testing.T) {
			for _, payload := range []string{
				`{"schemaVersion":1,"usage":{"used":` + invalid + `,"limit":{"kind":"finite","value":10}}}`,
				`{"schemaVersion":1,"usage":{"used":3,"limit":{"kind":"finite","value":` + invalid + `}}}`,
			} {
				metadata, err := inspectorPayload(t, payload)
				if err != nil || metadata == nil || metadata.Usage != nil {
					t.Fatalf("invalid usage accepted: %+v %v", metadata, err)
				}
			}
			metadata, err := inspectorPayload(t, `{"schemaVersion":1,"usage":{"used":3,"limit":{"kind":"finite","value":10},"expiringSoonCount":`+invalid+`}}`)
			if err != nil || metadata == nil || metadata.Usage == nil || metadata.Usage.Used != 3 || metadata.Usage.ExpiringSoonCount != nil {
				t.Fatalf("invalid expiry hid valid usage: %+v %v", metadata, err)
			}
		})
	}
	metadata, err := inspectorPayload(t, `{"schemaVersion":1.0,"identity":{"organizationName":"\ufeff Org \ufeff","projectName":"\u0085"},"plan":{"code":"","label":"bad"},"license":{"state":"unknown","private":"secret"},"action":{"kind":"unsupported","url":"https://cloud.test"},"usage":{"used":0,"limit":{"kind":"unlimited","value":4},"expiringSoonCount":0}}`)
	if err != nil || metadata == nil {
		t.Fatalf("metadata absent: %v", err)
	}
	if metadata.Identity == nil || metadata.Identity.OrganizationName != "Org" || metadata.Identity.ProjectName != "\u0085" || metadata.Plan != nil || metadata.Action != nil || metadata.License == nil || metadata.License.State != "unknown" {
		t.Fatalf("optional module parsing changed: %+v", metadata)
	}
	if metadata.Usage == nil || metadata.Usage.Limit.Kind != "unlimited" || metadata.Usage.Limit.Value != nil || metadata.Usage.ExpiringSoonCount == nil || *metadata.Usage.ExpiringSoonCount != 0 {
		t.Fatalf("zero or unlimited limit lost: %+v", metadata.Usage)
	}
}

func TestInspectorRejectsUnsupportedSchemasAndMalformedJSON(t *testing.T) {
	for _, payload := range []string{`null`, `[]`, `1`, `"1"`, `{}`, `{"schemaVersion":true}`, `{"schemaVersion":2}`} {
		metadata, err := inspectorPayload(t, payload)
		if metadata != nil || err != nil {
			t.Fatalf("expected absent unsupported schema %s: %+v %v", payload, metadata, err)
		}
	}
	for _, payload := range []string{"", "private-key", `{"schemaVersion":1} trailing`} {
		metadata, err := inspectorPayload(t, payload)
		var failure *intelligence.Error
		if metadata != nil || !errors.As(err, &failure) || failure.Status != 502 || strings.Contains(err.Error(), "private-key") {
			t.Fatalf("malformed JSON did not return safe error: %+v %v", metadata, err)
		}
	}
}

func TestInspectorProviderErrorsRetainStatusWithoutReadOrRedirect(t *testing.T) {
	for _, status := range []int{301, 302, 401, 403, 429, 500, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			calls := 0
			body := &inspectorBody{Reader: strings.NewReader("private-key")}
			client, err := intelligence.New(intelligence.Config{APIKey: "key", HTTPClient: &http.Client{Transport: inspectorTransport(func(*http.Request) (*http.Response, error) {
				calls++
				return &http.Response{StatusCode: status, Header: http.Header{"Location": []string{"https://elsewhere.test"}}, Body: body}, nil
			})}})
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			metadata, err := client.GetInspectorMetadata(context.Background())
			var failure *intelligence.Error
			if metadata != nil || !errors.As(err, &failure) || failure.Status != status || strings.Contains(err.Error(), "private-key") {
				t.Fatalf("wrong provider error: %+v %v", metadata, err)
			}
			if calls != 1 || body.reads != 0 || !body.closed {
				t.Fatal("error body read, request retried, or response left open")
			}
		})
	}
}

type inspectorReader func([]byte) (int, error)

func (reader inspectorReader) Read(buffer []byte) (int, error) { return reader(buffer) }

func TestInspectorPreservesHeaderAndBodyDeadlines(t *testing.T) {
	for _, phase := range []string{"headers", "body"} {
		t.Run(phase, func(t *testing.T) {
			var body *inspectorBody
			client, err := intelligence.New(intelligence.Config{APIKey: "key", HTTPClient: &http.Client{Transport: inspectorTransport(func(request *http.Request) (*http.Response, error) {
				if phase == "headers" {
					<-request.Context().Done()
					return nil, request.Context().Err()
				}
				body = &inspectorBody{Reader: inspectorReader(func([]byte) (int, error) { <-request.Context().Done(); return 0, request.Context().Err() })}
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: body}, nil
			})}})
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
			defer cancel()
			metadata, err := client.GetInspectorMetadata(ctx)
			if metadata != nil || !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("deadline lost: %+v %v", metadata, err)
			}
			if phase == "body" && (body == nil || !body.closed) {
				t.Fatal("timed-out body left open")
			}
		})
	}
}

func TestInspectorRetainsCallerCancellationAndResponseBound(t *testing.T) {
	client, err := intelligence.New(intelligence.Config{APIKey: "key", HTTPClient: &http.Client{Transport: inspectorTransport(func(request *http.Request) (*http.Response, error) {
		return nil, request.Context().Err()
	})}})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.GetInspectorMetadata(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
	_, err = inspectorPayload(t, `{"schemaVersion":1,"private":"`+strings.Repeat("x", 16<<20)+`"}`)
	var failure *intelligence.Error
	if !errors.As(err, &failure) || failure.Status != 502 {
		t.Fatalf("oversized metadata accepted: %v", err)
	}
}
