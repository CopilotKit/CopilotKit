package runtime

import (
	"encoding/json"
	"errors"
)

var errUserStopped = errors.New("run stopped by user")
var errLockLost = errors.New("thread lock renewal failed")

type toolProgress struct{ ended, result bool }

// eventFinalizer stores only unfinished IDs and never retains message contents.
type eventFinalizer struct {
	messages     []string
	tools        []string
	openMessages map[string]bool
	openTools    map[string]toolProgress
	terminal     bool
	failed       bool
}

func (s *eventFinalizer) observe(e Event) {
	if s.openMessages == nil {
		s.openMessages = map[string]bool{}
		s.openTools = map[string]toolProgress{}
	}
	id, tool := str(e["messageId"]), str(e["toolCallId"])
	switch str(e["type"]) {
	case "TEXT_MESSAGE_START":
		if !s.openMessages[id] {
			s.messages = append(s.messages, id)
		}
		s.openMessages[id] = true
	case "TEXT_MESSAGE_END":
		delete(s.openMessages, id)
	case "TOOL_CALL_START":
		if _, exists := s.openTools[tool]; !exists {
			s.tools = append(s.tools, tool)
		}
		s.openTools[tool] = toolProgress{}
	case "TOOL_CALL_END":
		if progress, exists := s.openTools[tool]; exists {
			progress.ended = true
			s.openTools[tool] = progress
		}
	case "TOOL_CALL_RESULT":
		if progress, exists := s.openTools[tool]; exists {
			progress.result = true
			s.openTools[tool] = progress
		}
	case "RUN_FINISHED":
		s.terminal = true
	case "RUN_ERROR":
		s.terminal = true
		s.failed = true
	}
}

// finish closes incomplete structures only when no terminal has been delivered.
func (s *eventFinalizer) finish(cause error, stopped bool) []Event {
	if s.terminal {
		return nil
	}
	events := []Event{}
	for _, id := range s.messages {
		if s.openMessages[id] {
			events = append(events, Event{"type": "TEXT_MESSAGE_END", "messageId": id})
		}
	}
	for _, id := range s.tools {
		p := s.openTools[id]
		if !p.ended {
			events = append(events, Event{"type": "TOOL_CALL_END", "toolCallId": id})
		}
		if !p.result {
			status, reason, message := "error", "missing_terminal_event", "Run ended without emitting a terminal event"
			if stopped {
				status, reason, message = "stopped", "stop_requested", "Run stopped by user"
			}
			content, _ := json.Marshal(map[string]any{"status": status, "reason": reason, "message": message})
			events = append(events, Event{"type": "TOOL_CALL_RESULT", "toolCallId": id, "messageId": id + "-result", "role": "tool", "content": string(content)})
		}
	}
	if stopped {
		return append(events, Event{"type": "RUN_FINISHED"})
	}
	code := "INCOMPLETE_STREAM"
	if cause != nil {
		code = "AGENT_ERROR"
	}
	if errors.Is(cause, errLockLost) {
		code = "LOCK_RENEWAL_FAILED"
	}
	return append(events, Event{"type": "RUN_ERROR", "code": code, "message": "Agent run did not complete"})
}
