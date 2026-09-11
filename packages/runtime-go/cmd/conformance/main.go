// Conformance configures the public library for the shared socket-based specification.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	runtime "github.com/CopilotKit/CopilotKit/packages/runtime-go"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	var c struct {
		Port                int                    `json:"port"`
		APIURL              string                 `json:"apiUrl"`
		RunnerURL           string                 `json:"runnerUrl"`
		ClientURL           string                 `json:"clientUrl"`
		APIKey              string                 `json:"apiKey"`
		AgentURL            string                 `json:"agentUrl"`
		TelemetryURL        string                 `json:"telemetryUrl"`
		TelemetrySampleRate *float64               `json:"telemetrySampleRate"`
		TelemetryDisabled   bool                   `json:"telemetryDisabled"`
		TelemetryID         string                 `json:"telemetryId"`
		LicenseToken        string                 `json:"licenseToken"`
		A2UI                *runtime.A2UIConfig    `json:"a2ui"`
		MCPApps             *runtime.MCPAppsConfig `json:"mcpApps"`
		MemoryGrant         json.RawMessage        `json:"memoryGrant"`
		OmitMemoryPolicy    bool                   `json:"omitMemoryPolicy"`
	}
	if err := json.Unmarshal([]byte(os.Getenv("CPK_CONFIG")), &c); err != nil {
		log.Fatal(err)
	}
	var memoryAccess func(*http.Request, runtime.User) (runtime.MemoryGrant, error)
	if !c.OmitMemoryPolicy {
		memoryAccess = func(*http.Request, runtime.User) (runtime.MemoryGrant, error) {
			if len(c.MemoryGrant) != 0 {
				if bytes.Equal(bytes.TrimSpace(c.MemoryGrant), []byte("null")) {
					return runtime.MemoryGrant{}, errors.New("memory access denied")
				}
				var grant runtime.MemoryGrant
				if err := json.Unmarshal(c.MemoryGrant, &grant); err != nil {
					return runtime.MemoryGrant{}, nil
				}
				return grant, nil
			}
			return runtime.MemoryGrant{User: "read-write", Project: "read-write"}, nil
		}
	}
	rt, err := runtime.New(runtime.Config{APIKey: c.APIKey, APIURL: c.APIURL, RunnerURL: c.RunnerURL, ClientURL: c.ClientURL, TelemetryURL: c.TelemetryURL, TelemetrySampleRate: c.TelemetrySampleRate, TelemetryDisabled: c.TelemetryDisabled, TelemetryID: c.TelemetryID, LicenseToken: c.LicenseToken, A2UI: c.A2UI, MCPApps: c.MCPApps, Agents: map[string]runtime.Agent{"default": &runtime.HTTPAgent{URL: c.AgentURL, DescriptionText: "Conformance agent"}}, IdentifyUser: func(r *http.Request) (runtime.User, error) {
		id, name := r.Header.Get("x-test-user-id"), r.Header.Get("x-test-user-name")
		if id == "" {
			id = "test-user"
		}
		if name == "" {
			name = "Test User"
		}
		return runtime.User{ID: id, Name: name}, nil
	}, MemoryAccess: memoryAccess})
	if err != nil {
		log.Fatal(err)
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", c.Port))
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Handler: rt, ReadHeaderTimeout: 5 * time.Second}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"port": listener.Addr().(*net.TCPAddr).Port})
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, syscall.SIGTERM, syscall.SIGINT)
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		<-stopped
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		server.Shutdown(ctx)
		rt.Close()
	}()
	if err = server.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	<-closed
}
