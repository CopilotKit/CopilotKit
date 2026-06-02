"use client";
import { LayoutComponent } from "@/components/layout";
import "./globals.css";
import {
  CopilotKitProvider,
  CopilotPopup,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import CopilotContext from "@/components/copilot-context";
import { useAuthContext } from "@/components/auth-context";
import { IDENTITY } from "@/lib/identity";

// Static suggestion pills shown on the welcome screen / before-first-message.
// In v2, suggestions are registered via `useConfigureSuggestions` rather than a
// prop on `CopilotPopup` (the v1 `suggestions` prop does not exist on the v2
// component — it's omitted from `CopilotChatProps` and supplied via the hook
// instead). See packages/react-core/src/v2/hooks/use-configure-suggestions.tsx
// and packages/react-core/src/v2/components/chat/CopilotChat.tsx (line 41–46).
function BankingSuggestions() {
  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      { title: "View transactions", message: "Show me my recent transactions" },
      { title: "Add a card", message: "Add a new credit card" },
      {
        title: "Assign a policy",
        message: "Assign a spending policy to one of my cards",
      },
    ],
  });
  return null;
}

export function CopilotKitWrapper({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuthContext();

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      showDevConsole={false}
      properties={{ userRole: currentUser?.role }}
    >
      <BankingSuggestions />
      <LayoutComponent>
        <CopilotContext>{children}</CopilotContext>
      </LayoutComponent>
      <CopilotPopup
        defaultOpen={false}
        labels={{
          modalHeaderTitle: IDENTITY.assistant,
          welcomeMessageText: IDENTITY.greeting,
        }}
      />
    </CopilotKitProvider>
  );
}
