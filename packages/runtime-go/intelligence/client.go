// Package intelligence provides the Intelligence SDK without Runtime handlers or agents.
package intelligence

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Config contains server-owned credentials and an optional borrowed HTTP client.
type Config struct {
	APIKey                       string `json:"-"`
	APIURL, RunnerURL, ClientURL string
	HTTPClient                   *http.Client `json:"-"`
}

// Error retains the platform status without disclosing its response body.
type Error struct {
	Status int
	cause  error
}

func (e *Error) Error() string { return "Intelligence request failed" }

// Unwrap preserves cancellation and transport error classification.
func (e *Error) Unwrap() error { return e.cause }

// Access is one memory permission in the platform contract.
type Access string

const (
	None      Access = "none"
	Read      Access = "read"
	ReadWrite Access = "read-write"
)

// MemoryGrant limits user and project memory access for a trusted caller.
type MemoryGrant struct {
	User    Access `json:"user"`
	Project Access `json:"project"`
}

// Thread is the platform's canonical thread metadata.
type Thread struct {
	ID             string  `json:"id"`
	Name           *string `json:"name"`
	AgentID        string  `json:"agentId,omitempty"`
	CreatedByID    string  `json:"createdById,omitempty"`
	OrganizationID string  `json:"organizationId,omitempty"`
	CreatedAt      string  `json:"createdAt,omitempty"`
	UpdatedAt      string  `json:"updatedAt,omitempty"`
	LastRunAt      string  `json:"lastRunAt,omitempty"`
	LastUpdatedAt  string  `json:"lastUpdatedAt,omitempty"`
	Archived       bool    `json:"archived,omitempty"`
}

// ThreadList retains metadata subscription credentials and pagination.
type ThreadList struct {
	Threads    []Thread `json:"threads"`
	JoinCode   string   `json:"joinCode"`
	JoinToken  string   `json:"joinToken,omitempty"`
	NextCursor *string  `json:"nextCursor,omitempty"`
}

// Memory is a fact with its scope, source threads, and optional recall score.
type Memory struct {
	ID              string   `json:"id"`
	Kind            string   `json:"kind"`
	Scope           string   `json:"scope"`
	Content         string   `json:"content"`
	SourceThreadIDs []string `json:"sourceThreadIds"`
	InvalidatedAt   *string  `json:"invalidatedAt"`
	Score           *float64 `json:"score,omitempty"`
}

// MemoryList is the platform's list or recall envelope.
type MemoryList struct {
	Memories []Memory `json:"memories"`
}

// SavedMemory includes the platform's create or supersede markers.
type SavedMemory struct {
	Memory
	Absorbed  bool   `json:"absorbed,omitempty"`
	RetiredID string `json:"retiredId,omitempty"`
}

// ListMemoriesParams keeps caller identity separate from query filters.
type ListMemoriesParams struct {
	UserID             string
	IncludeInvalidated bool
	Grant              *MemoryGrant
}

// SaveMemoryParams supplies content and an optional explicit access grant.
type SaveMemoryParams struct {
	UserID, Content, Kind, Scope string
	SourceThreadIDs              []string
	Grant                        *MemoryGrant
}

// RecallMemoriesParams supplies the semantic query and platform scope filter.
type RecallMemoriesParams struct {
	UserID, Query, Scope string
	Limit                int
	Grant                *MemoryGrant
}

// CreateThreadParams assigns a new thread to an optional stable Learning Container ID.
type CreateThreadParams struct{ ThreadID, UserID, AgentID, Name, LearningContainerID string }

// ListThreadsParams selects one user's threads for one agent.
type ListThreadsParams struct {
	UserID, AgentID, Cursor string
	Limit                   int
	IncludeArchived         bool
}

// AnnotationParams identifies an idempotent annotation. Empty ClientEventID requests a new ID.
type AnnotationParams struct {
	UserID, ThreadID, Type, ClientEventID, OccurredAt string
	Payload                                           map[string]any
}

// AnnotationResult retains the idempotent-write result.
type AnnotationResult struct {
	ID        string `json:"id"`
	Duplicate bool   `json:"duplicate,omitempty"`
}

// Client is a reusable, context-aware SDK client. It owns no HTTP server.
type Client struct {
	config       Config
	httpClient   *http.Client
	owned        bool
	created      listeners[Thread]
	updated      listeners[Thread]
	deleted      listeners[ThreadDeletedPayload]
	entitlements entitlementState
}

// New validates credentials and endpoints without making network requests.
func New(config Config) (*Client, error) {
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, errors.New("APIKey is required")
	}
	if config.APIURL == "" {
		config.APIURL = "https://api.intelligence.copilotkit.ai"
	}
	if config.RunnerURL == "" {
		config.RunnerURL = "wss://realtime.intelligence.copilotkit.ai/runner"
	}
	if config.ClientURL == "" {
		config.ClientURL = "wss://realtime.intelligence.copilotkit.ai/client"
	}
	for _, endpoint := range []struct {
		raw     string
		schemes []string
	}{{config.APIURL, []string{"http", "https"}}, {config.RunnerURL, []string{"ws", "wss"}}, {config.ClientURL, []string{"ws", "wss"}}} {
		u, err := url.Parse(endpoint.raw)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != endpoint.schemes[0] && u.Scheme != endpoint.schemes[1]) {
			return nil, errors.New("invalid Intelligence endpoint URL")
		}
	}
	config.APIURL = strings.TrimRight(config.APIURL, "/")
	owned := false
	var client http.Client
	if config.HTTPClient == nil {
		client = http.Client{Transport: http.DefaultTransport, Timeout: 20 * time.Second}
		if transport, ok := http.DefaultTransport.(*http.Transport); ok {
			client.Transport = transport.Clone()
			owned = true
		}
	} else {
		client = *config.HTTPClient
		if client.Timeout == 0 {
			client.Timeout = 20 * time.Second
		}
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Client{config: config, httpClient: &client, owned: owned}, nil
}

// Configuration returns a copy for Runtime wiring; APIKey remains server-only.
func (c *Client) Configuration() Config {
	config := c.config
	config.HTTPClient = c.httpClient
	return config
}

// Close cancels entitlement lookups, clears their cache, and releases owned idle connections.
// Borrowed transports stay usable.
func (c *Client) Close() {
	c.entitlements.mu.Lock()
	if c.entitlements.flight != nil {
		c.entitlements.flight.cancel()
		c.entitlements.flight = nil
	}
	c.entitlements.response, c.entitlements.err = nil, nil
	c.entitlements.expires = time.Time{}
	c.entitlements.mu.Unlock()
	if c.owned {
		c.httpClient.CloseIdleConnections()
	}
}

// Request is the shared authenticated platform transport used by Runtime adapters.
func (c *Client) Request(ctx context.Context, method, path string, body any, headers map[string]string) (json.RawMessage, error) {
	return c.request(ctx, method, path, body, headers)
}

// request closes explicitly absent responses before reading their bodies.
func (c *Client) request(ctx context.Context, method, path string, body any, headers map[string]string, absentStatuses ...int) (json.RawMessage, error) {
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return nil, &Error{Status: 400}
	}
	var reader io.Reader
	var encodedBody []byte
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, &Error{Status: 400, cause: err}
		}
		reader = bytes.NewReader(encoded)
		encodedBody = encoded
	}
	request, err := http.NewRequestWithContext(ctx, method, c.config.APIURL+path, reader)
	if err != nil {
		return nil, &Error{Status: 400, cause: err}
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	request.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, &Error{Status: 502, cause: err}
	}
	defer response.Body.Close()
	for _, status := range absentStatuses {
		if response.StatusCode == status {
			return nil, nil
		}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &Error{Status: response.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (16<<20)+1))
	if err != nil {
		return nil, &Error{Status: 502, cause: err}
	}
	if len(data) > 16<<20 {
		return nil, &Error{Status: 502}
	}
	if len(data) != 0 && !json.Valid(data) {
		return nil, &Error{Status: 502}
	}
	c.notifyThreadMutation(method, path, encodedBody, data)
	return data, nil
}

func object[T any](ctx context.Context, c *Client, method, path string, body any, headers map[string]string) (*T, error) {
	raw, err := c.Request(ctx, method, path, body, headers)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "null" {
		return nil, &Error{Status: 502}
	}
	var result T
	if err = json.Unmarshal(raw, &result); err != nil {
		return nil, &Error{Status: 502, cause: err}
	}
	return &result, nil
}
func memoryHeaders(userID string, grant *MemoryGrant) (map[string]string, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("UserID is required")
	}
	headers := map[string]string{"X-Cpki-User-Id": userID}
	if grant != nil {
		valid := func(access Access) bool { return access == None || access == Read || access == ReadWrite }
		if !valid(grant.User) || !valid(grant.Project) {
			return nil, errors.New("invalid memory grant")
		}
		data, _ := json.Marshal(grant)
		headers["X-Cpki-Memory-Grant"] = string(data)
	}
	return headers, nil
}

// ListMemories lists current memories, or includes retired records when requested.
func (c *Client) ListMemories(ctx context.Context, params ListMemoriesParams) (*MemoryList, error) {
	headers, err := memoryHeaders(params.UserID, params.Grant)
	if err != nil {
		return nil, err
	}
	path := "/api/memories"
	if params.IncludeInvalidated {
		path += "?includeInvalidated=true"
	}
	return object[MemoryList](ctx, c, "GET", path, nil, headers)
}

// CreateMemory saves content and retains the platform's absorbed marker.
func (c *Client) CreateMemory(ctx context.Context, params SaveMemoryParams) (*SavedMemory, error) {
	return c.saveMemory(ctx, "POST", "/api/memories", params)
}

// UpdateMemory supersedes a memory and returns the replacement and retired ID.
func (c *Client) UpdateMemory(ctx context.Context, memoryID string, params SaveMemoryParams) (*SavedMemory, error) {
	return c.saveMemory(ctx, "PATCH", "/api/memories/"+url.PathEscape(memoryID), params)
}
func (c *Client) saveMemory(ctx context.Context, method, path string, params SaveMemoryParams) (*SavedMemory, error) {
	headers, err := memoryHeaders(params.UserID, params.Grant)
	if err != nil {
		return nil, err
	}
	sources := params.SourceThreadIDs
	if sources == nil {
		sources = []string{}
	}
	body := map[string]any{"content": params.Content, "kind": params.Kind, "sourceThreadIds": sources}
	if params.Scope != "" {
		body["scope"] = params.Scope
	}
	return object[SavedMemory](ctx, c, method, path, body, headers)
}

// RemoveMemory retires a memory without deleting its history.
func (c *Client) RemoveMemory(ctx context.Context, memoryID, userID string, grant *MemoryGrant) error {
	headers, err := memoryHeaders(userID, grant)
	if err != nil {
		return err
	}
	_, err = c.Request(ctx, "DELETE", "/api/memories/"+url.PathEscape(memoryID), nil, headers)
	return err
}

// RecallMemories performs semantic recall with platform relevance scores.
func (c *Client) RecallMemories(ctx context.Context, params RecallMemoriesParams) (*MemoryList, error) {
	headers, err := memoryHeaders(params.UserID, params.Grant)
	if err != nil {
		return nil, err
	}
	body := map[string]any{"query": params.Query}
	if params.Scope != "" {
		body["scope"] = params.Scope
	}
	if params.Limit != 0 {
		body["limit"] = params.Limit
	}
	return object[MemoryList](ctx, c, "POST", "/api/memories/recall", body, headers)
}

// ListThreads returns thread metadata and the next-page cursor without consuming it.
func (c *Client) ListThreads(ctx context.Context, params ListThreadsParams) (*ThreadList, error) {
	q := url.Values{"userId": {params.UserID}, "agentId": {params.AgentID}}
	if params.Cursor != "" {
		q.Set("cursor", params.Cursor)
	}
	if params.Limit != 0 {
		q.Set("limit", strconv.Itoa(params.Limit))
	}
	if params.IncludeArchived {
		q.Set("includeArchived", "true")
	}
	return object[ThreadList](ctx, c, "GET", "/api/threads?"+q.Encode(), nil, nil)
}
func (c *Client) thread(ctx context.Context, method, path string, body any) (*Thread, error) {
	result, err := object[struct {
		Thread *Thread `json:"thread"`
	}](ctx, c, method, path, body, nil)
	if err != nil {
		return nil, err
	}
	if result.Thread == nil || result.Thread.ID == "" {
		return nil, &Error{Status: 502}
	}
	return result.Thread, nil
}

// GetThread reads a canonical thread with explicit user scope.
func (c *Client) GetThread(ctx context.Context, threadID, userID string) (*Thread, error) {
	return c.thread(ctx, "GET", "/api/threads/"+url.PathEscape(threadID)+"?"+url.Values{"userId": {userID}}.Encode(), nil)
}

// CreateThread creates a thread and optionally assigns its Learning Container.
func (c *Client) CreateThread(ctx context.Context, params CreateThreadParams) (*Thread, error) {
	body := map[string]any{"threadId": params.ThreadID, "userId": params.UserID, "agentId": params.AgentID}
	if params.Name != "" {
		body["name"] = params.Name
	}
	if params.LearningContainerID != "" {
		body["learningContainerId"] = params.LearningContainerID
	}
	return c.thread(ctx, "POST", "/api/threads", body)
}

// GetOrCreateThread returns the canonical thread and whether this call created it.
func (c *Client) GetOrCreateThread(ctx context.Context, params CreateThreadParams) (*Thread, bool, error) {
	thread, err := c.GetThread(ctx, params.ThreadID, params.UserID)
	if err == nil {
		return thread, false, nil
	}
	var platformError *Error
	if !errors.As(err, &platformError) || platformError.Status != 404 {
		return nil, false, err
	}
	thread, err = c.CreateThread(ctx, params)
	if err == nil {
		return thread, true, nil
	}
	if !errors.As(err, &platformError) || platformError.Status != 409 {
		return nil, false, err
	}
	thread, err = c.GetThread(ctx, params.ThreadID, params.UserID)
	return thread, false, err
}

// UpdateThread changes metadata without allowing updates to replace caller identity.
func (c *Client) UpdateThread(ctx context.Context, threadID, userID, agentID string, updates map[string]any) (*Thread, error) {
	body := map[string]any{}
	for k, v := range updates {
		body[k] = v
	}
	body["userId"] = userID
	body["agentId"] = agentID
	return c.thread(ctx, "PATCH", "/api/threads/"+url.PathEscape(threadID), body)
}

// ArchiveThread retains history and excludes the thread from default lists.
func (c *Client) ArchiveThread(ctx context.Context, threadID, userID, agentID string) error {
	_, err := c.UpdateThread(ctx, threadID, userID, agentID, map[string]any{"archived": true})
	return err
}

// DeleteThread permanently deletes a thread and its history.
func (c *Client) DeleteThread(ctx context.Context, threadID, userID, agentID string) error {
	_, err := c.Request(ctx, "DELETE", "/api/threads/"+url.PathEscape(threadID), map[string]any{"userId": userID, "agentId": agentID, "reason": "Deleted via CopilotKit SDK"}, nil)
	return err
}

// GetThreadMessages returns the persisted AG-UI message envelope without removing extension fields.
func (c *Client) GetThreadMessages(ctx context.Context, threadID, userID string) (map[string]any, error) {
	value, err := object[map[string]any](ctx, c, "GET", "/api/threads/"+url.PathEscape(threadID)+"/messages?"+url.Values{"userId": {userID}}.Encode(), nil, nil)
	if err != nil {
		return nil, err
	}
	return *value, nil
}

// GetThreadEvents reads persisted events through the project-authorized inspection API.
func (c *Client) GetThreadEvents(ctx context.Context, threadID string) (map[string]any, error) {
	value, err := object[map[string]any](ctx, c, "GET", "/api/_inspect/threads/"+url.PathEscape(threadID)+"/events", nil, nil)
	if err != nil {
		return nil, err
	}
	return *value, nil
}

// GetThreadState reads folded state and the platform's snapshot-presence marker.
func (c *Client) GetThreadState(ctx context.Context, threadID string) (map[string]any, error) {
	value, err := object[map[string]any](ctx, c, "GET", "/api/_inspect/threads/"+url.PathEscape(threadID)+"/state", nil, nil)
	if err != nil {
		return nil, err
	}
	return *value, nil
}

// Annotate records an annotation. Reuse ClientEventID for idempotent retries.
func (c *Client) Annotate(ctx context.Context, params AnnotationParams) (*AnnotationResult, error) {
	id := params.ClientEventID
	if id == "" {
		var bytes [16]byte
		if _, err := rand.Read(bytes[:]); err != nil {
			return nil, err
		}
		bytes[6] = (bytes[6] & 15) | 64
		bytes[8] = (bytes[8] & 63) | 128
		encoded := hex.EncodeToString(bytes[:])
		id = encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:]
	}
	body := map[string]any{"userId": params.UserID, "threadId": params.ThreadID, "type": params.Type}
	if params.Payload != nil {
		body["payload"] = params.Payload
	}
	if params.OccurredAt != "" {
		body["occurredAt"] = params.OccurredAt
	}
	return object[AnnotationResult](ctx, c, "PUT", "/connector/annotate/"+url.PathEscape(id), body, nil)
}
