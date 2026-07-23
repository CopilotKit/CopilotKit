import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotChatInput,
  CopilotKit,
  useAgent,
  useCopilotChatConfiguration,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import type { CopilotChatInputProps } from "@copilotkit/react-core/v2";
import { ExampleLayout } from "@/components/example-layout";
import type { ExampleLayoutMode } from "@/components/example-layout";
import { PmBoard } from "@/components/pm-board";
import { Dashboard } from "@/components/dashboard";
import { SEED_ISSUES } from "@/components/dashboard/seed-issues";
import type { Issue } from "@/components/pm-board/types";
import { ISSUE_STATUSES } from "@/components/pm-board/types";
import { ThreadsDrawer } from "@/components/threads-drawer";
import { ThemeShell } from "@/components/theme-shell";
import { AgentSelector } from "@/components/agent-selector";
import type { AgentId } from "@/components/agent-selector";
import { EventInspector } from "@/components/event-inspector";
import { ThemeProvider } from "@/hooks/use-theme";
import {
  COWORK_SUGGESTIONS,
  DASHBOARD_SUGGESTIONS,
  useExampleSuggestions,
  useGenerativeUIExamples,
} from "@/hooks";
import { demonstrationCatalog } from "@/declarative-generative-ui/renderers";
import { buildSprintNotesMessageContent } from "@/lib/mock-sprint-notes";
import styles from "@/components/threads-drawer/threads-drawer.module.css";

/** Title of the suggestion chip that should auto-attach the sprint notes. */
const PLAN_SPRINT_SUGGESTION_TITLE = "Plan next sprint";

/**
 * Hardcoded responses for the Dashboard Designer (ADK) demo chips. The
 * normal flow goes user-message → agent → updateDashboard tool, but the
 * demo plays the same every time only if we own the response entirely.
 * Each entry decides what the suggestion-click handler does instead of
 * running the agent:
 *   - `dashboard` patches agent.state.dashboard directly (pass null to skip,
 *     {} to clear, or an object to switch modes / set filters)
 *   - `assistantContent` is the assistant bubble text shown above the tool
 *   - `toolCall` (optional) is rendered inline by a registered useComponent;
 *     a paired ToolMessage is added so the renderer transitions out of the
 *     "executing" state into "complete"
 *
 * Matched by suggestion title — keep these in lockstep with the chip
 * titles in `useExampleSuggestions`.
 */
/**
 * `toolCall.arguments` can be either a static object or a function that
 * receives the live issues array (after lazy-seeding) and returns the
 * args. Use the function form when the inline component should reflect
 * the current board state — e.g. the by-status bar chart re-computes
 * counts from agent.state.issues so the chart matches whatever cards
 * have been moved.
 */
type HardcodedToolCall = {
  name: string;
  arguments:
    | Record<string, unknown>
    | ((ctx: { issues: Issue[] }) => Record<string, unknown>);
};

type HardcodedDashboardResponse = {
  dashboard?: Record<string, unknown>;
  /**
   * Optional paint-in prelude. Set to a dashboard-state shape (e.g.
   * `{ mode: "building" }` or `{ mode: "buildingProfile", person: "Sarah",
   * insight: "..." }`) and the chip handler will set this state first,
   * wait for the paint-in animation to land (~1.3s), then patch in the
   * main `dashboard` state. Without `prelude`, the chip skips paint-in.
   */
  prelude?: Record<string, unknown>;
  assistantContent: string;
  toolCall?: HardcodedToolCall;
};

const BUILD_DASHBOARD_TITLE = "Build the dashboard";
const SARAH_PROFILE_TITLE = "Sarah's workload";
const URGENT_RIGHT_NOW_TITLE = "Urgent right now";
const WHATS_IN_FLIGHT_TITLE = "What's in flight?";
const WHO_HAS_MOST_TITLE = "Who has the most work?";
const RESET_DASHBOARD_TITLE = "Reset the dashboard";
const BAR_CHART_BY_STATUS_TITLE = "Bar chart by status";

const HARDCODED_DASHBOARD_RESPONSES: Record<
  string,
  HardcodedDashboardResponse
> = {
  [BUILD_DASHBOARD_TITLE]: {
    // Empty dashboard state = full backlog view with no filter applied.
    // The chip handler also opens app mode so the dashboard pane slides
    // in while the assistant reply streams in, giving the impression of
    // the dashboard being assembled on the fly. `prelude` flips the
    // dashboard into the aggregate-shape paint-in view for ~1.3s before
    // the final `dashboard: {}` takes over.
    prelude: { mode: "building" },
    dashboard: {},
    assistantContent:
      "Built you a dashboard from the current backlog — totals up top, donut by status, urgency bars, and a per-assignee breakdown. Ask me to filter or zoom into anyone.",
  },
  [SARAH_PROFILE_TITLE]: {
    // Switches the dashboard pane into the staggered-entrance person
    // profile view (apps/app/src/components/dashboard/person-profile.tsx).
    // `prelude` paints in the person-profile shape (header / stats /
    // insight / section title) before the real PersonProfileView mounts,
    // so the demo reads as "the agent is composing the profile" instead
    // of the panel popping in fully formed.
    prelude: {
      mode: "buildingProfile",
      person: "Sarah",
      insight:
        "Sarah's load is front-weighted on planning (Q3 roadmap kickoff) and compliance (GDPR data export). Two design tickets are sitting in backlog with no due date — safe to defer if she needs to clear the planning queue first.",
    },
    dashboard: {
      mode: "personProfile",
      person: "Sarah",
      filter: { assignee: "Sarah" },
      focus: "Showing everything Sarah is working on.",
      insight:
        "Sarah's load is front-weighted on planning (Q3 roadmap kickoff) and compliance (GDPR data export). Two design tickets are sitting in backlog with no due date — safe to defer if she needs to clear the planning queue first.",
    },
    assistantContent:
      "Pulled up Sarah's full ticket profile in the dashboard — quick stats, an AI insight, and her open work in priority order.",
  },
  [URGENT_RIGHT_NOW_TITLE]: {
    // `issueIds` resolves against agent.state.issues — the suggestion
    // handler seeds SEED_ISSUES into agent state on the first ADK chip
    // click, so the lookup matches the kanban's same mock-data source.
    assistantContent:
      "Here are the issues marked Urgent right now — both are payment / infra and have hard due dates this week.",
    toolCall: {
      name: "issueTable",
      arguments: {
        issueIds: ["ISS-101", "ISS-107"],
        caption: "Urgent issues",
      },
    },
  },
  [WHATS_IN_FLIGHT_TITLE]: {
    assistantContent:
      "Four tickets are actively in progress right now — two urgent infra fixes plus a lodash migration and a Slack-notifications dedupe.",
    toolCall: {
      name: "issueTable",
      arguments: {
        issueIds: ["ISS-101", "ISS-107", "ISS-114", "ISS-118"],
        caption: "In progress",
      },
    },
  },
  [WHO_HAS_MOST_TITLE]: {
    assistantContent:
      "Workload is fairly even — every assignee is carrying five open tickets. Watch Jordan and Alex; both have an Urgent infra item on top of their queue.",
    toolCall: {
      name: "barChart",
      arguments: {
        title: "Open issues by assignee",
        description: "Tickets per person across the current backlog.",
        data: [
          { label: "Alex", value: 5 },
          { label: "Jordan", value: 5 },
          { label: "Sarah", value: 5 },
          { label: "Priya", value: 5 },
        ],
      },
    },
  },
  [RESET_DASHBOARD_TITLE]: {
    dashboard: {},
    assistantContent: "Cleared the filter — showing the full backlog again.",
  },
  // Cowork (LangGraph) kanban chip. Inline `barChart` generative UI
  // component, with bar values computed at click-time from the live
  // issues array so the chart reflects whatever cards have been moved.
  [BAR_CHART_BY_STATUS_TITLE]: {
    assistantContent:
      "Here's the breakdown of open issues by status — In Progress and Backlog are carrying the most weight right now.",
    toolCall: {
      name: "barChart",
      arguments: ({ issues }) => ({
        title: "Issues by status",
        description: "Open ticket count per workflow column.",
        data: ISSUE_STATUSES.map((status) => ({
          label: status,
          value: issues.filter((i) => i.status === status).length,
        })),
      }),
    },
  },
};

// Demo override: the BFF has no /transcribe endpoint, so the default voice
// pipeline throws. We still want the mic button to record and animate, then
// drop a canned utterance into the input box (without sending) so the demo
// flows like a real voice transcript.
const MOCK_TRANSCRIPT = "Plan the next sprint using these meeting notes";

/**
 * Lookup of chip message → suggestion record. Built once from the same
 * suggestion lists `useExampleSuggestions` registers, so we can route a
 * *typed* chip message through the same `handleSelectSuggestion` handler
 * that a click would. Without this, typing e.g. "Show me everything Sarah
 * is working on." goes through the default input path → runAgent →
 * aimock → catch-all (because the hardcoded ADK chips never had fixtures
 * — they short-circuit on the click handler), and the demo looks broken.
 *
 * Exact-match by message text. Trims whitespace on lookup so leading /
 * trailing spaces don't defeat the match. Lower-case isn't normalized
 * because the chips ship in sentence case and we want the user to feel
 * the canned response is "earned" by typing the exact prompt — fuzzy
 * matching would also fire on prefixes ("Plan the next sprint" alone)
 * that the demo isn't tuned for.
 */
const CHIP_MESSAGE_LOOKUP: Record<string, { title: string; message: string }> =
  Object.fromEntries(
    [...COWORK_SUGGESTIONS, ...DASHBOARD_SUGGESTIONS].map((s) => [
      s.message.trim().toLowerCase(),
      s,
    ]),
  );

function findMatchingSuggestion(
  raw: string,
): { title: string; message: string } | undefined {
  const key = raw.trim().toLowerCase();
  return CHIP_MESSAGE_LOOKUP[key];
}

/**
 * Args dispatch for the Get Data → Build Dashboard narration. Keeps the
 * ToolReasoning expander informative (concrete-looking parameters per
 * chip) so the canned response reads as "the agent looked at the right
 * data" instead of "the demo replayed two empty tool calls."
 */
const DATA_PIPELINE_ARGS: Record<
  string,
  { getData: Record<string, unknown>; buildDashboard: Record<string, unknown> }
> = {
  "Build the dashboard": {
    getData: { source: "backlog", count: 20 },
    buildDashboard: {
      widgets: ["totals", "byStatus", "byPriority", "byAssignee"],
    },
  },
  "Sarah's workload": {
    getData: { assignee: "Sarah", count: 5 },
    buildDashboard: { view: "personProfile", person: "Sarah" },
  },
};

const runtimeUrl = "/api/copilotkit";

interface ChatWiredProps {
  // Lifted from HomePage so the AgentSelector can render below the input
  // pill (via the disclaimer slot) instead of in the chat header — keeps
  // it out of the way of the top-right ModeToggle in chat mode.
  agentId: AgentId;
  onAgentChange: (id: AgentId) => void;
  // Called from the hardcoded ADK chip handler so clicking a Dashboard
  // Designer suggestion in chat-only mode pops the right pane open while
  // the assistant reply streams in. Without it, users see the canned text
  // but the dashboard never reveals itself.
  onOpenApp: () => void;
  // Called when a thread becomes "used" — i.e. the user has sent a message
  // or fired a hardcoded chip. HomePage records this in
  // localActiveThreads so the drawer can synthesize a row for client-only
  // threads (ADK hardcoded chips never call runAgent, so the Intelligence
  // platform never creates a server-side row — without local tracking the
  // Designer thread is invisible in the drawer).
  onThreadTouched: () => void;
}

function ChatWired({
  agentId,
  onAgentChange,
  onOpenApp,
  onThreadTouched,
}: ChatWiredProps) {
  // Inside CopilotChatConfigurationProvider so useConfigureSuggestions and
  // useFrontendTool resolve against the active chat config's agentId. Hoisted
  // up to HomePage caused suggestions to register before the chat config was
  // available and the welcome-screen suggestion list rendered empty.
  useGenerativeUIExamples();
  useExampleSuggestions();

  const config = useCopilotChatConfiguration();
  const { agent } = useAgent({ agentId: config?.agentId });
  const { copilotkit } = useCopilotKit();

  // Emit the two-step Get Data → Build Dashboard reasoning chain that
  // precedes a dashboard render for the Dashboard Designer chips listed in
  // DATA_PIPELINE_ARGS. Each tool call lands in the chat as an assistant
  // message (rendered via useDefaultRenderTool → ToolReasoning), spins for
  // ~600ms, then transitions to "complete" when we add the matching tool
  // result. Total ≈1.3s — same beat the build-dashboard chip used as a
  // plain sleep, so the dashboard-pane paint-in animation still gets time
  // to play through.
  const narrateDataPipeline = useCallback(
    async (title: string) => {
      const args = DATA_PIPELINE_ARGS[title];
      if (!args) return;
      const emit = async (
        name: string,
        parameters: Record<string, unknown>,
      ) => {
        const toolCallId = crypto.randomUUID();
        agent.addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: toolCallId,
              type: "function",
              function: { name, arguments: JSON.stringify(parameters) },
            },
          ],
        });
        // Hold "executing" so the spinner registers before the green
        // check; ~600ms feels deliberate without dragging.
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
        agent.addMessage({
          id: crypto.randomUUID(),
          role: "tool",
          toolCallId,
          content: "ok",
        });
      };
      await emit("getData", args.getData);
      // Brief gap so the second tool's spinner doesn't share a frame
      // with the first tool's check.
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      await emit("buildDashboard", args.buildDashboard);
    },
    [agent],
  );

  // Slash commands. CopilotChatInput surfaces these in a popover when the
  // user types "/" and runs the matching item's action on Enter — bypassing
  // the LLM entirely, which is what you want for destructive shortcuts.
  const toolsMenu = useMemo(
    () => [
      {
        label: "clear",
        action: () => agent.setState({ issues: [] }),
      },
    ],
    [agent],
  );

  // Suggestion-click interceptor. The default <CopilotChat> behavior is to
  // post the chip's `message` as a plain-text user message and run the agent.
  // We override it for the "Plan next sprint" chip so the message also carries
  // a synthetic "Sprint Cycle 52 Meeting Notes.txt" attachment — same
  // multimodal shape that <CopilotChat>'s onSubmitInput produces when the user
  // actually drops a file into the input. CopilotKit then renders the file
  // chip above the user bubble via its built-in <DocumentAttachment>, and the
  // notes content flows into the LLM context so the agent (or its aimock
  // fixture) can act on it without the user having a real file to upload.
  //
  // Anything else falls through to the same agent.addMessage + runAgent flow
  // that CopilotChat uses internally — we have to replicate it here because
  // overriding `onSelectSuggestion` on the suggestionView slot drops the
  // built-in handler entirely (renderSlot spreads user props AFTER defaults).
  const handleSelectSuggestion = useCallback(
    async (suggestion: { title?: string; message: string }) => {
      const messageId = crypto.randomUUID();
      const isPlanSprint = suggestion.title === PLAN_SPRINT_SUGGESTION_TITLE;

      // Dashboard Designer (ADK) chips: short-circuit the agent and emit a
      // hardcoded assistant message + (optional) inline tool component +
      // direct dashboard state patch. Keeps the demo deterministic and lets
      // us iterate UI/UX without touching the ADK backend.
      const hardcoded =
        suggestion.title && HARDCODED_DASHBOARD_RESPONSES[suggestion.title];
      if (hardcoded) {
        // Mark the thread as touched so the drawer renders a row for it.
        // Hardcoded ADK chips never call runAgent, so the Intelligence
        // platform never persists a thread row — without this notification
        // the new Designer conversation would be invisible in the drawer.
        onThreadTouched();

        // User message first so the bubble shows what was asked.
        agent.addMessage({
          id: messageId,
          role: "user",
          content: suggestion.message,
        });

        // Determine whether this chip walks through the Get Data → Build
        // Dashboard narration before showing the dashboard. With narration,
        // the pane stays in its current state (chat-only OR a previously-
        // rendered dashboard) while the two tool-reasoning rows play in
        // the chat. Only AFTER the Build Dashboard step lands do we flip
        // dashboard state to the prelude and open / repaint the pane —
        // otherwise an already-open pane would jump straight into the
        // paint-in animation the moment the chip fires, hiding the
        // previous content before the narration even starts. Without
        // narration, behave like before: open the pane immediately and
        // set the prelude inline.
        const shouldNarrateDataPipeline =
          suggestion.title !== undefined &&
          suggestion.title in DATA_PIPELINE_ARGS;

        // Apply the prelude (paint-in dashboard state) — seeds issues if
        // needed, then patches `dashboard` to the building / buildingProfile
        // shape. Called inline below at the right moment depending on
        // whether the chip narrates.
        const applyPrelude = () => {
          if (!hardcoded.prelude) return;
          const current = (agent.state as Record<string, unknown>) ?? {};
          agent.setState({
            ...current,
            issues:
              Array.isArray(current.issues) && current.issues.length > 0
                ? current.issues
                : SEED_ISSUES,
            dashboard: hardcoded.prelude,
          });
        };

        if (!shouldNarrateDataPipeline) {
          // Non-narrating chips (Reset, Urgent right now, etc.): open the
          // pane right away and set the prelude inline — the canned reply
          // renders into the dashboard as it appears.
          onOpenApp();
          applyPrelude();
        }

        // Simulate agent latency. Without this gap the assistant message
        // appears in the same frame as the user message — instant replies
        // read as "hardcoded" and break the demo's illusion that an LLM
        // is on the other end. Build-dashboard / Sarah's workload swap
        // the plain sleep for a two-step Get Data → Build Dashboard
        // reasoning narration that lands in the chat as ToolReasoning
        // rows. The prelude state-flip + pane-open both happen AFTER the
        // narration completes; the paint-in animation budget (~1.3s) is
        // then awaited so the reveal plays fully before the final
        // `hardcoded.dashboard` setState below flips the dashboard out of
        // the prelude state.
        if (shouldNarrateDataPipeline && suggestion.title) {
          await narrateDataPipeline(suggestion.title);
          applyPrelude();
          onOpenApp();
          if (hardcoded.prelude) {
            await new Promise<void>((resolve) => setTimeout(resolve, 1300));
          }
        } else {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, hardcoded.prelude ? 1300 : 850),
          );
        }

        // Lazy-seed agent.state.issues from SEED_ISSUES so inline
        // generative-UI tools (issueTable / issueCard / personProfile)
        // resolve the same mock dataset the kanban / dashboard render
        // from. The ADK agent itself doesn't seed state.issues (see
        // dashboard/index.tsx for why mount-time seeding races the
        // thread switch), but a user-triggered chip click is past that
        // race so it's safe here.
        const currentIssues = (agent.state as { issues?: unknown })?.issues;
        const needsSeed =
          !Array.isArray(currentIssues) || currentIssues.length === 0;

        // Patch dashboard state if the response wants to change the pane.
        // Spread current state so we don't clobber `issues` (the kanban
        // mirror) when we only mean to update the dashboard slice.
        if (hardcoded.dashboard !== undefined || needsSeed) {
          const current = (agent.state as Record<string, unknown>) ?? {};
          const nextState: Record<string, unknown> = { ...current };
          if (needsSeed) nextState.issues = SEED_ISSUES;
          if (hardcoded.dashboard !== undefined) {
            nextState.dashboard = hardcoded.dashboard;
          }
          agent.setState(nextState);
        }

        // Assistant bubble. If there's an inline tool, include the toolCall
        // on the same assistant message so they render together; otherwise
        // it's a plain text reply.
        const assistantId = crypto.randomUUID();
        if (hardcoded.toolCall) {
          const toolCallId = crypto.randomUUID();
          // Resolve `arguments` lazily so chart-style components can
          // compute their data from the live (post-seed) issues array.
          const liveIssues: Issue[] = needsSeed
            ? SEED_ISSUES
            : ((agent.state as { issues?: Issue[] })?.issues ?? SEED_ISSUES);
          const resolvedArgs =
            typeof hardcoded.toolCall.arguments === "function"
              ? hardcoded.toolCall.arguments({ issues: liveIssues })
              : hardcoded.toolCall.arguments;
          agent.addMessage({
            id: assistantId,
            role: "assistant",
            content: hardcoded.assistantContent,
            toolCalls: [
              {
                id: toolCallId,
                type: "function",
                function: {
                  name: hardcoded.toolCall.name,
                  arguments: JSON.stringify(resolvedArgs),
                },
              },
            ],
          });
          // Pair the toolCall with a ToolMessage so the inline renderer
          // moves from "executing" → "complete" status. Without this, the
          // useComponent render path treats the tool call as still running.
          agent.addMessage({
            id: crypto.randomUUID(),
            role: "tool",
            toolCallId,
            content: "ok",
          });
        } else {
          agent.addMessage({
            id: assistantId,
            role: "assistant",
            content: hardcoded.assistantContent,
          });
        }
        return;
      }

      // Mark thread as touched up front so the drawer row appears the
      // moment the user clicks send — without this we wait on the server's
      // thread upsert (which lands a few hundred ms later in the WS push)
      // before the row materializes.
      onThreadTouched();

      agent.addMessage({
        id: messageId,
        role: "user",
        content: isPlanSprint
          ? buildSprintNotesMessageContent(suggestion.message)
          : suggestion.message,
      });
      try {
        await copilotkit.runAgent({ agent });
      } catch (err) {
        console.error("[ChatWired] runAgent failed after suggestion", err);
      }
    },
    [agent, copilotkit, onOpenApp, onThreadTouched, narrateDataPipeline],
  );

  // Function-component input slot. We need closure access to the bound
  // `onChange` (the controlled-input setter CopilotChat passes through
  // CopilotChatView) so the mocked transcript handler can drop text into the
  // textarea without sending. A plain-object slot can override
  // onFinishTranscribeWithAudio but can't read the bound onChange/value.
  const InputSlot = useCallback(
    (slotProps: CopilotChatInputProps) => {
      const { value, onChange, onSubmitMessage } = slotProps;
      const handleFinishTranscribeWithAudio = async (_audioBlob: Blob) => {
        const prev = typeof value === "string" ? value.trim() : "";
        const next = prev ? `${prev} ${MOCK_TRANSCRIPT}` : MOCK_TRANSCRIPT;
        onChange?.(next);
      };
      // Intercept the input's send action. If the typed text exactly
      // matches a known chip's message, route it through the suggestion
      // handler — that way ADK hardcoded chips (Sarah's workload, Build
      // the dashboard, etc.) produce the same canned UX when typed as
      // when clicked, and Cowork chips that auto-attach assets (sprint
      // notes image) still get the attachment. Anything that doesn't
      // match falls through to the default CopilotChat send path
      // (addMessage + runAgent → BFF → aimock).
      //
      // Caveat: this discards any selected attachments on a chip match
      // — the chip path doesn't accept them. Acceptable edge case for
      // the demo since the user typing a chip message verbatim is
      // already a deliberate act.
      const handleSubmitMessage = async (raw: string) => {
        const match = findMatchingSuggestion(raw);
        if (match) {
          onChange?.("");
          await handleSelectSuggestion(match);
          return;
        }
        await onSubmitMessage?.(raw);
      };
      return (
        <CopilotChatInput
          {...slotProps}
          onSubmitMessage={handleSubmitMessage}
          disclaimer={() => (
            // Match the input pill's own `cpk:max-w-3xl cpk:mx-auto cpk:px-4`
            // sizing so the AgentSelector aligns to the pill's right edge
            // rather than the full chat-panel's right edge. Without this the
            // disclaimer slot stretches to the parent column width, which
            // looks fine in app-mode (chat panel is 420px) but visibly drifts
            // off to the right in chat-only mode where the panel is flex-1.
            //
            // Using inline styles (not `cpk:` tailwind classes) because the
            // host app's Tailwind v4 setup doesn't include CopilotKit's
            // `cpk:` prefix — those classes are dead in our CSS bundle.
            <div
              style={{
                width: "100%",
                maxWidth: "48rem", // matches Tailwind's max-w-3xl (768px)
                marginLeft: "auto",
                marginRight: "auto",
                paddingLeft: 16,
                paddingRight: 16,
                display: "flex",
                justifyContent: "flex-end",
                paddingTop: 6,
                // CopilotChatInput's outer container is pointer-events:none;
                // only the input pill gets pointer-events:auto back. The
                // disclaimer slot is a sibling, so without this it inherits
                // the none and our AgentSelector can't receive clicks/hover.
                pointerEvents: "auto",
              }}
            >
              <AgentSelector agentId={agentId} onChange={onAgentChange} />
            </div>
          )}
          className="pb-6"
          toolsMenu={toolsMenu}
          onFinishTranscribeWithAudio={handleFinishTranscribeWithAudio}
        />
      );
    },
    [toolsMenu, agentId, onAgentChange, handleSelectSuggestion],
  );

  return (
    <CopilotChat
      // Cast: SlotValue<typeof CopilotChatInput> wants the compound component
      // (static SendButton/TextArea/etc. attached). The slot runtime only
      // needs `typeof slot === "function"` to treat it as a component, so a
      // plain function component works in practice.
      input={InputSlot as unknown as typeof CopilotChatInput}
      suggestionView={{ onSelectSuggestion: handleSelectSuggestion }}
      attachments={{
        enabled: true,
        accept: "image/*,application/pdf,text/plain",
        maxSize: 10 * 1024 * 1024,
        onUploadFailed: (err) =>
          console.warn("[attachments]", err.reason, err.message),
      }}
    />
  );
}

/**
 * Demo-resilience patch: listens for "Thread X is locked" RUN_ERROR events
 * from the CopilotKit Intelligence Platform (a stale Redis lock left behind
 * when a previous run crashed mid-flight without releasing) and rotates the
 * local threadId to a fresh UUID. The next chip click goes to a brand-new
 * thread that can't be locked, so the demo recovers without a docker
 * restart. The old lock TTLs out on its own.
 *
 * Mounted inside CopilotChatConfigurationProvider so useAgent() resolves to
 * the same per-thread clone the chat is using.
 */
function ThreadAutoRotate({ onLockDetected }: { onLockDetected: () => void }) {
  const config = useCopilotChatConfiguration();
  const { agent } = useAgent({ agentId: config?.agentId });

  useEffect(() => {
    const sub = agent.subscribe({
      onEvent: ({ event }) => {
        const e = event as Record<string, unknown>;
        if (e.type !== "RUN_ERROR") return;
        const msg = String(e.message ?? "");
        if (/locked/i.test(msg)) {
          console.warn(
            "[ThreadAutoRotate] thread lock detected — rotating to a fresh threadId so the next click recovers",
          );
          onLockDetected();
        }
      },
    });
    return () => sub.unsubscribe();
  }, [agent, onLockDetected]);

  return null;
}

function HomePage() {
  // Pre-mint a threadId on mount so the active conversation always has a
  // known UUID in HomePage state. Without this, CopilotChat would
  // auto-mint internally and the drawer would have no way to identify the
  // current row → it would fall back to a lastRunAt-based heuristic, which
  // also lets pre-existing phantom rows (e.g. older "New thread"s from
  // prior sessions still in the Intelligence platform DB) leak through.
  const [threadId, setThreadId] = useState<string | undefined>(() =>
    crypto.randomUUID(),
  );
  const [agentId, setAgentId] = useState<AgentId>("langgraph");
  // Lifted from ExampleLayout so the "New thread" button can flip the
  // layout back to chat-only when starting a fresh conversation. Initial
  // load defaults to "chat" — the default agent is Cowork (LangGraph), and
  // landing on the kanban board with no chat context yet reads as noise.
  // The user can toggle to app mode via the header or trigger it through
  // chips like "Build the dashboard" (Designer) that call setLayoutMode
  // imperatively.
  const [layoutMode, setLayoutMode] = useState<ExampleLayoutMode>("chat");

  // Local record of (threadId → agentId) pairs the user has actually used
  // this session. Hardcoded ADK chips (Build the dashboard, Sarah's
  // workload, etc.) never call runAgent, so the Intelligence platform
  // never persists a thread row for them — meaning the drawer would never
  // see those conversations in the server-driven thread list. Tracking
  // them locally lets the drawer synthesize a row immediately on chip
  // click (with the rebrand effect then morphing the placeholder into
  // "Build dashboard from backlog"), and survives an agent swap because
  // the entry is keyed by id, not by active-state.
  const [localActiveThreads, setLocalActiveThreads] = useState<
    Map<string, { agentId: AgentId; updatedAt: string }>
  >(() => new Map());

  // Callback wired through ChatWired → suggestion handler. Fires on both
  // hardcoded ADK chips and on regular runAgent flows; for runAgent flows
  // it's redundant once the server upsert lands, but it makes the row
  // appear instantly instead of waiting on the WS push.
  const handleThreadTouched = useCallback(() => {
    if (!threadId) return;
    setLocalActiveThreads((m) => {
      if (m.has(threadId)) return m;
      const next = new Map(m);
      next.set(threadId, {
        agentId,
        updatedAt: new Date().toISOString(),
      });
      return next;
    });
  }, [threadId, agentId]);

  // Called by ThreadAutoRotate when a locked-thread RUN_ERROR comes in.
  // Generating a fresh UUID (vs. setting undefined) guarantees CopilotChat's
  // internal "remember last threadId" caching can't drift us back onto the
  // stuck thread.
  const handleLockDetected = useCallback(() => {
    setThreadId(crypto.randomUUID());
  }, []);

  // True new-conversation action: mint a fresh threadId UUID (passing
  // undefined isn't enough — CopilotChat's internal cache can carry the
  // previous thread forward) AND collapse the right pane so the user
  // lands on a clean chat-only welcome screen.
  const handleNewThread = useCallback(() => {
    setThreadId(crypto.randomUUID());
    setLayoutMode("chat");
  }, []);

  return (
    <ThemeShell>
      <div className={styles.layout}>
        <ThreadsDrawer
          threadId={threadId}
          // Drawer merges threads from both agents into a single list.
          // Picking a thread flips the active agent to whichever one
          // owns that thread on the Intelligence platform — opening a
          // thread under the "wrong" agent would create a duplicate
          // partition entry, since threads are keyed by (userId, agentId).
          onThreadChange={(nextThreadId, nextAgentId) => {
            setThreadId(nextThreadId);
            if (nextAgentId) setAgentId(nextAgentId);
          }}
          onNewThread={handleNewThread}
          localThreadEntries={localActiveThreads}
        />
        <div className={styles.mainPanel}>
          {/*
            Share a single CopilotChatConfigurationProvider across chat + board
            so useAgent() resolves to the same per-thread agent clone. Switching
            agentId here remounts the chat against the new backend.
          */}
          <CopilotChatConfigurationProvider
            key={agentId}
            agentId={agentId}
            threadId={threadId}
            // We pre-mint a fresh UUID on "New thread" / agent-swap to dodge
            // Redis lock errors on the old thread (see comments on
            // handleNewThread and onAgentChange). That UUID flips
            // `hasExplicitThreadId` to true inside CopilotChatView, which
            // suppresses the welcome screen — so a brand-new thread lands
            // on a blank panel with the suggestion chips floating at the
            // top and no "How can I help you today?" greeting above the
            // input. Override the flag to false: messages-empty + no
            // explicit thread = welcome screen renders even on a minted
            // UUID, matching the "first load" experience.
            hasExplicitThreadId={false}
          >
            <ThreadAutoRotate onLockDetected={handleLockDetected} />
            <ExampleLayout
              mode={layoutMode}
              onModeChange={setLayoutMode}
              chatContent={
                <ChatWired
                  agentId={agentId}
                  // AgentSelector rendered below the chat input (via the
                  // input's disclaimer slot) instead of the chat header so
                  // it doesn't collide with the top-right ModeToggle in
                  // chat mode. Same thread-rotation behavior on swap — an
                  // explicit UUID guarantees CopilotChat's internal cache
                  // can't carry the previous agent's threadId forward and
                  // trip Redis lock errors on the new agent. Also collapse
                  // to chat-only so the previous agent's right-pane app
                  // (PmBoard for Cowork, Dashboard for Designer) doesn't
                  // bleed into the fresh session.
                  onAgentChange={(id) => {
                    setAgentId(id);
                    setThreadId(crypto.randomUUID());
                    setLayoutMode("chat");
                  }}
                  // Hardcoded ADK chips call this so the dashboard pane
                  // pops open the moment the chip is clicked, even if the
                  // user was in chat-only mode (e.g. straight off a New
                  // thread). Without this, the assistant reply appears
                  // but the dashboard stays hidden and the chip looks
                  // broken.
                  onOpenApp={() => setLayoutMode("app")}
                  onThreadTouched={handleThreadTouched}
                />
              }
              // Agent picker drives the right pane. langgraph (Cowork) shows
              // the kanban board; adk (Dashboard Designer) swaps to the stats
              // dashboard that the ADK agent drives via updateDashboard.
              appContent={agentId === "adk" ? <Dashboard /> : <PmBoard />}
            />
            <EventInspector />
          </CopilotChatConfigurationProvider>
        </div>
      </div>
    </ThemeShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <CopilotKit
        runtimeUrl={runtimeUrl}
        a2ui={{ catalog: demonstrationCatalog }}
        openGenerativeUI={{}}
        useSingleEndpoint={false}
      >
        <HomePage />
      </CopilotKit>
    </ThemeProvider>
  );
}
