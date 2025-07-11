import { CopilotKit } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotSidebar } from "@copilotkit/react-ui";
import { CodePreview } from "@/components/content/code-preview";
import "@copilotkit/react-ui/styles.css";

const Chat = () => {
  return (
    <CopilotKit publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY}>
      <div
        style={{
          "--copilot-kit-primary-color": "var(--primary)",
          "--copilot-kit-background-color": "var(--popover)",
        } as CopilotKitCSSProperties}
        className="relative w-full h-[400px] overflow-hidden"
      >
        <div className="my-auto h-full w-full flex items-center justify-center">
          <p className="text-white bg-primary p-10 rounded-xl">
            Click the button to open the sidebar!
          </p>
        </div>
        <CopilotSidebar
          className="!absolute !bottom-1 !right-1"
          labels={{
            initial: "Hey! I'm connected to an LLM through CopilotKit 🪁",
          }}
        />
      </div>
    </CopilotKit>
  )
}

export function SidebarPreview({ children }: { children: React.ReactNode }) {
  return (
    <CodePreview preview={<Chat />}>
      {children}
    </CodePreview>
  )
}