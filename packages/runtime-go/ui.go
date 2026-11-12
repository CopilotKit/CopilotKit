package runtime

import (
	"context"
	"errors"
)

// uiAgent applies the UI middlewares of one run. The order matches the TypeScript runtime,
// outermost first: the A2UI v0.9 bridge, A2UI v0.9, MCP Apps, then render_ui.
type uiAgent struct {
	next Agent
	mcp  []MCPServer
	// generative turns on generative UI for this run; version is the agent's A2UI version.
	generative bool
	version    string
	option     *GenerativeUIConfig
}

func (a *uiAgent) Run(ctx context.Context, clientInput map[string]any, emit func(Event) error) error {
	if request, ok := object(clientInput["forwardedProps"])["__proxiedMCPRequest"]; ok {
		return a.proxy(ctx, clientInput, object(request), emit)
	}
	// Only the agent side gets the bridged input; the stored thread keeps the client's input.
	input := shallowCopy(clientInput)
	var a2ui *a2uiStream
	var upgrader *a2uiV09Upgrader
	if a.generative {
		input = prepareV09AgentInput(input, a.version)
		config := a2uiMiddlewareConfig(a.option, a.version, input["forwardedProps"])
		a2ui = newA2UI(config, prepareA2UI(config, input))
		upgrader = newA2UIV09Upgrader()
	}
	tools, err := a.discover(ctx, input)
	if err != nil {
		return err
	}
	// A v0.9 agent gets render_a2ui instead of render_ui.
	var genui *generativeUIRun
	if a.generative && a.version == a2uiVersion10 {
		if manifest := readToolManifest(input["forwardedProps"]); manifest != nil {
			prepareGenerativeUI(manifest, input)
			genui = newGenerativeUIRun(manifest, input)
		}
	}
	// out is the outermost step: the bridge converts v0.9 surfaces to 1.0.
	out := func(event Event) error {
		if upgrader == nil {
			return emit(event)
		}
		for _, converted := range upgrader.transform(event) {
			if err := emit(converted); err != nil {
				return err
			}
		}
		return nil
	}
	// forward applies A2UI v0.9: its activities follow a tool result and precede other events.
	forward := func(event Event) error {
		result := event["type"] == "TOOL_CALL_RESULT"
		if result {
			if err := out(event); err != nil {
				return err
			}
		}
		if a2ui != nil {
			for _, activity := range a2ui.process(event) {
				if err := out(activity); err != nil {
					return err
				}
			}
		}
		if !result {
			return out(event)
		}
		return nil
	}
	calls := map[string]*mcpCall{}
	order := []string{}
	// observe applies MCP Apps to the events that render_ui passes on.
	observe := func(event Event) error {
		kind, id := str(event["type"]), str(event["toolCallId"])
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
	}
	observeAll := func(events []Event) error {
		for _, event := range events {
			if err := observe(event); err != nil {
				return err
			}
		}
		return nil
	}
	var terminal Event
	err = a.next.Run(ctx, input, func(event Event) error {
		if terminal != nil {
			return errors.New("agent emitted events after RUN_FINISHED")
		}
		kind := str(event["type"])
		if kind == "RUN_FINISHED" {
			terminal = event
			return nil
		}
		if kind == "RUN_STARTED" {
			event["input"] = input
		}
		if genui != nil {
			return observeAll(genui.handle(event))
		}
		return observe(event)
	})
	if err != nil {
		return err
	}
	if genui != nil {
		if err := observeAll(genui.complete(terminal != nil)); err != nil {
			return err
		}
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
			if err := out(event); err != nil {
				return err
			}
		}
	}
	return out(terminal)
}
