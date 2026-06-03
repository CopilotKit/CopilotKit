"use client";
import { LayoutComponent } from "@/components/layout";
import {
  CopilotChatConfigurationProvider,
  CopilotKit,
  CopilotPopup,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import CopilotContext from "@/components/copilot-context";
import { useAuthContext } from "@/components/auth-context";
import { useThreadSelection } from "@/components/threads/use-thread-selection";
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
  const { threadId, selectThread, createThread } = useThreadSelection();

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      // The runtime route is the multi-endpoint REST handler
      // (createCopilotHonoHandler at api/copilotkit/[[...slug]]: /info,
      // /agent/{id}/run, ...). The default single-endpoint transport POSTs to
      // /api/copilotkit and 404s against this handler, so opt into REST mode.
      useSingleEndpoint={false}
      properties={{ userRole: currentUser?.role }}
    >
      {/*
        Anchor the whole chat surface to the actively-selected thread. The
        agentId is "default" — the runtime registers `agents: { default: ... }`
        and the SDK's default agentId is also "default" (NOT "bankingAgent").
        `hasExplicitThreadId` tells the SDK the threadId is a real caller choice
        so frontend-tool round-trips keep their thread anchor. Side effect: it
        also suppresses the SDK's built-in welcome screen (acceptable for Phase A).
      */}
      <CopilotChatConfigurationProvider
        agentId="default"
        threadId={threadId}
        hasExplicitThreadId
      >
        <BankingSuggestions />
        <LayoutComponent
          selectedThreadId={threadId}
          onSelectThread={selectThread}
          onCreateThread={createThread}
        >
          <CopilotContext>{children}</CopilotContext>
        </LayoutComponent>
        <CopilotPopup
          agentId="default"
          threadId={threadId}
          defaultOpen={false}
          labels={{
            modalHeaderTitle: IDENTITY.assistant,
            welcomeMessageText: IDENTITY.greeting,
          }}
        />
      </CopilotChatConfigurationProvider>
    </CopilotKit>
  );
}
