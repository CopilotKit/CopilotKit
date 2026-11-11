// TODO(copilotkit-2.0): `CopilotPopup`: Its props changed in 2.0. Check each prop against the docs. https://docs.copilotkit.ai/reference/v2/components/CopilotPopup
// TODO(copilotkit-2.0): `CopilotSidebar`: Its props changed in 2.0. Check each prop against the docs. https://docs.copilotkit.ai/reference/v2/components/CopilotSidebar
import { CopilotPopup, CopilotSidebar } from "@copilotkit/react-core";

const labels = { title: "Help" };

export function Chat({ onOpen }: { onOpen: (open: boolean) => void }) {
  return (
    <>
      <CopilotPopup
        /* TODO(copilotkit-2.0): `instructions` was removed in 2.0. Give the agent the text with `useAgentContext({ description, value })`, or put it in the agent's system prompt. See https://docs.copilotkit.ai/migrate/chat-2.0 */ instructions="You help with the board."
        defaultOpen={true}
        clickOutsideToClose={false}
        onOpenChange={onOpen}
        labels={{
          modalHeaderTitle: "Board assistant",
          welcomeMessageText: "Hi! What should we do?",
          chatInputPlaceholder: "Ask me…",
          /* TODO(copilotkit-2.0): The `error` label was removed in 2.0. Handle errors with the `onError` prop of the chat. See https://docs.copilotkit.ai/migrate/chat-2.0 */ error: "Something went wrong",
        }}
        /* TODO(copilotkit-2.0): `Input` was removed in 2.0. Customize the input with the `input` slot of the chat, which takes different props. See https://docs.copilotkit.ai/migrate/chat-2.0 */ Input={({ onSend }: { onSend: (text: string) => void }) => (
          <input onKeyDown={(e) => e.key === "Enter" && onSend("hi")} />
        )}
      />
      <CopilotSidebar
        /* TODO(copilotkit-2.0): The `labels` keys changed in 2.0 (`title` is `modalHeaderTitle`, `placeholder` is `chatInputPlaceholder`, `initial` is `welcomeMessageText`, ...). See https://docs.copilotkit.ai/migrate/chat-2.0 */ labels={labels}
        /* TODO(copilotkit-2.0): `clickOutsideToClose` is a `CopilotPopup` prop in 2.0. See https://docs.copilotkit.ai/migrate/chat-2.0 */ clickOutsideToClose
        /* TODO(copilotkit-2.0): `makeSystemMessage` was removed in 2.0: the agent owns its system prompt. Give it extra text with `useAgentContext`. See https://docs.copilotkit.ai/migrate/chat-2.0 */ makeSystemMessage={() => "system"}
      />
    </>
  );
}
