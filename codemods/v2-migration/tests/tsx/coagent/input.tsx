import { useCoAgent } from "@copilotkit/react-core";

type AgentState = { items: string[] };
const initialState: AgentState = { items: [] };

export function Canvas() {
  const { state, setState } = useCoAgent<AgentState>({
    name: "sample_agent",
    initialState,
  });
  const { running, stop, state: weather } = useCoAgent({
    name: "weather",
    initialState: { city: "Paris" },
  });
  // Left for the TODO: state managed outside, and the whole result.
  const external = useCoAgent({ name: "other" });
  return (
    <button onClick={() => setState({ items: [...state.items, "x"] })}>
      {running ? "..." : weather.city} {external.name}
      <span onClick={stop} />
    </button>
  );
}
