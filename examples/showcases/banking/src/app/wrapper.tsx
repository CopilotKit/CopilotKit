"use client";
import { LayoutComponent } from "@/components/layout";
import {
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  defineToolCallRenderer,
  ToolCallStatus,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import type {
  ReactActivityMessageRenderer,
  ReactToolCallRenderer,
} from "@copilotkit/react-core/v2";
import { Check, Loader2, Wrench } from "lucide-react";
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

// Human-readable labels for the tool-call chips. Anything not listed falls back
// to a prettified version of the raw tool name.
const TOOL_LABELS: Record<string, string> = {
  recall_memory: "Recalling from long-term memory",
  save_memory: "Saving to long-term memory",
  createReport: "Filing the report",
  render_report: "Building the report on the canvas",
  generateSandboxedUi: "Generating an interactive UI",
  showCharges: "Opening the charges page",
  showTransactions: "Pulling up transactions",
  showPendingApprovals: "Loading the approvals queue",
};

function prettifyToolName(name: string): string {
  const spaced = name
    // Drop MCP namespacing (e.g. "mcp__intelligence__recall_memory") so the
    // fallback label reads cleanly.
    .replace(/^mcp[_]+(intelligence[_]+)?/i, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Resolve the display label for a tool call. Matches on `includes` so that
// MCP-namespaced names (e.g. "mcp__intelligence__recall_memory") still map to
// the friendly label for "recall_memory".
function resolveToolLabel(name: string): string {
  for (const key of Object.keys(TOOL_LABELS)) {
    if (name === key || name.includes(key)) return TOOL_LABELS[key];
  }
  return prettifyToolName(name);
}

/**
 * A small, always-visible chip for EVERY tool the agent calls — the wildcard
 * ("*") tool-call renderer. CopilotKit only falls back to this for tool calls
 * that have no exact renderer of their own, so it surfaces the otherwise
 * invisible ones (recall_memory / save_memory from the Intelligence memory MCP,
 * createReport, render_report, generateSandboxedUi) while the charts and HITL
 * cards keep their own rich renders. It's what makes "show the tool calls"
 * literally true in the transcript: a spinner while running, a check when done.
 */
function ToolCallChip({
  name,
  status,
}: {
  name: string;
  status: ToolCallStatus;
}) {
  const label = resolveToolLabel(name);
  const done = status === ToolCallStatus.Complete;
  return (
    <div className="my-1.5 inline-flex max-w-fit items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-soft">
      <span className="flex h-4 w-4 items-center justify-center text-brand-indigo dark:text-brand-violet">
        {done ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
      </span>
      <Wrench className="h-3 w-3 text-ink-muted" aria-hidden />
      <span className="uppercase tracking-wide text-ink-muted">tool</span>
      <span aria-hidden className="text-ink-muted">
        ·
      </span>
      <span>{label}</span>
    </div>
  );
}

// Module-level stable array — CopilotKitProvider requires a stable
// `renderToolCalls` reference across renders.
const TOOL_CALL_RENDERERS: ReactToolCallRenderer<unknown>[] = [
  defineToolCallRenderer({
    name: "*",
    render: ({ name, status }) => <ToolCallChip name={name} status={status} />,
  }),
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

// A small library of suggestion pills. Each context below picks 3-4 of these,
// so the copilot only ever offers what's relevant to where the officer is —
// not one long undifferentiated wall of pills.
const PILL = {
  approveGoogleAds: {
    // BEAT 1 — the teachable over-limit ask (Marketing policy trips the gate).
    title: "Approve the $5,000 Google Ads charge",
    message: "Approve the $5,000 Google Ads charge on the Marketing policy.",
  },
  reviewPending: {
    // BEAT 2 setup — surfaces the pending, over-limit charges for the demo.
    title: "Review my pending transactions",
    message: "Show me my pending transactions.",
  },
  awsCharge: {
    // BEAT 3 — recall / generalization to a DIFFERENT over-limit charge.
    title: "How should I handle the $15,000 AWS charge?",
    message:
      "The $15,000 AWS charge is over its policy limit. How should I handle it?",
  },
  approvalsExplain: {
    title: "How do approvals work?",
    message: "Explain how an over-limit charge gets cleared and approved.",
  },
  spendingTrend: {
    title: "Show the spending trend",
    message: "Show me the spending trend over time.",
  },
  budgetsNearLimit: {
    title: "Budgets near their limit?",
    message:
      "Show me budget usage by policy — which ones are close to or over their limit?",
  },
  whereMoney: {
    title: "Where is the money going?",
    message: "Where is the money going? Break down spend by team.",
  },
  cashFlow: {
    title: "How's our cash flow?",
    message: "Compare our income vs expenses — how is our cash flow?",
  },
  spendExplorer: {
    title: "Build an interactive spend explorer",
    message:
      "Build an interactive spend explorer I can filter and play with — pull the real transactions and policies.",
  },
  q2Report: {
    title: "Prep the Q2 spend report",
    message:
      "Prepare a Q2 spend report for the board: summarize spend against budgets, call out anything over limit or pending, and file it as a report.",
  },
  buildCanvasReport: {
    title: "Build a spend report on the canvas",
    message:
      "Build a full spend report on the canvas: KPIs, the spending trend, budget usage, and a spend breakdown by team.",
  },
  addCard: {
    title: "Add an expense card",
    message: "Add a new expense card",
  },
  changePin: {
    title: "Change my card PIN",
    message: "I want to change the PIN on my Visa card.",
  },
  inviteMember: {
    title: "Invite a team member",
    message: "Invite a new member to my team.",
  },
  topExpensiveCharges: {
    title: "Show me the 10 most expensive charges",
    message: "Show me the 10 most expensive charges.",
  },
  chargesOverLimit: {
    title: "Which charges are over limit?",
    message: "Which charges are over their policy limit? Show them ranked.",
  },
  askScreen: {
    title: "What's on my screen?",
    message:
      "Look at the page I'm on right now and tell me what's on screen — the key elements and the figures shown.",
  },
  favoriteFood: {
    title: "What's my favorite food?",
    message: "What's my favorite food?",
  },
  approveAws: {
    // Self-learning trigger: AWS is over its policy limit, so with no saved
    // procedure the agent offers to record how the officer clears it (the
    // teach → demonstrate → save arc), then recalls it for future charges.
    title: "Approve the $15,000 AWS charge",
    message: "Approve the $15,000 AWS charge.",
  },
} as const;

type Pill = { title: string; message: string };

// A fixed, curated demo set — the SAME bubbles everywhere, independent of
// where the officer is in the app. Ordered to walk the capabilities end to end:
//   1. show a chart
//   2. change something in the app, driven by the agent
//   3. change a card PIN (entered in the app UI, not typed into the chat)
//   4. ask about the elements on the current screen
//   5. the 10 most expensive charges (navigate + stack-rank)
//   6. generate + file the Q2 report
//   7. recall a fact from long-term memory
//   8. approve the over-limit AWS charge (triggers the self-learning teach arc)
const DEMO_SUGGESTIONS: Pill[] = [
  PILL.spendingTrend,
  PILL.addCard,
  PILL.changePin,
  PILL.askScreen,
  PILL.topExpensiveCharges,
  PILL.q2Report,
  PILL.favoriteFood,
  PILL.approveAws,
];

function BankingSuggestions() {
  useConfigureSuggestions({
    available: "always",
    suggestions: DEMO_SUGGESTIONS,
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
      // Wildcard tool-call chip: renders a visible "tool · <label>" pill for
      // every tool call that has no richer renderer of its own — recall_memory,
      // save_memory, createReport, render_report, etc. This is what makes the
      // agent's tool use visible in the transcript ("show the tool calls").
      renderToolCalls={TOOL_CALL_RENDERERS}
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
