"use client";
import { LayoutComponent } from "@/components/layout";
import "./globals.css";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import { CopilotPopup } from "@copilotkit/react-ui";
import CopilotContext from "@/components/copilot-context";
import { useAuthContext } from "@/components/auth-context";

export function CopilotKitWrapper({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuthContext();

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      showDevConsole={false}
      properties={{
        userRole: currentUser?.role,
      }}
    >
      <LayoutComponent>
        <CopilotContext>{children}</CopilotContext>
      </LayoutComponent>
      <CopilotPopup
        defaultOpen={true}
        instructions={
          "You are assisting the user as best as you can. Answer in the best way possible given the data you have."
        }
        labels={{
          title: "Bankito Assistant",
          initial: "Hi, I'm the Bankito Copilot, built with copilotkit.  How can I help?  You can try one of these suggestions, or ask me anything.",
        }}
        suggestions={[
          { title: "Add a card", message: "Add a new credit card" },
          { title: "View transactions", message: "Show me my recent transactions" },
          { title: "Assign a policy", message: "Assign a spending policy to one of my cards" },
        ]}
      />
    </CopilotKit>
  );
}
