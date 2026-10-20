package intelligence_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/CopilotKit/CopilotKit/packages/runtime-go/intelligence"
)

func TestEntitlementFailuresRetainCommonSDKErrorClassification(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()
	client, err := intelligence.New(intelligence.Config{APIKey: "key", APIURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	for index := 0; index < 2; index++ {
		_, err := client.GetRuntimeEntitlements(context.Background())
		wrapped := fmt.Errorf("application request: %w", err)
		var common *intelligence.Error
		if !errors.As(wrapped, &common) || common.Status != http.StatusForbidden {
			t.Fatalf("entitlement failure lost common SDK classification: %T %v", err, err)
		}
		var entitlement *intelligence.RuntimeEntitlementError
		if !errors.As(wrapped, &entitlement) || entitlement.Retryable {
			t.Fatal("specialized classification changed")
		}
		common.Status = 200
		var another *intelligence.Error
		if !errors.As(wrapped, &another) || another == common || another.Status != 403 || entitlement.Status != 403 {
			t.Fatal("common error classification exposes shared mutable state")
		}
		if errors.Unwrap(common) != nil || errors.Unwrap(entitlement) != nil {
			t.Fatal("private transport causes must not escape")
		}
		var network *http.ProtocolError
		if errors.As(wrapped, &network) {
			t.Fatal("unrelated error classification matched")
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("failure cache made %d requests", calls.Load())
	}
}
