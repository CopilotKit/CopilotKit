// TODO(copilotkit-2.0): `useCoAgent` was removed in 2.0. Use `useAgent` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/hooks/useAgent
import { useCoAgent, useAgent, useCopilotKit } from "@copilotkit/react-core";
import { useEffect } from "react";

type AgentState = { items: string[] };
const initialState: AgentState = { items: [] };

export function Canvas() {
  const { agent: sampleAgent } = useAgent({ agentId: "sample_agent" });
  useEffect(() => {
    if (Object.keys(sampleAgent.state ?? {}).length === 0) sampleAgent.setState(initialState);
  }, [sampleAgent]);
  const state = (Object.keys(sampleAgent.state ?? {}).length > 0 ? sampleAgent.state : initialState) as AgentState;
  const setState = (next: AgentState | ((prev: AgentState | undefined) => AgentState)) =>
    sampleAgent.setState(typeof next === "function" ? (next as (prev: AgentState | undefined) => AgentState)(sampleAgent.state) : { ...sampleAgent.state, ...next });
  const { agent: weatherAgent } = useAgent({ agentId: "weather" });
  const weatherAgentInitialState = { city: "Paris" };
  useEffect(() => {
    if (Object.keys(weatherAgent.state ?? {}).length === 0) weatherAgent.setState(weatherAgentInitialState);
  }, [weatherAgent]);
  const running = weatherAgent.isRunning;
  const weather = (Object.keys(weatherAgent.state ?? {}).length > 0 ? weatherAgent.state : weatherAgentInitialState) as any;
  const { copilotkit } = useCopilotKit();
  const stop = () => copilotkit.stopAgent({ agent: weatherAgent });
  // Left for the TODO: state managed outside, and the whole result.
  const external = useCoAgent({ name: "other" });
  return (
    <button onClick={() => setState({ items: [...state.items, "x"] })}>
      {running ? "..." : weather.city} {external.name}
      <span onClick={stop} />
    </button>
  );
}
