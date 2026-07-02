"use client";
import { LayoutComponent } from "@/components/layout";
import {
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  useConfigureSuggestions,
  type ReactActivityMessageRenderer,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { catalog } from "@/a2ui/catalog";
import { CanvasProvider } from "@/components/canvas/canvas-context";
import CopilotContext from "@/components/copilot-context";
import { useAuthContext } from "@/components/auth-context";
import { useThreadSelection } from "@/components/threads/use-thread-selection";
import { ChatInboxProvider } from "@/components/chat/chat-inbox-context";
import { ChatPanel } from "@/components/chat/chat-panel";
import { RecordingProvider } from "@/components/recording-context";
import { RecordingVignette } from "@/components/recording-vignette";
import { GlassEngineProvider } from "@/components/glass-engine-context";
import { InspectorStoreProvider } from "@/lib/inspector/store";
import { InspectorPane } from "@/components/inspector/inspector-pane";

// The agent's render_report tool result becomes an `a2ui-surface` activity that
// <ReportCanvas/> renders full-screen (it reads the ops from the agent message
// stream). In the chat we leave only a small handoff pill in place of the
// built-in inline surface renderer. Module-level so the array reference stays
// stable across renders (CopilotKitProvider requires a stable
// `renderActivityMessages` array).
function ReportHandoffPill() {
  return (
    <div className="my-1.5 inline-flex max-w-fit items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-2 text-xs font-medium text-ink">
      <span className="h-2 w-2 rounded-full bg-brand" />
      <span className="uppercase tracking-wide text-ink-muted">report</span>
      <span aria-hidden className="text-ink-muted">
        →
      </span>
      <span>rendered on the canvas</span>
    </div>
  );
}

const A2UI_RENDERERS: ReactActivityMessageRenderer<unknown>[] = [
  { activityType: "a2ui-surface", content: z.any(), render: ReportHandoffPill },
];

// Static suggestion pills shown on the welcome screen / before-first-message.
// In v2, suggestions are registered via `useConfigureSuggestions` rather than a
// prop on the chat component (the v1 `suggestions` prop does not exist on the
// v2 component — it's omitted from `CopilotChatProps` and supplied via the hook
// instead). See packages/react-core/src/v2/hooks/use-configure-suggestions.tsx
// and packages/react-core/src/v2/components/chat/CopilotChat.tsx (line 41–46).
//
// The first three pills are sequenced to drive the self-learning demo arc
// (FOR-137). The agent prompt (api/copilotkit/[[...slug]]/route.ts) deliberately
// never explains the over-policy-limit unlock, and the agent only ever sees
// exception *codes*, never their human labels — so a fresh agent must LEARN,
// by watching an officer file a justifying exception, both that over-limit
// charges can be unlocked and which codes justify it.
//   1. Teach-ask  — hits the gate (agent correctly stalls before learning).
//   2. Teach-setup — surfaces the pending charges so the officer can
//      demonstrate the unlock inline (that demonstration is what gets recorded).
//   3. Recall     — on a FRESH thread after distill, the agent applies the
//      learned procedure to a DIFFERENT over-limit charge it was never taught.
// Titles stay symptom-only: they must NOT hint at the exception path the agent
// is meant to learn on its own.
function BankingSuggestions() {
  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      {
        // BEAT 1 — the teachable ask. Seed t-1: Google Ads, -$5,000, Marketing
        // policy (limit $5,000 / spent $500 → approving always trips
        // OVER_POLICY_LIMIT). Pre-learning the agent stalls here correctly;
        // post-learning the same ask succeeds. Leads the welcome screen.
        title: "Approve the $5,000 Google Ads charge",
        message:
          "Approve the $5,000 Google Ads charge on the Marketing policy.",
      },
      {
        // BEAT 2 setup — surfaces the pending charges (all three are over their
        // policy limit) via showTransactions, the unconditional-render tool
        // that is reliable in every mode. The officer files a policy exception
        // inline on a row to demonstrate the unlock; that is the recorded
        // demonstration the writer agent distills into /knowledge.
        title: "Review my pending transactions",
        message: "Show me my pending transactions.",
      },
      {
        // BEAT 3 — recall / generalization. On a fresh thread after the
        // demonstration is distilled, the agent should apply the learned
        // procedure to a DIFFERENT over-limit charge it was never explicitly
        // taught (seed t-2: AWS, -$15,000, Engineering policy, limit $15,000 /
        // spent $1,500), proving transferable memory, not per-row memorization.
        title: "How should I handle the $15,000 AWS charge?",
        message:
          "The $15,000 AWS charge is over its policy limit. How should I handle it?",
      },
      {
        // Breadth — a clean non-arc capability (the generative-UI card flow).
        title: "Add an expense card",
        message: "Add a new expense card",
      },
      {
        title: "Build a spend report on the canvas",
        message:
          "Build a full spend report on the canvas: KPIs, the spending trend, budget usage, and a spend breakdown by team.",
      },
      // Generative-UI charts — each message echoes the matching show* tool's
      // description (copilot-context.tsx) so the agent renders the chart in chat
      // instead of answering in plain text.
      {
        title: "Show our spending trend",
        message: "How has our spending changed over time? Show it as a chart.",
      },
      {
        title: "Budget usage by team",
        message:
          "Which teams are close to or over their budget limit? Show budget usage.",
      },
      {
        title: "Break down spend by team",
        message: "Where is the money going? Break our spend down by team.",
      },
      {
        title: "Income vs expenses",
        message:
          "How does our income compare to expenses, and what's our net position?",
      },
    ],
  });
  return null;
}

export function CopilotKitWrapper({
  children,
  glassAvailable = false,
}: {
  children: React.ReactNode;
  glassAvailable?: boolean;
}) {
  const { currentUser } = useAuthContext();
  const { threadId, selectThread, createThread } = useThreadSelection();

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      // The runtime route is the multi-endpoint REST handler
      // (createCopilotHonoHandler at api/copilotkit/[[...slug]]: /info,
      // /agent/{id}/run, /agent/{id}/connect). The single-endpoint transport
      // POSTs to /api/copilotkit and 404s against this handler, so stay in REST
      // (multi-route) mode.
      useSingleEndpoint={false}
      properties={{ userRole: currentUser?.role }}
      // A2UI report canvas. The agent calls the backend render_report tool,
      // whose ops the A2UI middleware turns into an `a2ui-surface` activity; the
      // banking catalog here lets the client render those ops. The agent selects
      // widgets via render_report's typed params, so it does NOT need the raw
      // A2UI component schema (no includeSchema). `renderActivityMessages`
      // replaces the built-in inline surface renderer with a small handoff pill —
      // the surface itself renders full-screen in <ReportCanvas/>.
      a2ui={{ catalog }}
      renderActivityMessages={A2UI_RENDERERS}
      // Use the v2-native CopilotKitProvider, NOT the v1 `CopilotKit`
      // compatibility bridge. The bridge wraps the chat in a heavier stack (its
      // own ThreadsProvider + a second CopilotChatConfigurationProvider +
      // listeners); that extra churn re-fires CopilotChat's /connect effect
      // cleanup mid-run, and the cleanup calls AG-UI `detachActiveRun()` — which
      // silently tears down the in-flight run the instant the agent emits a
      // frontend (HITL) tool call, so the tool's render() never mounts and the
      // chat appears "stuck". CopilotKitProvider is the lean stack the working
      // e-commerce reference uses; our inbox's `useThreads` (from /v2) reads
      // CopilotKitProvider's own context, so the inbox keeps working.
      showDevConsole={false}
    >
      {/*
        Anchor the whole chat surface to the actively-selected thread. The
        agentId is "default" — the runtime registers `agents: { default: ... }`
        and the SDK's default agentId is also "default" (NOT "bankingAgent").
        We pass `threadId` and let the provider infer explicit-thread mode
        (CopilotChatConfigurationProvider treats a supplied threadId as
        explicit), matching the working e-commerce reference. This outer
        provider also stays in sync with the docked panel's open/close state
        (the sidebar's modal state propagates upward), which the inbox overlay
        reads to know when the panel is showing.
      */}
      <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
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
          {/*
            RecordingProvider exposes the teach-mode `isRecording` flag; the
            <RecordingVignette/> reads it to pulse a soft violet glow around the
            canvas while an officer demonstration is being recorded. It wraps
            BOTH the page content and the chat panel so every demonstration
            call site (the transactions list approve/deny, the inline policy
            exception card) is inside it.
          */}
          <GlassEngineProvider available={glassAvailable}>
            <InspectorStoreProvider>
              <RecordingProvider>
                {/*
                  CanvasProvider derives whether a report surface is active from
                  the agent message stream (+ a local dismiss for the "← Back"
                  control). It must be an ancestor of LayoutComponent, which calls
                  useCanvas() to render <ReportCanvas/> in place of the page body.
                */}
                <CanvasProvider>
                  <LayoutComponent>
                    <CopilotContext>{children}</CopilotContext>
                  </LayoutComponent>
                  <ChatPanel threadId={threadId} />
                </CanvasProvider>
                {/* Mount the pane (and its AG-UI subscription) ONLY where the
                    deployment opted in. Public hosts never subscribe. */}
                {glassAvailable && <InspectorPane />}
                <RecordingVignette />
              </RecordingProvider>
            </InspectorStoreProvider>
          </GlassEngineProvider>
        </ChatInboxProvider>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
}
