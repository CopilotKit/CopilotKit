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
import { ProactiveNotice } from "@/components/wow/proactive-notice";
import { ReportCopilotTools } from "@/components/wow/report-tool";
import { GlassEngineProvider } from "@/components/glass-engine-context";
import { InspectorStoreProvider } from "@/lib/inspector/store";
import { InspectorPane } from "@/components/inspector/inspector-pane";
import { sandboxFunctions } from "@/opengen/sandbox-functions";
import { SandboxDataSync } from "@/opengen/sandbox-data-sync";

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

// Same handoff treatment for Open Generative UI: the sandboxed iframe renders
// full-region on the canvas (see <ReportCanvas/>), so the chat shows only this
// pill. Registering it OVERRIDES the built-in inline OGUI renderer (user-provided
// renderers take precedence).
function OguiHandoffPill() {
  return (
    <div className="my-1.5 inline-flex max-w-fit items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-2 text-xs font-medium text-ink">
      <span className="h-2 w-2 rounded-full bg-brand" />
      <span className="uppercase tracking-wide text-ink-muted">
        interactive
      </span>
      <span aria-hidden className="text-ink-muted">
        →
      </span>
      <span>rendered on the canvas</span>
    </div>
  );
}

const A2UI_RENDERERS: ReactActivityMessageRenderer<unknown>[] = [
  { activityType: "a2ui-surface", content: z.any(), render: ReportHandoffPill },
  {
    activityType: "open-generative-ui",
    content: z.any(),
    render: OguiHandoffPill,
  },
];

// Static suggestion pills — the demo's full use-case catalog, available at
// ALL times (`available: "always"`), not just the welcome screen: the demo
// must stay fully click-drivable after every exchange, with zero typing.
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
//
// The remaining pills cover every other use case the demo ships: gen-UI
// charts, the approvals explainer, report artifacts, and the cross-page
// operations (PIN change, team invite) that ride navigateToPageAndPerform.
// Page-scoped fire-and-forget tools (spend alert, card replacement, flag for
// review) are deliberately NOT pilled: they only exist on the home route, so
// a global pill for them would be a broken promise on every other page.

// Design brief handed to generateSandboxedUi so generated UIs match the demo's
// look instead of the generic DEFAULT_DESIGN_SKILL. Dark-mode aware, brand accent,
// glass surfaces, Geist type — the same language as the curated cards.
const NORTHWIND_DESIGN_SKILL = `You are designing UI for Northwind Finance, a
corporate banking dashboard. Match its aesthetic:
- Surfaces: rounded-2xl cards, subtle hairline borders, soft shadow, a translucent
  "glass" surface over the page background. Generous padding.
- Type: the Geist sans-serif family; clear hierarchy (semibold headings, muted
  secondary text). Currency in USD with thousands separators.
- Color: a restrained neutral base with a single indigo/violet brand accent for
  emphasis, positive = green, negative/over-limit = red. Never rainbow palettes.
- Dark-mode aware: read colors from CSS variables / prefers-color-scheme; never
  hardcode white backgrounds.
- Keep it calm, precise, and enterprise-appropriate — this is a finance tool.`;

function BankingSuggestions() {
  useConfigureSuggestions({
    available: "always",
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
      // ── A2UI report canvas ───────────────────────────────────────────────
      {
        title: "Build a spend report on the canvas",
        message:
          "Build a full spend report on the canvas: KPIs, the spending trend, budget usage, and a spend breakdown by team.",
      },
      // ── Gen-UI charts ────────────────────────────────────────────────────
      {
        title: "Show the spending trend",
        message: "Show me the spending trend over time.",
      },
      {
        title: "Budgets near their limit?",
        message:
          "Show me budget usage by policy — which ones are close to or over their limit?",
      },
      {
        title: "Where is the money going?",
        message: "Where is the money going? Break down spend by team.",
      },
      {
        title: "How's our cash flow?",
        message: "Compare our income vs expenses — how is our cash flow?",
      },
      // ── Open Generative UI (custom interactive surfaces) ─────────────────
      {
        // OGUI-only: an interactive explorer the fixed catalog can't express.
        // "interactive"/"explorer" (not "build") is what routes this to
        // generateSandboxedUi; figures come from the sandbox functions.
        title: "Build an interactive spend explorer",
        message:
          "Build an interactive spend explorer I can filter and play with — pull the real transactions and policies.",
      },
      {
        title: "Prototype a cash-flow what-if calculator",
        message:
          "Prototype an interactive what-if calculator for our cash flow using our real income and expense figures.",
      },
      {
        title: "How do approvals work?",
        message: "Explain how an over-limit charge gets cleared and approved.",
      },
      // ── Work product ─────────────────────────────────────────────────────
      {
        title: "Prep the Q2 spend report",
        message:
          "Prepare a Q2 spend report for the board: summarize spend against budgets, call out anything over limit or pending, and file it as a report.",
      },
      // ── Cross-page operations (navigateToPageAndPerform fallbacks) ──────
      {
        title: "Change my card PIN",
        message: "I want to change the PIN on my Visa card.",
      },
      {
        title: "Invite a team member",
        message: "Invite a new member to my team.",
      },
    ],
  });
  return null;
}

export function CopilotKitWrapper({
  children,
  glassAvailable = false,
  resetEnabled = false,
}: {
  children: React.ReactNode;
  glassAvailable?: boolean;
  resetEnabled?: boolean;
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
      properties={{ userRole: currentUser?.role, userId: currentUser?.id }}
      // A2UI report canvas. The agent calls the backend render_report tool,
      // whose ops the A2UI middleware turns into an `a2ui-surface` activity; the
      // banking catalog here lets the client render those ops. The agent selects
      // widgets via render_report's typed params, so it does NOT need the raw
      // A2UI component schema (no includeSchema). `renderActivityMessages`
      // replaces the built-in inline surface renderer with a small handoff pill —
      // the surface itself renders full-screen in <ReportCanvas/>.
      a2ui={{ catalog }}
      renderActivityMessages={A2UI_RENDERERS}
      openGenerativeUI={{
        sandboxFunctions,
        designSkill: NORTHWIND_DESIGN_SKILL,
      }}
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
      // Surface the product web-inspector (<CopilotKitInspector>) on every host —
      // this reference demo showcases it. `true` (not "auto") so deployed demo
      // hosts show it too; the provider mounts it automatically when this is set.
      showDevConsole={true}
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
        <SandboxDataSync />
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
                  <LayoutComponent resetEnabled={resetEnabled}>
                    <CopilotContext>{children}</CopilotContext>
                  </LayoutComponent>
                  <ChatPanel threadId={threadId} />
                  <ProactiveNotice />
                  <ReportCopilotTools />
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
