import { CopilotPopup, CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

const labels = { title: "Help" };

export function Chat({ onOpen }: { onOpen: (open: boolean) => void }) {
  return (
    <>
      <CopilotPopup
        instructions="You help with the board."
        defaultOpen={true}
        clickOutsideToClose={false}
        onSetOpen={onOpen}
        labels={{
          title: "Board assistant",
          initial: "Hi! What should we do?",
          placeholder: "Ask me…",
          error: "Something went wrong",
        }}
        Input={({ onSend }: { onSend: (text: string) => void }) => (
          <input onKeyDown={(e) => e.key === "Enter" && onSend("hi")} />
        )}
      />
      <CopilotSidebar
        labels={labels}
        clickOutsideToClose
        makeSystemMessage={() => "system"}
      />
    </>
  );
}
