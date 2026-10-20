package runtime

import (
	"context"
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

func TestRuntimeInfoSharesSDKEntitlementsAndCompatibilityLicense(t *testing.T) {
	for _, scenario := range []struct {
		name, payload, status, license string
		httpStatus                     int
	}{
		{"active", `{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{}}}`, "ready", "valid", 200},
		{"legacy", `{"organizationId":"org","active":true,"source":"awsMarketplaceDeploymentLicense","features":{},"limits":{}}`, "ready", "valid", 200},
		{"inactive", `{"status":"ready","entitlement":{"active":false,"source":"selfHostedDeploymentLicense","features":{},"limits":{}}}`, "ready", "none", 200},
		{"degraded", `{"status":"degraded","error":{"code":"BUSY","message":"Try later","retryable":true}}`, "degraded", "unknown", 200},
		{"nonretryable", `{"status":"misconfigured","error":{"code":"CONFIG","message":"Set a key","retryable":false}}`, "misconfigured", "none", 200},
		{"forbidden", "private-provider-content", "misconfigured", "none", 403},
		{"malformed", "private-provider-content", "misconfigured", "none", 200},
		{"unavailable", "private-provider-content", "unavailable", "unknown", 503},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			var calls atomic.Int32
			platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Authorization") != "Bearer server-key" {
					t.Error("missing server credential")
				}
				w.WriteHeader(scenario.httpStatus)
				io.WriteString(w, scenario.payload)
			}))
			defer platform.Close()
			sdk, err := intelligence.New(intelligence.Config{APIKey: "server-key", APIURL: platform.URL})
			if err != nil {
				t.Fatal(err)
			}
			defer sdk.Close()
			_, _ = sdk.GetRuntimeEntitlements(context.Background())
			runtime, err := New(Config{Intelligence: sdk, TelemetryDisabled: true, IdentifyUser: func(*http.Request) (User, error) { return User{}, errors.New("no session") }})
			if err != nil {
				t.Fatal(err)
			}
			defer runtime.Close()
			response := httptest.NewRecorder()

			runtime.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/copilotkit/info", nil))
			var result struct {
				RuntimeEntitlements intelligence.RuntimeEntitlementResponse `json:"runtimeEntitlements"`
				LicenseStatus       string                                  `json:"licenseStatus"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if response.Code != 200 || result.RuntimeEntitlements.Status != scenario.status || result.LicenseStatus != scenario.license || calls.Load() != 1 {
				t.Fatalf("wrong shared discovery result: calls=%d body=%s", calls.Load(), response.Body.String())
			}
			if strings.Contains(response.Body.String(), "private-provider-content") {
				t.Fatal("discovery leaked a provider failure")
			}
			if scenario.httpStatus == 403 || scenario.name == "malformed" {
				if result.RuntimeEntitlements.Error.Code != "runtime_entitlements_misconfigured" || result.RuntimeEntitlements.Error.Retryable {
					t.Fatal("wrong configuration failure")
				}
			}
		})
	}
}
