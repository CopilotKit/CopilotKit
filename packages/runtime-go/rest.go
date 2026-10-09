package runtime

import (
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"strings"
)

func (r *Runtime) rest(w http.ResponseWriter, req *http.Request, u User, parts []string) {
	if len(parts) == 0 {
		bad(w, 404, "Not found")
		return
	}
	group := parts[0]
	if group != "threads" && group != "memories" && group != "annotate" {
		bad(w, 404, "Not found")
		return
	}
	allowed := publicRESTMethods(parts)
	if len(allowed) == 0 {
		bad(w, 404, "Not found")
		return
	}
	matched := false
	for _, method := range allowed {
		if method == req.Method {
			matched = true
		}
	}
	if !matched {
		w.Header().Set("Allow", strings.Join(allowed, ", "))
		bad(w, 405, "Method not allowed")
		return
	}
	method := req.Method
	var body map[string]any
	if method == "POST" || method == "PATCH" || method == "DELETE" {
		if req.ContentLength != 0 {
			var e error
			body, e = decode(req)
			if e != nil {
				bad(w, 400, "Invalid JSON input")
				return
			}
		}
		if body == nil {
			body = map[string]any{}
		}
	}
	q := req.URL.Query()
	q.Del("userId")
	headers := map[string]string{}
	path := "/api/" + group
	for _, part := range parts[1:] {
		if !identifier(part) {
			bad(w, 400, "Invalid identifier")
			return
		}
		path += "/" + url.PathEscape(part)
	}
	if group == "threads" {
		// Browser input may not select any platform identity alias.
		threadQuery := url.Values{}
		for _, key := range []string{"agentId", "includeArchived", "limit", "cursor"} {
			if values, ok := q[key]; ok {
				threadQuery[key] = values
			}
		}
		q = threadQuery
		if body != nil {
			threadBody := map[string]any{}
			for _, key := range []string{"agentId", "name", "archived", "reason"} {
				if value, ok := body[key]; ok {
					threadBody[key] = value
				}
			}
			body = threadBody
		}
		if method == "GET" {
			q.Set("userId", u.ID)
		} else {
			body["userId"] = u.ID
		}
		if method == "DELETE" {
			body["reason"] = "Deleted via CopilotKit runtime"
		}
		if len(parts) >= 2 && parts[1] == "subscribe" {
			body = map[string]any{"userId": u.ID}
		}
		if len(parts) == 3 && (parts[2] == "events" || parts[2] == "state") {
			if _, e := r.platform(req.Context(), "GET", "/api/threads/"+url.PathEscape(parts[1])+"?userId="+url.QueryEscape(u.ID), nil, nil); e != nil {
				bad(w, statusOf(e), e.Error())
				return
			}
			path = "/api/_inspect/threads/" + url.PathEscape(parts[1]) + "/" + parts[2]
			q = url.Values{}
		}
		if len(parts) == 3 && parts[2] == "archive" && method == "POST" {
			path = "/api/threads/" + url.PathEscape(parts[1])
			method = "PATCH"
			body["archived"] = true
		}
	} else if group == "memories" {
		if err := validateMemory(method, parts, body); err != "" {
			bad(w, 400, err)
			return
		}
		scope := str(body["scope"])
		if scope == "" {
			scope = q.Get("scope")
		}
		if scope != "" && scope != "user" && scope != "project" {
			bad(w, 400, "Invalid memory scope")
			return
		}
		headers["x-cpki-user-id"] = u.ID
		if r.config.MemoryAccess != nil {
			grant, e := r.config.MemoryAccess(req, u)
			if e != nil {
				bad(w, 403, "Memory access denied")
				return
			}
			valid := func(v string) bool { return v == "none" || v == "read" || v == "read-write" }
			if !valid(grant.User) || !valid(grant.Project) {
				bad(w, 500, "Invalid memory grant")
				return
			}
			write := method == "PATCH" || method == "DELETE" || (method == "POST" && len(parts) == 1)
			if write && method == "POST" {
				if (scope == "project" && grant.Project != "read-write") || (scope != "project" && grant.User != "read-write") {
					bad(w, 403, "Memory scope write denied")
					return
				}
			}
			if write && grant.User != "read-write" && grant.Project != "read-write" {
				bad(w, 403, "Memory write denied")
				return
			}
			if grant.User == "none" && grant.Project == "none" {
				bad(w, 403, "Memory access denied")
				return
			}
			encoded, _ := json.Marshal(grant)
			headers["x-cpki-memory-grant"] = string(encoded)
		}
		delete(body, "userId")
		delete(body, "memoryGrant")
	} else {
		if method != "POST" || len(parts) != 1 {
			bad(w, 405, "Method not allowed")
			return
		}
		if !identifier(str(body["threadId"])) || str(body["type"]) == "" {
			bad(w, 400, "Invalid annotation")
			return
		}
		eventID := str(body["clientEventId"])
		if eventID == "" {
			eventID = uuid()
		}
		path = "/connector/annotate/" + url.PathEscape(eventID)
		method = "PUT"
		body["userId"] = u.ID
		delete(body, "clientEventId")
	}
	if query := q.Encode(); query != "" {
		path += "?" + query
	}
	// A typed nil map inside an interface is non-nil and encodes as JSON null.
	// Read requests have no payload; keep the interface itself nil in that case.
	var payload any
	if body != nil {
		payload = body
	}
	value, e := r.platform(req.Context(), method, path, payload, headers)
	if e != nil {
		status := statusOf(e)
		if group == "memories" && status >= 500 {
			status = 502
		}
		bad(w, status, e.Error())
		return
	}
	if group == "threads" && len(parts) == 3 && parts[2] == "state" {
		m := object(value)
		state := m["state"]
		if str(m["kind"]) != "snapshot" {
			state = nil
		}
		value = map[string]any{"state": state}
	}
	if group == "threads" && len(parts) == 3 && parts[2] == "archive" {
		value = map[string]any{"threadId": parts[1], "archived": true}
	} else if group == "threads" && method == "DELETE" {
		value = map[string]any{"threadId": parts[1], "deleted": true}
	} else if group == "threads" && method == "PATCH" {
		value = object(value)["thread"]
	}
	status := 200
	if group == "memories" && len(parts) == 1 && method == "POST" {
		status = 201
	}
	if value == nil {
		status = 204
	}
	reply(w, status, value)
}

// publicRESTMethods is an explicit browser API allowlist, never a platform proxy.
func publicRESTMethods(parts []string) []string {
	switch parts[0] {
	case "threads":
		if len(parts) == 1 {
			return []string{"GET"}
		}
		if len(parts) == 2 {
			if parts[1] == "subscribe" {
				return []string{"POST"}
			}
			if parts[1] == "clear" {
				return nil
			}
			return []string{"PATCH", "DELETE"}
		}
		if len(parts) == 3 {
			switch parts[2] {
			case "messages", "events", "state":
				return []string{"GET"}
			case "archive":
				return []string{"POST"}
			}
		}
	case "memories":
		if len(parts) == 1 {
			return []string{"GET", "POST"}
		}
		if len(parts) == 2 {
			if parts[1] == "subscribe" || parts[1] == "recall" {
				return []string{"POST"}
			}
			return []string{"PATCH", "DELETE"}
		}
	case "annotate":
		if len(parts) == 1 {
			return []string{"POST"}
		}
	}
	return nil
}

func validateMemory(method string, parts []string, body map[string]any) string {
	if scope, exists := body["scope"]; exists && (scope != "user" && scope != "project") {
		return "Invalid memory scope"
	}
	if method == "POST" && len(parts) == 2 && parts[1] == "recall" {
		query := strings.TrimSpace(str(body["query"]))
		if query == "" {
			return "Recall requires non-empty query"
		}
		body["query"] = query
		if raw, exists := body["limit"]; exists {
			limit, ok := raw.(float64)
			if !ok || limit <= 0 || math.Trunc(limit) != limit {
				return "Recall limit must be a positive integer"
			}
		}
	}
	if (method == "POST" && len(parts) == 1) || method == "PATCH" {
		if _, ok := body["content"].(string); !ok {
			return "Memory content must be a string"
		}
		kind := str(body["kind"])
		if kind != "topical" && kind != "episodic" && kind != "operational" {
			return "Invalid memory kind"
		}
		if raw, exists := body["sourceThreadIds"]; exists {
			ids, ok := raw.([]any)
			if !ok {
				return "Invalid sourceThreadIds"
			}
			for _, id := range ids {
				if _, ok := id.(string); !ok {
					return "Invalid sourceThreadIds"
				}
			}
		}
	}
	return ""
}
