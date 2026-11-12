import { useCopilotChat } from "@copilotkit/react-core";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";

export function QuickActions() {
  const { appendMessage, isLoading, visibleMessages, stopGeneration } =
    useCopilotChat();
  const ask = (content: string) =>
    appendMessage(new TextMessage({ role: Role.User, content }));
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
