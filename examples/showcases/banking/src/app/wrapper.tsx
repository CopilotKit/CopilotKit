"use client";
import { LayoutComponent } from "@/components/layout";
import {
  CopilotChatConfigurationProvider,
  CopilotKit,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import CopilotContext from "@/components/copilot-context";
import { useAuthContext } from "@/components/auth-context";
import { useThreadSelection } from "@/components/threads/use-thread-selection";
import { ChatInboxProvider } from "@/components/chat/chat-inbox-context";
import { ChatPanel } from "@/components/chat/chat-panel";

// Static suggestion pills shown on the welcome screen / before-first-message.
// In v2, suggestions are registered via `useConfigureSuggestions` rather than a
// prop on the chat component (the v1 `suggestions` prop does not exist on the
// v2 component — it's omitted from `CopilotChatProps` and supplied via the hook
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
      // The AG-UI dev inspector renders a floating widget in the top-right
      // corner on localhost. That corner now belongs to the docked right-side
      // chat panel's header (its close button lives there), so the inspector
      // would overlap and block it. The inspector is a debug-only tool with no
      // effect on the agent runtime/HITL/tools, so disable it for a clean,
      // unobstructed panel. (It is localhost-only anyway and never ships to a
      // deployed demo.)
      enableInspector={false}
    >
      {/*
        Anchor the whole chat surface to the actively-selected thread. The
        agentId is "default" — the runtime registers `agents: { default: ... }`
        and the SDK's default agentId is also "default" (NOT "bankingAgent").
        `hasExplicitThreadId` tells the SDK the threadId is a real caller choice
        so frontend-tool round-trips keep their thread anchor. This outer
        provider also stays in sync with the docked panel's open/close state
        (the sidebar's modal state propagates upward), which the inbox overlay
        reads to know when the panel is showing.
      */}
      <CopilotChatConfigurationProvider
        agentId="default"
        threadId={threadId}
        hasExplicitThreadId
      >
        <BankingSuggestions />
        {/*
          ChatInboxProvider carries the inbox open/closed state + the thread
          actions (select/create) so the panel header and the inbox rows can
          switch or start conversations and collapse the inbox in one place.
          The docked panel starts CLOSED for a clean first impression; a
          floating toggle button (bottom-right) opens it.
        */}
        <ChatInboxProvider
          selectedThreadId={threadId}
          onSelectThread={selectThread}
          onCreateThread={createThread}
        >
          <LayoutComponent>
            <CopilotContext>{children}</CopilotContext>
          </LayoutComponent>
          <ChatPanel threadId={threadId} />
        </ChatInboxProvider>
      </CopilotChatConfigurationProvider>
    </CopilotKit>
  );
}
