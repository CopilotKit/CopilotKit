package runtime

import (
	"context"
	"errors"
)

type uiAgent struct {
	next Agent
	a2ui *A2UIConfig
	mcp  []MCPServer
}

func (a *uiAgent) Run(ctx context.Context, input map[string]any, emit func(Event) error) error {
	if request, ok := object(input["forwardedProps"])["__proxiedMCPRequest"]; ok {
		return a.proxy(ctx, input, object(request), emit)
	}
	var a2ui *a2uiStream
	if a.a2ui != nil {
		a2ui = newA2UI(a.a2ui, prepareA2UI(a.a2ui, input))
	}
	tools, err := a.discover(ctx, input)
	if err != nil {
		return err
	}
	calls := map[string]*mcpCall{}
	order := []string{}
	var terminal Event
	forward := func(event Event) error {
		result := event["type"] == "TOOL_CALL_RESULT"
		if result {
			if err := emit(event); err != nil {
				return err
			}
		}
		if a2ui != nil {
			for _, activity := range a2ui.process(event) {
				if err := emit(activity); err != nil {
					return err
				}
			}
		}
		if !result {
			return emit(event)
		}
		return nil
	}
	err = a.next.Run(ctx, input, func(event Event) error {
		kind, id := str(event["type"]), str(event["toolCallId"])
		if terminal != nil {
			return errors.New("agent emitted events after RUN_FINISHED")
		}
		if kind == "RUN_FINISHED" {
			terminal = event
			return nil
		}
		if kind == "RUN_STARTED" {
			event["input"] = input
		}
		switch kind {
		case "TOOL_CALL_START":
			if tool, ok := tools[str(event["toolCallName"])]; ok {
				calls[id] = &mcpCall{tool: tool}
				order = append(order, id)
			}
		case "TOOL_CALL_ARGS":
			if call := calls[id]; call != nil {
				call.args += str(event["delta"])
				if len(call.args) > 4<<20 {
					return errors.New("MCP arguments exceed size limit")
				}
			}
		case "TOOL_CALL_RESULT":
			if call := calls[id]; call != nil {
				call.result = true
			}
		}
		return forward(event)
	})
	if err != nil {
		return err
	}
	if terminal == nil {
		return nil
	}
	for _, id := range order {
		call := calls[id]
		if !call.result {
			if err := a.executeCall(ctx, id, call, forward); err != nil {
				return err
			}
		}
	}
	if a2ui != nil {
		for _, event := range a2ui.finish() {
			if err := emit(event); err != nil {
				return err
			}
		}
	}
	return emit(terminal)
}
