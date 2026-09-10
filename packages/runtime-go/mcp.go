package runtime

import (
	"bufio"
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// MCPServer is a host-owned Streamable HTTP endpoint, scoped optionally to one agent.
type MCPServer struct {
	Type     string            `json:"type"`
	URL      string            `json:"url"`
	ServerID string            `json:"serverId,omitempty"`
	AgentID  string            `json:"agentId,omitempty"`
	Headers  map[string]string `json:"headers,omitempty"`
}

// MCPAppsConfig enables UI-bearing MCP tools from explicit server registrations.
type MCPAppsConfig struct {
	Servers []MCPServer `json:"servers"`
}

func serverHash(s MCPServer) string {
	raw, _ := json.Marshal(struct {
		Type string `json:"type"`
		URL  string `json:"url"`
	}{s.Type, s.URL})
	sum := md5.Sum(raw)
	return hex.EncodeToString(sum[:])
}

type mcpSession struct {
	server           MCPServer
	session, version string
	id               int
	client           *http.Client
}

// close releases the negotiated server session without delaying shutdown beyond three seconds.
func (s *mcpSession) close() {
	if s.session == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "DELETE", s.server.URL, nil)
	if err != nil {
		return
	}
	for k, v := range s.server.Headers {
		request.Header.Set(k, v)
	}
	request.Header.Set("Mcp-Session-Id", s.session)
	request.Header.Set("MCP-Protocol-Version", s.version)
	request.Header.Set("Accept", "application/json, text/event-stream")
	response, err := s.client.Do(request)
	if err == nil {
		response.Body.Close()
	}
}

func (s *mcpSession) request(ctx context.Context, method string, params any, notification bool) (any, error) {
	s.id++
	body := map[string]any{"jsonrpc": "2.0", "method": method}
	if !notification {
		body["id"] = s.id
	}
	if params != nil {
		body["params"] = params
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", s.server.URL, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	for k, v := range s.server.Headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", s.version)
	if s.session != "" {
		req.Header.Set("Mcp-Session-Id", s.session)
	}
	response, err := s.client.Do(req)
	if err != nil {
		return nil, errors.New("MCP transport unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("MCP HTTP status %d", response.StatusCode)
	}
	if session := response.Header.Get("Mcp-Session-Id"); session != "" {
		s.session = session
	}
	if notification {
		return map[string]any{"success": true}, nil
	}
	var result map[string]any
	if strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		scanner := bufio.NewScanner(io.LimitReader(response.Body, 8<<20))
		scanner.Buffer(make([]byte, 4096), 4<<20)
		lines := []string{}
		found := false
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data:") {
				lines = append(lines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
			}
			if line == "" && len(lines) > 0 {
				var frame map[string]any
				if json.Unmarshal([]byte(strings.Join(lines, "\n")), &frame) != nil {
					return nil, errors.New("invalid MCP SSE JSON")
				}
				lines = nil
				if frame["id"] == float64(s.id) {
					result = frame
					found = true
					break
				}
			}
		}
		if err := scanner.Err(); err != nil {
			return nil, errors.New("MCP SSE read failed")
		}
		if !found {
			return nil, errors.New("MCP SSE response missing matching ID")
		}
	} else {
		d := json.NewDecoder(io.LimitReader(response.Body, 8<<20))
		if d.Decode(&result) != nil {
			return nil, errors.New("invalid MCP JSON response")
		}
	}
	if result["jsonrpc"] != "2.0" || result["id"] != float64(s.id) {
		return nil, errors.New("MCP response identity mismatch")
	}
	if result["error"] != nil {
		return nil, errors.New("MCP server rejected request")
	}
	value, ok := result["result"]
	if !ok {
		return nil, errors.New("MCP response missing result")
	}
	return value, nil
}
func newMCPSession(ctx context.Context, server MCPServer) (*mcpSession, error) {
	s := &mcpSession{server: server, version: "2025-03-26", client: &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	result, err := s.request(ctx, "initialize", map[string]any{"protocolVersion": s.version, "clientInfo": map[string]any{"name": "copilotkit-runtime-go", "version": "0.1.0"}, "capabilities": map[string]any{"extensions": map[string]any{"io.modelcontextprotocol/ui": map[string]any{"mimeTypes": []string{"text/html+mcp"}}}}}, false)
	if err != nil {
		return nil, err
	}
	version := str(object(result)["protocolVersion"])
	switch version {
	case "2024-11-05", "2025-03-26", "2025-06-18":
		s.version = version
	default:
		return nil, errors.New("unsupported MCP protocol version")
	}
	if _, err = s.request(ctx, "notifications/initialized", nil, true); err != nil {
		s.close()
		return nil, err
	}
	return s, nil
}
func mcpRequest(ctx context.Context, server MCPServer, method string, params any) (any, error) {
	s, err := newMCPSession(ctx, server)
	if err != nil {
		return nil, err
	}
	defer s.close()
	return s.request(ctx, method, params, method == "notifications/message")
}

type mcpTool struct {
	server         MCPServer
	name, resource string
}
type mcpCall struct {
	tool   mcpTool
	args   string
	result bool
}

func (a *uiAgent) discover(ctx context.Context, input map[string]any) (map[string]mcpTool, error) {
	found := map[string]mcpTool{}
	tools, _ := input["tools"].([]any)
	names := map[string]bool{}
	for _, tool := range tools {
		names[str(object(tool)["name"])] = true
	}
	for _, server := range a.mcp {
		s, err := newMCPSession(ctx, server)
		if err != nil {
			return nil, err
		}
		defer s.close()
		cursor := ""
		seen := map[string]bool{}
		for page := 0; page < 100; page++ {
			params := map[string]any{}
			if cursor != "" {
				params["cursor"] = cursor
			}
			result, err := s.request(ctx, "tools/list", params, false)
			if err != nil {
				return nil, err
			}
			listed, ok := object(result)["tools"].([]any)
			if !ok {
				return nil, errors.New("invalid MCP tools list")
			}
			for _, raw := range listed {
				tool := object(raw)
				meta := object(tool["_meta"])
				if visibility, explicit := object(meta["ui"])["visibility"]; explicit {
					values, _ := visibility.([]any)
					modelVisible := false
					for _, value := range values {
						if str(value) == "model" {
							modelVisible = true
						}
					}
					if !modelVisible {
						continue
					}
				}
				resource, nested := object(meta["ui"])["resourceUri"].(string)
				if !nested {
					resource = str(meta["ui/resourceUri"])
				}
				if resource == "" {
					continue
				}
				name := str(tool["name"])
				if name == "" || names[name] {
					return nil, errors.New("duplicate or empty MCP UI tool name")
				}
				names[name] = true
				parameters := tool["inputSchema"]
				if parameters == nil {
					parameters = map[string]any{"type": "object", "properties": map[string]any{}}
				}
				tools = append(tools, map[string]any{"name": name, "description": str(tool["description"]) + "\n[UI Resource: " + resource + "]", "parameters": parameters})
				found[name] = mcpTool{server: server, name: name, resource: resource}
			}
			cursor = str(object(result)["nextCursor"])
			if cursor == "" {
				break
			}
			if seen[cursor] || page == 99 {
				return nil, errors.New("MCP pagination did not terminate")
			}
			seen[cursor] = true
		}
	}
	input["tools"] = tools
	return found, nil
}
func (a *uiAgent) executeCall(ctx context.Context, id string, call *mcpCall, emit func(Event) error) error {
	args := map[string]any{}
	if call.args != "" && json.Unmarshal([]byte(call.args), &args) != nil {
		return emit(Event{"type": "TOOL_CALL_RESULT", "toolCallId": id, "messageId": uuid(), "content": `{"error":"Invalid MCP tool arguments"}`})
	}
	result, err := mcpRequest(ctx, call.tool.server, "tools/call", map[string]any{"name": call.tool.name, "arguments": args})
	if err != nil {
		return emit(Event{"type": "TOOL_CALL_RESULT", "toolCallId": id, "messageId": uuid(), "content": `{"error":"MCP tool execution failed"}`})
	}
	parts, _ := object(result)["content"].([]any)
	texts := []string{}
	for _, part := range parts {
		if object(part)["type"] == "text" {
			texts = append(texts, str(object(part)["text"]))
		}
	}
	content := strings.Join(texts, "\n")
	if content == "" {
		raw, _ := json.Marshal(parts)
		content = string(raw)
	}
	if err := emit(Event{"type": "TOOL_CALL_RESULT", "toolCallId": id, "messageId": uuid(), "content": content}); err != nil {
		return err
	}
	activity := map[string]any{"result": result, "resourceUri": call.tool.resource, "serverHash": serverHash(call.tool.server), "toolInput": args}
	if call.tool.server.ServerID != "" {
		activity["serverId"] = call.tool.server.ServerID
	}
	return emit(Event{"type": "ACTIVITY_SNAPSHOT", "messageId": uuid(), "activityType": "mcp-apps", "content": activity, "replace": true})
}
func (a *uiAgent) proxy(ctx context.Context, input, request map[string]any, emit func(Event) error) error {
	if err := emit(Event{"type": "RUN_STARTED", "threadId": input["threadId"], "runId": input["runId"]}); err != nil {
		return err
	}
	var server *MCPServer
	id, hash := str(request["serverId"]), str(request["serverHash"])
	for _, s := range a.mcp {
		matches := s.ServerID == id
		if id == "" {
			matches = serverHash(s) == hash
		}
		if matches {
			if server != nil {
				server = nil
				break
			}
			copy := s
			server = &copy
		}
	}
	result := any(map[string]any{"error": "Unknown MCP server"})
	method := str(request["method"])
	allowed := method == "tools/call" || method == "resources/read" || method == "notifications/message" || method == "ping"
	if server != nil {
		if !allowed {
			result = map[string]any{"error": "MCP method not allowed for UI proxy"}
		} else {
			value, err := mcpRequest(ctx, *server, method, object(request["params"]))
			if err != nil {
				result = map[string]any{"error": "MCP request failed"}
			} else {
				result = value
			}
		}
	}
	return emit(Event{"type": "RUN_FINISHED", "threadId": input["threadId"], "runId": input["runId"], "result": result})
}
