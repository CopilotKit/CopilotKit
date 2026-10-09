package runtime

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRESTReadsDoNotSendJSONNullBodies(t *testing.T) {
	for _, path := range []string{"/copilotkit/threads?agentId=default", "/copilotkit/memories"} {
		t.Run(path, func(t *testing.T) {
			platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				body, err := io.ReadAll(req.Body)
				if err != nil || len(body) != 0 {
					t.Errorf("GET body = %q, read error = %v", body, err)
					http.Error(w, "GET requests must not have a JSON body", http.StatusBadRequest)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(`{"threads":[],"memories":[]}`))
			}))
			defer platform.Close()
			runtime, err := New(Config{
				APIKey: "fixture", APIURL: platform.URL, TelemetryDisabled: true,
				IdentifyUser: func(*http.Request) (User, error) { return User{ID: "u", Name: "User"}, nil },
			})
			if err != nil {
				t.Fatal(err)
			}
			defer runtime.Close()
			response := httptest.NewRecorder()

			runtime.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d", response.Code)
			}
		})
	}
}
