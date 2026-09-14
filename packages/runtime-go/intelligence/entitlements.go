package intelligence

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"net/http"
	"slices"
	"sync"
	"time"
)

// RuntimeEntitlement contains the project's current Runtime grant.
type RuntimeEntitlement struct {
	Active            bool               `json:"active"`
	Source            string             `json:"source"`
	Features          map[string]bool    `json:"features"`
	Limits            map[string]float64 `json:"limits"`
	PlanCode          *string            `json:"planCode,omitempty"`
	EntitlementSource *string            `json:"entitlementSource,omitempty"`
}

// RuntimeEntitlementProblem describes a structured non-ready response.
type RuntimeEntitlementProblem struct {
	Code      string  `json:"code"`
	Message   string  `json:"message"`
	Retryable bool    `json:"retryable"`
	RequestID *string `json:"requestId,omitempty"`
	TraceID   *string `json:"traceId,omitempty"`
}

// RuntimeEntitlementResponse is ready with Entitlement, or non-ready with Error.
type RuntimeEntitlementResponse struct {
	Status      string                     `json:"status"`
	Entitlement *RuntimeEntitlement        `json:"entitlement,omitempty"`
	Error       *RuntimeEntitlementProblem `json:"error,omitempty"`
}

// RuntimeEntitlementError classifies a lookup failure without private transport details.
type RuntimeEntitlementError struct {
	Status    int
	Retryable bool
}

// Error returns a message without response bodies or transport details.
func (e *RuntimeEntitlementError) Error() string { return "Runtime entitlement request failed" }

// As preserves common SDK error classification without exposing a transport cause.
// Each match receives its own status copy, so callers cannot change cached errors.
func (e *RuntimeEntitlementError) As(target any) bool {
	common, ok := target.(**Error)
	if !ok {
		return false
	}
	*common = &Error{Status: e.Status}
	return true
}

type entitlementState struct {
	mu       sync.Mutex
	expires  time.Time
	response *RuntimeEntitlementResponse
	err      *RuntimeEntitlementError
	flight   *entitlementFlight
}

type entitlementFlight struct {
	done     chan struct{}
	cancel   context.CancelFunc
	waiters  int
	response *RuntimeEntitlementResponse
	err      *RuntimeEntitlementError
}

// GetRuntimeEntitlements reads the project's Runtime entitlement without mounting routes.
// Concurrent callers share a request with a 1.5-second deadline. Each caller can cancel
// independently. Active grants cache for 30 seconds; other results and failures cache
// for five seconds. Every caller receives an independent copy.
func (c *Client) GetRuntimeEntitlements(ctx context.Context) (*RuntimeEntitlementResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	state := &c.entitlements
	state.mu.Lock()
	if time.Now().Before(state.expires) {
		response, err := cloneEntitlementResult(state.response, state.err)
		state.mu.Unlock()
		return response, err
	}
	flight := state.flight
	if flight == nil {
		requestContext, cancel := context.WithCancel(context.WithoutCancel(ctx))
		flight = &entitlementFlight{done: make(chan struct{}), cancel: cancel}
		state.flight = flight
		go c.resolveRuntimeEntitlements(requestContext, flight)
	}
	flight.waiters++
	state.mu.Unlock()
	select {
	case <-ctx.Done():
		state.mu.Lock()
		flight.waiters--
		if flight.waiters == 0 && state.flight == flight {
			state.flight = nil
			flight.cancel()
		}
		state.mu.Unlock()
		return nil, ctx.Err()
	case <-flight.done:
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return cloneEntitlementResult(flight.response, flight.err)
	}
}

// resolveRuntimeEntitlements shares one bounded lookup and caches only a still-needed result.
func (c *Client) resolveRuntimeEntitlements(ctx context.Context, flight *entitlementFlight) {
	defer flight.cancel()
	response, err := c.fetchRuntimeEntitlements(ctx)
	var failure *RuntimeEntitlementError
	if err != nil {
		errors.As(err, &failure)
	}
	state := &c.entitlements
	state.mu.Lock()
	defer state.mu.Unlock()
	flight.response, flight.err = response, failure
	if state.flight == flight {
		ttl := 5 * time.Second
		if response != nil && response.Entitlement != nil && response.Entitlement.Active {
			ttl = 30 * time.Second
		}
		state.response, state.err, state.expires = response, failure, time.Now().Add(ttl)
		state.flight = nil
	}
	close(flight.done)
}

// cloneEntitlementResult isolates every caller from cached authority and error state.
func cloneEntitlementResult(response *RuntimeEntitlementResponse, failure *RuntimeEntitlementError) (*RuntimeEntitlementResponse, error) {
	if failure != nil {
		copied := *failure
		return nil, &copied
	}
	if response == nil {
		return nil, nil
	}
	copied := *response
	if response.Entitlement != nil {
		grant := *response.Entitlement
		grant.Features, grant.Limits = maps.Clone(grant.Features), maps.Clone(grant.Limits)
		grant.PlanCode, grant.EntitlementSource = cloneEntitlementString(grant.PlanCode), cloneEntitlementString(grant.EntitlementSource)
		copied.Entitlement = &grant
	}
	if response.Error != nil {
		problem := *response.Error
		problem.RequestID, problem.TraceID = cloneEntitlementString(problem.RequestID), cloneEntitlementString(problem.TraceID)
		copied.Error = &problem
	}
	return &copied, nil
}

// cloneEntitlementString copies optional fields without changing absent values.
func cloneEntitlementString(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

// fetchRuntimeEntitlements bounds the complete exchange and never reads rejected bodies.
func (c *Client) fetchRuntimeEntitlements(ctx context.Context) (*RuntimeEntitlementResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.config.APIURL+"/api/entitlements/runtime", nil)
	if err != nil {
		return nil, &RuntimeEntitlementError{Status: 502, Retryable: false}
	}
	request.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, entitlementTransportError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		status := response.StatusCode
		return nil, &RuntimeEntitlementError{Status: status, Retryable: status == 408 || status == 425 || status == 429 || status >= 500}
	}
	const maxBody = 16 << 20
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxBody+1))
	if err != nil {
		return nil, entitlementTransportError(err)
	}
	if len(raw) > maxBody {
		return nil, &RuntimeEntitlementError{Status: 502, Retryable: false}
	}
	return parseRuntimeEntitlements(raw)
}

// entitlementTransportError exposes classification, not the transport's error text or cause.
func entitlementTransportError(err error) *RuntimeEntitlementError {
	if errors.Is(err, context.DeadlineExceeded) {
		return &RuntimeEntitlementError{Status: 504, Retryable: true}
	}
	return &RuntimeEntitlementError{Status: 502, Retryable: true}
}

// parseRuntimeEntitlements validates current and legacy authority envelopes.
func parseRuntimeEntitlements(raw []byte) (*RuntimeEntitlementResponse, error) {
	malformed := &RuntimeEntitlementError{Status: 502, Retryable: false}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return nil, malformed
	}
	status, hasStatus := object["status"]
	if !hasStatus {
		if _, ok := object["organizationId"].(string); !ok {
			return nil, malformed
		}
		delete(object, "organizationId")
		object = map[string]any{"status": "ready", "entitlement": object}
		status = "ready"
	}
	result := &RuntimeEntitlementResponse{}
	switch status {
	case "ready":
		if !entitlementFields(object, "status", "entitlement") {
			return nil, malformed
		}
		grant, ok := object["entitlement"].(map[string]any)
		if !ok || !entitlementFields(grant, "active", "source", "features", "limits", "planCode", "entitlementSource") {
			return nil, malformed
		}
		active, validActive := grant["active"].(bool)
		source, validSource := grant["source"].(string)
		features, validFeatures := grant["features"].(map[string]any)
		limits, validLimits := grant["limits"].(map[string]any)
		if !validActive || !validSource || !validFeatures || !validLimits || !slices.Contains([]string{"managedOrgSubscription", "selfHostedDeploymentLicense", "awsMarketplaceDeploymentLicense"}, source) {
			return nil, malformed
		}
		parsed := &RuntimeEntitlement{Active: active, Source: source, Features: map[string]bool{}, Limits: map[string]float64{}}
		for key, value := range features {
			flag, ok := value.(bool)
			if !ok {
				return nil, malformed
			}
			parsed.Features[key] = flag
		}
		for key, value := range limits {
			number, ok := value.(float64)
			if !ok {
				return nil, malformed
			}
			parsed.Limits[key] = number
		}
		if !entitlementOptionalString(grant, "planCode", &parsed.PlanCode) || !entitlementOptionalString(grant, "entitlementSource", &parsed.EntitlementSource) {
			return nil, malformed
		}
		result.Status, result.Entitlement = "ready", parsed
	case "degraded", "misconfigured", "unavailable":
		if !entitlementFields(object, "status", "error") {
			return nil, malformed
		}
		problem, ok := object["error"].(map[string]any)
		if !ok || !entitlementFields(problem, "code", "message", "retryable", "requestId", "traceId") {
			return nil, malformed
		}
		code, validCode := problem["code"].(string)
		message, validMessage := problem["message"].(string)
		retryable, validRetryable := problem["retryable"].(bool)
		if !validCode || !validMessage || !validRetryable {
			return nil, malformed
		}
		parsed := &RuntimeEntitlementProblem{Code: code, Message: message, Retryable: retryable}
		if !entitlementOptionalString(problem, "requestId", &parsed.RequestID) || !entitlementOptionalString(problem, "traceId", &parsed.TraceID) {
			return nil, malformed
		}
		result.Status, result.Error = status.(string), parsed
	default:
		return nil, malformed
	}
	return result, nil
}

// entitlementFields rejects fields outside the published authority contract.
func entitlementFields(object map[string]any, allowed ...string) bool {
	for key := range object {
		if !slices.Contains(allowed, key) {
			return false
		}
	}
	return true
}

// entitlementOptionalString distinguishes an absent string from a null value.
func entitlementOptionalString(object map[string]any, key string, result **string) bool {
	value, present := object[key]
	if !present {
		return true
	}
	text, valid := value.(string)
	if valid {
		*result = &text
	}
	return valid
}
