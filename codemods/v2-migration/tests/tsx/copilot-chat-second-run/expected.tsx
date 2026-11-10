// TODO(copilotkit-2.0): `useCopilotChat` was removed in 2.0. Use `useAgent` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/hooks/useAgent
import { useCopilotChat, useAgent, useCopilotKit } from "@copilotkit/react-core";

export function QuickActions() {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();
  const appendMessage = async (message: Parameters<typeof agent.addMessage>[0], options?: { followUp?: boolean }) => {
    agent.addMessage(message);
    if (options?.followUp ?? true) await copilotkit.runAgent({ agent });
  };
  const isLoading = agent.isRunning;
  const visibleMessages = agent.messages;
  const stopGeneration = () => copilotkit.stopAgent({ agent });
  const ask = (content: string) =>
    appendMessage({ id: crypto.randomUUID(), role: "user" as const, content });
  return (
    <div>
      {visibleMessages.length} messages
      <button disabled={isLoading} onClick={() => ask("Plan my trip")}>
        Plan
      </button>
      <button onClick={stopGeneration}>Stop</button>
    </div>
  );
}

export function Debug() {
  // Left for the TODO: members with no 2.0 equivalent.
  const { reloadMessages, reset } = useCopilotChat();
  return <button onClick={() => { reset(); void reloadMessages("m1"); }} />;
}
