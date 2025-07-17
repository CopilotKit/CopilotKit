import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, CopilotKitCSSProperties } from "@copilotkit/react-ui";
import { CodePreview } from "@/components/content/code-preview";
import "@copilotkit/react-ui/styles.css";

const Chat = () => {
  return (
    <CopilotKit publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY}>
      <div style={{ 
        "--copilot-kit-primary-color": "var(--primary)",
        "--copilot-kit-background-color": "var(--background)",
        "--copilot-kit-contrast-color": "#fff",
      } as CopilotKitCSSProperties}>
        <CopilotChat 
          className="h-96"
          labels={{
            initial: [
              "Hey! I'm connected to an LLM through CopilotKit 🪁\n\nTry sending me a message!",
            ],
          }}
        />
      </div>
    </CopilotKit>
  )
}

export function ChatPreview({ children }: { children: React.ReactNode }) {
  return (
    <CodePreview preview={<Chat />}>
      {children}
    </CodePreview>
  )
}