import {
  useCopilotReadable,
  useCopilotAdditionalInstructions,
  useMakeCopilotDocumentReadable,
  useCoAgent,
  useCoAgentStateRender,
} from "@copilotkit/react-core";

export function Data() {
  // V1 data: expose current user profile to the copilot
  useCopilotReadable({
    description: "current user",
    value: { id: "u_1", name: "Alice" },
  });

  // V1 data: extra system-level instructions appended to the prompt
  useCopilotAdditionalInstructions({
    instructions: "Prefer concise replies. Avoid markdown unless asked.",
  });

  // V1 data: make a PDF document readable by the copilot
  // @ts-expect-error – test-workspace only, exact signature may vary
  useMakeCopilotDocumentReadable({
    description: "resume.pdf",
    id: "doc-1",
    content: "Alice Smith – Senior Engineer – 10 years experience",
  });

  // V1 data: bind to a named co-agent with initial state
  useCoAgent({
    name: "research_agent",
    initialState: { query: "" },
  });

  // V1 render: render the co-agent's live state in the chat sidebar
  useCoAgentStateRender({
    name: "research_agent",
    render: ({ state }: { state: { query: string } }) => (
      <div>Research query: {state.query}</div>
    ),
  });

  return <div>v1 data</div>;
}
