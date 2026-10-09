package intelligence

import (
	"context"
	"encoding/json"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// InspectorMetadata contains independent optional display modules for a project.
type InspectorMetadata struct {
	SchemaVersion int                `json:"schemaVersion"`
	Identity      *InspectorIdentity `json:"identity,omitempty"`
	Plan          *InspectorPlan     `json:"plan,omitempty"`
	License       *InspectorLicense  `json:"license,omitempty"`
	Action        *InspectorAction   `json:"action,omitempty"`
	Usage         *InspectorUsage    `json:"usage,omitempty"`
}

// InspectorIdentity contains project and organization display names.
type InspectorIdentity struct {
	OrganizationName string `json:"organizationName"`
	ProjectName      string `json:"projectName"`
}

// InspectorPlan identifies the plan and its display label.
type InspectorPlan struct {
	Code  string `json:"code"`
	Label string `json:"label"`
}

// InspectorLicense describes license state, not an authorization grant.
type InspectorLicense struct {
	State string `json:"state"`
}

// InspectorAction contains a supported action and a safe navigation URL.
type InspectorAction struct {
	Kind string `json:"kind"`
	URL  string `json:"url"`
}

// InspectorUsageLimit is finite, unlimited, or unknown. Only finite limits have a value.
type InspectorUsageLimit struct {
	Kind  string `json:"kind"`
	Value *int64 `json:"value,omitempty"`
}

// InspectorUsage retains known zero counts and distinguishes absent expiry counts.
type InspectorUsage struct {
	Used              int64               `json:"used"`
	Limit             InspectorUsageLimit `json:"limit"`
	ExpiringSoonCount *int64              `json:"expiringSoonCount,omitempty"`
}

// GetInspectorMetadata reads sanitized project metadata within five seconds.
// A shorter context or HTTP-client deadline still applies. A 204, 404, or unsupported
// schema returns nil without an error. Other failures retain their status and cause.
func (c *Client) GetInspectorMetadata(ctx context.Context) (*InspectorMetadata, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	raw, err := c.request(ctx, http.MethodGet, "/api/inspector/metadata", nil, nil, http.StatusNoContent, http.StatusNotFound)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, nil
	}
	return parseInspectorMetadata(raw)
}

func parseInspectorMetadata(raw json.RawMessage) (*InspectorMetadata, error) {
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, &Error{Status: 502}
	}
	value := metadataObject(decoded)
	if value["schemaVersion"] != float64(1) {
		return nil, nil
	}
	result := &InspectorMetadata{SchemaVersion: 1}
	identity := metadataObject(value["identity"])
	organization, project := metadataText(identity["organizationName"]), metadataText(identity["projectName"])
	if organization != "" && project != "" {
		result.Identity = &InspectorIdentity{OrganizationName: organization, ProjectName: project}
	}
	plan := metadataObject(value["plan"])
	code, label := metadataText(plan["code"]), metadataText(plan["label"])
	if code != "" && label != "" {
		result.Plan = &InspectorPlan{Code: code, Label: label}
	}
	license := metadataObject(value["license"])
	if state, ok := license["state"].(string); ok {
		switch state {
		case "valid", "none", "expired", "unknown":
			result.License = &InspectorLicense{State: state}
		}
	}
	action := metadataObject(value["action"])
	if kind, ok := action["kind"].(string); ok {
		switch kind {
		case "manage_plan", "renew", "enable_intelligence":
			if actionURL := metadataActionURL(action["url"]); actionURL != "" {
				result.Action = &InspectorAction{Kind: kind, URL: actionURL}
			}
		}
	}
	usage := metadataObject(value["usage"])
	if used := metadataInteger(usage["used"], 0); used != nil {
		limit := metadataObject(usage["limit"])
		var parsed *InspectorUsageLimit
		switch limit["kind"] {
		case "finite":
			if count := metadataInteger(limit["value"], 1); count != nil {
				parsed = &InspectorUsageLimit{Kind: "finite", Value: count}
			}
		case "unlimited":
			parsed = &InspectorUsageLimit{Kind: "unlimited"}
		case "unknown":
			parsed = &InspectorUsageLimit{Kind: "unknown"}
		}
		if parsed != nil {
			result.Usage = &InspectorUsage{Used: *used, Limit: *parsed, ExpiringSoonCount: metadataInteger(usage["expiringSoonCount"], 0)}
		}
	}
	return result, nil
}

func metadataObject(value any) map[string]any {
	object, _ := value.(map[string]any)
	return object
}

func metadataText(value any) string {
	text, _ := value.(string)
	return strings.Trim(text, "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
}

func metadataInteger(value any, minimum float64) *int64 {
	number, ok := value.(float64)
	if !ok || number < minimum || number > 9007199254740991 || math.Trunc(number) != number {
		return nil
	}
	integer := int64(number)
	return &integer
}

func metadataActionURL(value any) string {
	raw := metadataText(value)
	if raw == "" || strings.ContainsAny(raw, "?#") {
		return ""
	}
	_, rest, found := strings.Cut(raw, "://")
	if !found {
		return ""
	}
	authority, _, _ := strings.Cut(rest, "/")
	if strings.Contains(authority, "@") {
		return ""
	}
	parsed, err := url.Parse(strings.ReplaceAll(raw, "\\", "/"))
	if err != nil || parsed.Hostname() == "" || parsed.User != nil {
		return ""
	}
	if port := parsed.Port(); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 0 || number > 65535 {
			return ""
		}
	}
	host := strings.ToLower(parsed.Hostname())
	if strings.HasPrefix(parsed.Host, "[") && (!strings.Contains(host, ":") || net.ParseIP(host) == nil) {
		return ""
	}
	if strings.ContainsAny(host, "\x00\t\n\r #%/<>?@\\^|") {
		return ""
	}
	if strings.Contains(host, ":") && net.ParseIP(host) == nil {
		return ""
	}
	if parsed.Scheme == "https" {
		return raw
	}
	ip := net.ParseIP(host)
	loopback := host == "localhost" || host == "127.0.0.1" || (ip != nil && ip.To4() == nil && ip.Equal(net.IPv6loopback))
	if parsed.Scheme == "http" && loopback {
		return raw
	}
	return ""
}
