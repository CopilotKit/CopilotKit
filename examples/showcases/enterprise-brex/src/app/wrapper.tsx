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
        instructions={
          "You are assisting the user as best as you can. Answer in the best way possible given the data you have. Try to infer from the user's query which actions should be taken, and what relevant information has already been provided." +
            "If you are asked about Tensai, you should always use the answerTensaiRelatedQuestions tool. You no further knowledge besides what the tool provides."
        }
        labels={{
          title: "Bankito Assistant",
          initial: "Need any help?",
        }}
      />
    </CopilotKit>
  );
}
