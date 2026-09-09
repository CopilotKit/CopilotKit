package runtime

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/CopilotKit/CopilotKit/packages/runtime-go/intelligence"
)

func TestRuntimeBorrowsIntelligenceClient(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" || r.Header.Get("X-Cpki-User-Id") != "customer" {
			t.Error("trusted SDK identity missing")
		}
		w.Write([]byte(`{"memories":[]}`))
	}))
	defer server.Close()
	sdk, err := intelligence.New(intelligence.Config{APIKey: "secret", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer sdk.Close()
	runtime, err := New(Config{Intelligence: sdk, IdentifyUser: func(*http.Request) (User, error) { return User{ID: "customer", Name: "Customer"}, nil }, TelemetryDisabled: true})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	runtime.ServeHTTP(response, httptest.NewRequest("GET", "/copilotkit/memories", nil))
	if response.Code != 200 {
		t.Fatalf("SDK-backed Runtime failed: %d %s", response.Code, response.Body.String())
	}
	if err = runtime.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = sdk.ListMemories(context.Background(), intelligence.ListMemoriesParams{UserID: "customer"}); err != nil {
		t.Fatal(err)
	}
}
