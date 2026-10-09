package runtime

import (
	"context"
	"errors"
	"testing"
)

func TestAbruptStreamClosesOpenMessagesAndToolsBeforeError(t *testing.T) {
	var state eventFinalizer
	state.observe(Event{"type": "TEXT_MESSAGE_START", "messageId": "m"})
	state.observe(Event{"type": "TOOL_CALL_START", "toolCallId": "t"})
	events := state.finish(nil, false)
	expected := []string{"TEXT_MESSAGE_END", "TOOL_CALL_END", "TOOL_CALL_RESULT", "RUN_ERROR"}
	if len(events) != len(expected) {
		t.Fatalf("events=%v", events)
	}
	for i, kind := range expected {
		if str(events[i]["type"]) != kind {
			t.Fatalf("event %d: %v", i, events[i])
		}
	}
	if events[3]["code"] != "INCOMPLETE_STREAM" {
		t.Fatalf("terminal=%v", events[3])
	}
}
func TestFinalizerNeverAddsAfterTerminal(t *testing.T) {
	var state eventFinalizer
	state.observe(Event{"type": "TEXT_MESSAGE_START", "messageId": "m"})
	state.observe(Event{"type": "RUN_ERROR"})
	if got := state.finish(errors.New("agent failed"), false); len(got) != 0 {
		t.Fatalf("events after terminal: %v", got)
	}
}
func TestCancellationIsSuccessfulOnlyForExplicitUserStop(t *testing.T) {
	var state eventFinalizer
	if events := state.finish(context.Canceled, false); events[len(events)-1]["type"] != "RUN_ERROR" {
		t.Fatalf("cancellation claimed success: %v", events)
	}
	if events := state.finish(context.Canceled, true); events[len(events)-1]["type"] != "RUN_FINISHED" {
		t.Fatalf("explicit stop failed: %v", events)
	}
}
