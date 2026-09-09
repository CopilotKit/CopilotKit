package runtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type telemetryWire struct {
	body    []byte
	headers http.Header
}

func telemetryLicense(payload string) string {
	return "unverified-header." + base64.RawURLEncoding.EncodeToString([]byte(payload)) + ".unverified-signature"
}

func licenseTelemetryFixture(t *testing.T, config Config) (*telemetryExporter, <-chan telemetryWire) {
	t.Helper()
	received := make(chan telemetryWire, 8)
	sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received <- telemetryWire{body: body, headers: r.Header.Clone()}
		w.WriteHeader(202)
	}))
	t.Cleanup(sink.Close)
	config.TelemetryURL = sink.URL
	exporter, err := newTelemetry(config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(exporter.close)
	return exporter, received
}

func TestLicenseTelemetryEnvironmentBypassesSamplingWithoutLeakingToken(t *testing.T) {
	token := telemetryLicense(`{"telemetry_id":" license-identity ","private_claim":"must-not-leak"}`)
	t.Setenv("COPILOTKIT_LICENSE_TOKEN", token)
	t.Setenv("CPK_TELEMETRY_ID", "")
	t.Setenv("COPILOTKIT_TELEMETRY_SAMPLE_RATE", "0")
	exporter, received := licenseTelemetryFixture(t, Config{})

	exporter.capture("oss.runtime.instance_created", map[string]any{})
	if err := exporter.flush(context.Background()); err != nil {
		t.Fatal(err)
	}

	select {
	case wire := <-received:
		if wire.headers.Get("X-CopilotKit-Telemetry-Id") != "license-identity" {
			t.Fatal(wire.headers)
		}
		var body map[string]any
		if err := json.Unmarshal(wire.body, &body); err != nil {
			t.Fatal(err)
		}
		metadata := object(body["global_properties"])
		if metadata["sampleRate"] != float64(1) || metadata["sampleRateAdjustmentFactor"] != float64(0) || metadata["sampleWeight"] != float64(1) || metadata["telemetry_identified"] != true {
			t.Fatal(metadata)
		}
		headers, _ := json.Marshal(wire.headers)
		for _, secret := range []string{token, "must-not-leak", "license-identity"} {
			if strings.Contains(string(wire.body), secret) {
				t.Fatal("telemetry body exposed identity or license data")
			}
		}
		if strings.Contains(string(headers), token) || strings.Contains(string(headers), "must-not-leak") {
			t.Fatal("headers exposed raw license")
		}
	default:
		t.Fatal("valid license telemetry claim did not bypass zero sampling")
	}
}

func TestLicenseTelemetryIdentityPrecedenceAndAnonymousSampling(t *testing.T) {
	license := telemetryLicense(`{"telemetry_id":"explicit-license"}`)
	environmentLicense := telemetryLicense(`{"telemetry_id":"environment-license"}`)
	for _, scenario := range []struct {
		name, standalone, environmentID, token, identity string
		rate                                             float64
		identified                                       bool
	}{
		{"explicit-standalone-wins", "standalone", "environment-id", license, "standalone", 0, false},
		{"environment-standalone-wins", "", "environment-id", license, "environment-id", 0, false},
		{"explicit-license-wins", "", "", license, "explicit-license", 1, true},
		{"blank-license-falls-back", "", "", " \t ", "environment-license", 1, true},
		{"invalid-explicit-license-stays-anonymous", "", "", "malformed", "", 0, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			t.Setenv("COPILOTKIT_LICENSE_TOKEN", environmentLicense)
			t.Setenv("CPK_TELEMETRY_ID", scenario.environmentID)
			t.Setenv("COPILOTKIT_TELEMETRY_SAMPLE_RATE", "0")
			exporter, received := licenseTelemetryFixture(t, Config{TelemetryID: scenario.standalone, LicenseToken: scenario.token})
			exporter.capture("oss.runtime.instance_created", map[string]any{})
			if err := exporter.flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			if exporter.identity != scenario.identity || exporter.rate != scenario.rate || exporter.identified != scenario.identified {
				t.Fatalf("identity=%q rate=%v identified=%v", exporter.identity, exporter.rate, exporter.identified)
			}
			if (len(received) > 0) != scenario.identified {
				t.Fatal("standalone identity bypassed sampling or license claim did not")
			}
		})
	}
}

func TestLicenseTelemetryParserRejectsMalformedOrUnsafeClaims(t *testing.T) {
	for _, token := range []string{"", "a.b", "a.b.c.d", "a.A.c", "a.e30=.c", "a.e3\n0.c",
		telemetryLicense(`not-json`), telemetryLicense(`null`), telemetryLicense(`[]`), telemetryLicense(`{}`),
		telemetryLicense(`{"telemetry_id":42}`), telemetryLicense(`{"telemetry_id":null}`),
		telemetryLicense(`{"telemetry_id":" "}`), telemetryLicense(`{"telemetry_id":"unsafe\r\nheader"}`),
		telemetryLicense(`{"telemetry_id":"` + strings.Repeat("a", 129) + `"}`),
	} {
		if identity := licenseTelemetryIdentity(token); identity != "" {
			t.Fatalf("malformed token yielded identity %q", identity)
		}
	}
	if identity := licenseTelemetryIdentity(telemetryLicense(`{"telemetry_id":"\t valid_123-ID \t"}`)); identity != "valid_123-ID" {
		t.Fatal(identity)
	}
}

func TestLicenseTelemetryGlobalOptOutWins(t *testing.T) {
	for _, scenario := range []struct {
		name, key, value string
		disabled         bool
	}{
		{"explicit-disable", "DO_NOT_TRACK", "", true},
		{"do-not-track-true", "DO_NOT_TRACK", "true", false},
		{"do-not-track-one", "DO_NOT_TRACK", "1", false},
		{"disabled-true", "COPILOTKIT_TELEMETRY_DISABLED", "true", false},
		{"disabled-one", "COPILOTKIT_TELEMETRY_DISABLED", "1", false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			t.Setenv("COPILOTKIT_LICENSE_TOKEN", telemetryLicense(`{"telemetry_id":"license"}`))
			t.Setenv("CPK_TELEMETRY_ID", "")
			t.Setenv("COPILOTKIT_TELEMETRY_SAMPLE_RATE", "0")
			t.Setenv(scenario.key, scenario.value)
			exporter, received := licenseTelemetryFixture(t, Config{TelemetryDisabled: scenario.disabled})
			exporter.capture("oss.runtime.instance_created", map[string]any{})
			if err := exporter.flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			if len(received) != 0 {
				t.Fatal("license bypassed global opt-out")
			}
		})
	}
}

func TestLicenseTelemetryBlankFallbackMatchesJavaScriptWhitespace(t *testing.T) {
	for _, scenario := range []struct {
		name, token, identity string
	}{
		{"bom-is-blank", "\uFEFF", "environment-license"},
		{"nel-is-not-blank", "\u0085", ""},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			t.Setenv("COPILOTKIT_LICENSE_TOKEN", telemetryLicense(`{"telemetry_id":"environment-license"}`))
			t.Setenv("CPK_TELEMETRY_ID", "")
			t.Setenv("COPILOTKIT_TELEMETRY_SAMPLE_RATE", "0")
			exporter, received := licenseTelemetryFixture(t, Config{LicenseToken: scenario.token})

			exporter.capture("oss.runtime.instance_created", map[string]any{})
			if err := exporter.flush(context.Background()); err != nil {
				t.Fatal(err)
			}

			if exporter.identity != scenario.identity {
				t.Fatalf("identity=%q, expected %q", exporter.identity, scenario.identity)
			}
			if (len(received) > 0) != (scenario.identity != "") {
				t.Fatal("license whitespace changed the sampling decision")
			}
		})
	}
}
