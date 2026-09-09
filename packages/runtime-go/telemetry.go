package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"time"
)

var telemetryIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func (r *Runtime) capture(event string, properties map[string]any) {
	if r.config.TelemetryDisabled || os.Getenv("DO_NOT_TRACK") == "true" || os.Getenv("DO_NOT_TRACK") == "1" || os.Getenv("COPILOTKIT_TELEMETRY_DISABLED") == "true" || os.Getenv("COPILOTKIT_TELEMETRY_DISABLED") == "1" {
		return
	}
	endpoint := r.config.TelemetryURL
	if endpoint == "" {
		endpoint = os.Getenv("COPILOTKIT_TELEMETRY_URL")
	}
	if endpoint == "" {
		endpoint = "https://telemetry.copilotkit.ai/ingest"
	}
	// Fixed schema: event attributes are internal counters/statuses, never request content.
	body, _ := json.Marshal(map[string]any{"event": event, "properties": properties, "global_properties": map[string]any{"runtime_language": "go", "telemetry_emitter": "runtime-go", "telemetry_transport": "lambda"}, "package": map[string]any{"name": "copilotkit-runtime-go", "version": "0.1.0"}, "ts": time.Now().Unix()})
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ctx, cancel := context.WithTimeout(r.ctx, 3*time.Second)
		defer cancel()
		req, e := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(body))
		if e != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		if telemetryIDPattern.MatchString(r.config.TelemetryID) {
			req.Header.Set("X-CopilotKit-Telemetry-Id", r.config.TelemetryID)
		}
		res, e := r.client.Do(req)
		if e == nil {
			res.Body.Close()
		}
	}()
}
