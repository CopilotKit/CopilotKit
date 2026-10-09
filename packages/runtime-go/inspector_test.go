package runtime

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/CopilotKit/CopilotKit/packages/runtime-go/intelligence"
)

func TestRuntimeInspectorMetadataUsesServerCredentialsAndPrivateResponses(t *testing.T) {
	requests := make(chan string, 2)
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		requests <- req.URL.Path
		if req.Header.Get("Authorization") != "Bearer server-key" || req.Header.Get("Cookie") != "" {
			t.Error("browser credentials crossed the platform boundary")
		}
		io.WriteString(w, `{"schemaVersion":1,"plan":{"code":"team","label":"Team","private":"secret"},"private":"secret"}`)
	}))
	defer platform.Close()
	sdk, err := intelligence.New(intelligence.Config{APIKey: "server-key", APIURL: platform.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer sdk.Close()
	runtime, err := New(Config{Intelligence: sdk, TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{}, errors.New("no app-user session") }})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	server := httptest.NewServer(runtime)
	defer server.Close()
	request, _ := http.NewRequest("GET", server.URL+"/copilotkit/inspector-metadata", nil)
	request.Header.Set("Authorization", "Bearer browser-key")
	request.Header.Set("Cookie", "session=browser-cookie")

	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}

	if response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store, private" {
		t.Fatalf("unexpected metadata response: %d %s", response.StatusCode, data)
	}
	var metadata map[string]any
	if json.Unmarshal(data, &metadata) != nil || metadata["schemaVersion"] != float64(1) || metadata["private"] != nil || metadata["plan"].(map[string]any)["private"] != nil {
		t.Fatalf("unsanitized metadata: %s", data)
	}
	if <-requests != "/api/inspector/metadata" {
		t.Fatal("wrong metadata endpoint")
	}
	info, err := server.Client().Get(server.URL + "/copilotkit/info")
	if err != nil {
		t.Fatal(err)
	}
	defer info.Body.Close()
	var discovery map[string]any
	if err := json.NewDecoder(info.Body).Decode(&discovery); err != nil {
		t.Fatal(err)
	}
	if discovery["inspectorMetadata"] != true || <-requests != "/api/entitlements/runtime" {
		t.Fatal("discovery must advertise metadata without fetching it")
	}
}

func TestRuntimeInspectorAbsenceAndErrorsStayPrivate(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		status int
		body   string
		report bool
	}{
		{"no content", 204, "", false}, {"not found", 404, "private-key", false},
		{"forbidden", 403, "private-key", true}, {"unavailable", 503, "private-key", true},
		{"malformed", 200, "private-key", true}, {"unknown schema", 200, `{"schemaVersion":2}`, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.WriteHeader(scenario.status)
				io.WriteString(w, scenario.body)
			}))
			defer platform.Close()
			reports := make(chan RuntimeError, 1)
			runtime, err := New(Config{APIKey: "key", APIURL: platform.URL, TelemetryDisabled: true,
				IdentifyUser: func(*http.Request) (User, error) {
					t.Error("display metadata must not resolve an app user")
					return User{}, errors.New("no user")
				},
				OnError: func(event RuntimeError) { reports <- event },
			})
			if err != nil {
				t.Fatal(err)
			}
			defer runtime.Close()
			server := httptest.NewServer(runtime)
			defer server.Close()

			response, err := server.Client().Get(server.URL + "/copilotkit/inspector-metadata")
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}

			if response.StatusCode != 204 || len(body) != 0 || response.Header.Get("Cache-Control") != "no-store, private" {
				t.Fatalf("provider details escaped: %d %s", response.StatusCode, body)
			}
			if scenario.report {
				select {
				case event := <-reports:
					if event.Operation != "inspector.metadata" || event.Err == nil || strings.Contains(event.Err.Error(), "private-key") {
						t.Fatalf("unsafe or missing diagnostic: %+v", event)
					}
				default:
					t.Fatal("provider failure did not reach OnError")
				}
			} else if len(reports) != 0 {
				t.Fatal("compatible absence must not report failure")
			}
		})
	}
}

func TestRuntimeInspectorWrongMethodsHaveNoProviderSideEffects(t *testing.T) {
	var calls atomic.Int32
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) { calls.Add(1); io.WriteString(w, `{"schemaVersion":1}`) }))
	defer platform.Close()
	runtime, err := New(Config{APIKey: "key", APIURL: platform.URL, TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) {
		t.Error("wrong method resolved an app user")
		return User{}, errors.New("no user")
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	server := httptest.NewServer(runtime)
	defer server.Close()

	for _, method := range []string{"POST", "PATCH", "PUT", "DELETE"} {
		request, err := http.NewRequest(method, server.URL+"/copilotkit/inspector-metadata", nil)
		if err != nil {
			t.Fatal(err)
		}
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 405 || response.Header.Get("Allow") != "GET" {
			t.Fatalf("wrong method response: %s %d", method, response.StatusCode)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("wrong method reached the platform")
	}
}
