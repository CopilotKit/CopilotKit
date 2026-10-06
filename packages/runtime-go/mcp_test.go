package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMCPSessionCarriesServerAuthenticationAndNegotiatedSession(t *testing.T) {
	methods := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer server-secret" {
			t.Error("missing server credential")
		}
		if r.Method == "DELETE" {
			methods = append(methods, "DELETE")
			if r.Header.Get("Mcp-Session-Id") != "session" {
				t.Error("close missing session")
			}
			w.WriteHeader(204)
			return
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		method := str(body["method"])
		methods = append(methods, method)
		if method == "initialize" {
			w.Header().Set("Mcp-Session-Id", "session")
			json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": body["id"], "result": map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{}, "serverInfo": map[string]any{"name": "test", "version": "1"}}})
			return
		}
		if r.Header.Get("Mcp-Session-Id") != "session" {
			t.Error("missing negotiated session")
		}
		if method == "notifications/initialized" {
			w.WriteHeader(202)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": body["id"], "result": map[string]any{"contents": []any{}}})
	}))
	defer server.Close()
	result, err := mcpRequest(context.Background(), MCPServer{Type: "http", URL: server.URL, Headers: map[string]string{"Authorization": "Bearer server-secret"}}, "resources/read", map[string]any{"uri": "ui://app"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := object(result)["contents"]; !ok {
		t.Fatal(result)
	}
	if len(methods) != 4 || methods[len(methods)-1] != "DELETE" {
		t.Fatal(methods)
	}
}
func TestMCPProxyRejectsUnconfiguredServerBeforeNetworkOrAgent(t *testing.T) {
	called := false
	agent := &uiAgent{next: agentFunc(func(context.Context, map[string]any, func(Event) error) error { called = true; return nil })}
	events := []Event{}
	err := agent.Run(context.Background(), map[string]any{"forwardedProps": map[string]any{"__proxiedMCPRequest": map[string]any{"serverId": "unknown", "method": "resources/read"}}}, func(e Event) error { events = append(events, e); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if called || len(events) != 2 || object(events[1]["result"])["error"] == nil {
		t.Fatalf("called=%v events=%v", called, events)
	}
}
