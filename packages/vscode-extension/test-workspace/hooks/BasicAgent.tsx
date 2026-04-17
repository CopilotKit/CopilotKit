import { useCoAgentStateRender } from "@copilotkit/react-core";

export function BasicAgent() {
  useCoAgentStateRender({
    name: "basic_agent",
    render: ({ state, status }) => (
      <div data-testid="agent-render">
        Agent: {JSON.stringify(state)} ({status})
      </div>
    ),
  });
  return null;
}

export default BasicAgent;
