package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type describedAgent struct{}

func (describedAgent) Run(context.Context, map[string]any, func(Event) error) error { return nil }
func (describedAgent) Description() string                                          { return "Native agent description" }

func TestInfoIncludesOptionalAgentDescription(t *testing.T) {
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { json.NewEncoder(w).Encode(map[string]any{}) }))
	t.Cleanup(platform.Close)
	rt, err := New(Config{APIKey: "secret", APIURL: platform.URL, TelemetryDisabled: true,
		IdentifyUser: func(*http.Request) (User, error) { return User{ID: "user", Name: "User"}, nil },
		Agents:       map[string]Agent{"described": describedAgent{}, "run-only": lifecycleAgent(func(context.Context, map[string]any, func(Event) error) error { return nil })}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { rt.Close() })
	response := httptest.NewRecorder()
	rt.ServeHTTP(response, httptest.NewRequest("GET", "/copilotkit/info", nil))
	var info map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	agents := object(info["agents"])
	if object(agents["described"])["description"] != "Native agent description" {
		t.Fatal("info lost the optional agent description")
	}
	if object(agents["run-only"])["description"] != "" {
		t.Fatal("Run-only agents must remain supported")
	}
}
