"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Toaster, toast } from "sonner";
import {
  CopilotChatConfigurationProvider,
  CopilotSidebar,
  useAgent,
  useCopilotKit,
  useFrontendTool,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { ThreadsDrawer } from "@/components/threads-drawer";
import { ThemeProvider } from "@/hooks/use-theme";
import drawerStyles from "@/components/threads-drawer/threads-drawer.module.css";

import type {
  AgentState,
  Lead,
  LeadFilter,
  Segment,
  SegmentColor,
  ViewMode,
} from "@/lib/leads/types";
import { initialState, emptyFilter } from "@/lib/leads/state";
import { applyFilter } from "@/lib/leads/derive";
import { applyPatch, revertPatch } from "@/lib/leads/optimistic";

import { Header } from "@/components/leads/Header";
import { MetricsRow } from "@/components/leads/MetricsRow";
import { FilterChips } from "@/components/leads/FilterChips";
import { PipelineBoard } from "@/components/leads/PipelineBoard";
import { LeadList } from "@/components/leads/LeadList";
import { DemandView } from "@/components/leads/DemandView";
import { LeadDetail } from "@/components/leads/LeadDetail";
import { SegmentPanel } from "@/components/leads/SegmentPanel";
import { EmptyState } from "@/components/leads/EmptyState";
import { LeadMiniCard } from "@/components/leads/inline/LeadMiniCard";
import { SegmentChip } from "@/components/leads/inline/SegmentChip";
import { DemandSpark } from "@/components/leads/inline/DemandSpark";
import { EnrichmentStream } from "@/components/leads/enrichment/EnrichmentStream";
import { EnrichmentPill } from "@/components/leads/enrichment/EnrichmentPill";
import { LeadRadar } from "@/components/leads/charts/LeadRadar";
import { TierDonut } from "@/components/leads/charts/TierDonut";
import { ScoreDistribution } from "@/components/leads/charts/ScoreDistribution";
import { RubricProposalCard } from "@/components/leads/hitl/RubricProposalCard";
import { SendQueueModal } from "@/components/leads/hitl/SendQueueModal";
import { EmailDraftCard } from "@/components/leads/inline/EmailDraftCard";

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}

const VIEW_VALUES = ["pipeline", "demand", "list"] as const;
const SEGMENT_COLOR_VALUES = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "slate",
] as const satisfies readonly SegmentColor[];

const leadShape = z.object({
  id: z.string(),
  url: z.string().optional(),
  name: z.string(),
  company: z.string().default(""),
  email: z.string().default(""),
  role: z.string().default(""),
  phone: z.string().optional(),
  source: z.string().optional(),
  technical_level: z.string().default(""),
  interested_in: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  workshop: z.string().default("Not sure yet"),
  status: z.string().default("Not started"),
  opt_in: z.boolean().default(false),
  message: z.string().default(""),
  submitted_at: z.string().default(""),
});

const TIER_VALUES = ["hot", "warm", "nurture", "drop"] as const;
const TONE_VALUES = [
  "casual",
  "technical",
  "founder-to-founder",
  "conference-followup",
] as const;
const TIER_COUNTS_SHAPE = z.object({
  hot: z.number().default(0),
  warm: z.number().default(0),
  nurture: z.number().default(0),
  drop: z.number().default(0),
});

// ---------------------------------------------------------------------------
// useInterrupt — send_gate event helpers
// ---------------------------------------------------------------------------
//
// The interrupt payload the agent emits when it pauses for SendQueueModal:
//   { kind: "send_gate", queue: SendQueueItem[], leadsById: Record<id, Lead> }
//
// `useInterrupt`'s `event` is shaped by the runtime; we discriminate by
// `event.value.kind === "send_gate"` so other interrupt types keep flowing
// through their own slots.

interface SendGateValue {
  kind: "send_gate";
  queue: import("@/lib/leads/types").SendQueueItem[];
  leadsById: Record<string, Lead>;
}

function isSendGateEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const v = (event as { value?: unknown }).value;
  if (!v || typeof v !== "object") return false;
  const kind = (v as { kind?: unknown }).kind;
  return kind === "send_gate";
}

function StreamingChip({ label }: { label: string }) {
  return (
    <div className="my-1 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground">
      <span className="size-1.5 animate-pulse rounded-full bg-secondary" />
      <span className="font-mono">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live state subscription for inline-in-chat tool renderers
// ---------------------------------------------------------------------------
//
// `useFrontendTool({ render })` v2 registers the render closure inside a
// useEffect whose deps don't include the closure itself (see
// @copilotkit/react-core/v2/hooks/use-frontend-tool.tsx). That means the
// renderer captures the FIRST-MOUNT scope — when `agent.state` is still
// undefined and `state.leads` is `[]` from `initialState`. The chat panel
// keeps replaying that stale closure even after the agent imports leads,
// which is why questions like "what's the most popular workshop?" rendered
// `<DemandSpark leads={[]} />` and showed "No leads loaded yet" despite the
// 50-lead pipeline being visible right next to the chat.
//
// The fix: keep the registered render trivial (`() => <LiveX />`) and have
// the wrapper component subscribe to agent state via `useAgent()` itself.
// `useAgent` issues a `forceUpdate` on `OnStateChanged`, so the wrapper
// re-renders on every state mutation and reads fresh `agent.state` each
// time. No closure capture, no stale leads.
function mergeAgentState(raw: unknown): AgentState {
  const partial =
    raw && typeof raw === "object" ? (raw as Partial<AgentState>) : {};
  return {
    ...initialState,
    ...partial,
    filter: { ...initialState.filter, ...(partial.filter ?? {}) },
    header: { ...initialState.header, ...(partial.header ?? {}) },
    sync: { ...initialState.sync, ...(partial.sync ?? {}) },
    leads: partial.leads ?? initialState.leads,
    segments: partial.segments ?? initialState.segments,
    highlightedLeadIds:
      partial.highlightedLeadIds ?? initialState.highlightedLeadIds,
    enrichment: {
      ...initialState.enrichment,
      ...(partial.enrichment ?? {}),
      perLead:
        partial.enrichment?.perLead ?? initialState.enrichment.perLead,
    },
  };
}

function useLiveAgentState() {
  const { agent } = useAgent();
  const state = mergeAgentState(agent?.state);
  const setState = (updater: (prev: AgentState) => AgentState) => {
    agent?.setState(updater(mergeAgentState(agent?.state)));
  };
  return { agent, state, setState };
}

function LiveDemandSpark() {
  const { state } = useLiveAgentState();
  return <DemandSpark leads={state.leads} />;
}

function LiveEnrichmentStream() {
  const { state, setState } = useLiveAgentState();
  return (
    <div className="my-2 max-w-[400px]">
      <EnrichmentStream
        state={state.enrichment}
        leads={state.leads}
        columns={5}
        onCellClick={(id) =>
          setState((prev) => ({ ...prev, selectedLeadId: id }))
        }
      />
    </div>
  );
}

function LiveEnrichmentPill() {
  const { state } = useLiveAgentState();
  return (
    <div className="my-2">
      <EnrichmentPill state={state.enrichment} total={state.leads.length} />
    </div>
  );
}

/**
 * Mirror of the inner-CanvasInner `injectPrompt`. Recreated at module
 * level so wrapper components rendered inside the chat panel can drive
 * follow-up agent runs (Regenerate / Queue actions on EmailDraftCard)
 * without closing over CanvasInner's render scope.
 */
function useInjectPrompt() {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();
  return (prompt: string) => {
    if (!agent) return;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `msg-${Date.now()}`;
    agent.addMessage({ id, role: "user", content: prompt });
    void copilotkit.runAgent({ agent }).catch((error: unknown) => {
      // Mirror CanvasInner's behavior: surface the error in the console
      // but don't crash the chat tree. Toast surfacing only happens in
      // CanvasInner where the Sonner Toaster is mounted.
      // eslint-disable-next-line no-console
      console.error("injectPrompt: runAgent failed", error);
    });
  };
}

interface LiveLeadRadarArgs {
  leadId?: string;
  leadName?: string;
  tier?: (typeof TIER_VALUES)[number];
  score?: number;
  axes?: {
    copilotKitFit: number;
    langChainFit: number;
    agenticUiInterest: number;
    productionReadiness: number;
    decisionMakerScore: number;
  };
}

function LiveLeadRadar({ args }: { args: LiveLeadRadarArgs }) {
  const { state } = useLiveAgentState();
  if (!args.axes) return <StreamingChip label="Drawing radar…" />;
  return (
    <div className="my-2">
      <LeadRadar
        leadName={
          args.leadName ??
          state.leads.find((l) => l.id === args.leadId)?.name
        }
        tier={args.tier}
        score={args.score}
        axes={args.axes}
      />
    </div>
  );
}

interface LiveEmailDraftArgs {
  leadId?: string;
  leadName?: string;
  leadEmail?: string;
  leadCompany?: string;
  leadRole?: string;
  draft?: {
    subject: string;
    body: string;
    tone: (typeof TONE_VALUES)[number];
    rationale?: string;
  };
}

function LiveEmailDraft({ args }: { args: LiveEmailDraftArgs }) {
  const { state } = useLiveAgentState();
  const injectPrompt = useInjectPrompt();
  if (!args.leadId || !args.draft) {
    return <StreamingChip label="Drafting email…" />;
  }
  // Prefer live state over the args-bag so the card always shows the
  // current company / role even if the agent only echoed leadId.
  const fromState = state.leads.find((l) => l.id === args.leadId);
  const lead = fromState ?? {
    id: args.leadId,
    name: args.leadName ?? "(unknown lead)",
    email: args.leadEmail ?? "",
    company: args.leadCompany ?? "",
    role: args.leadRole ?? "",
  };
  return (
    <EmailDraftCard
      lead={lead}
      draft={args.draft}
      variant="compact"
      onRegenerate={() =>
        injectPrompt(
          `Regenerate the outreach email for ${lead.name} (id ${lead.id}).`,
        )
      }
      onQueue={() =>
        injectPrompt(
          `Queue the email for ${lead.name} (id ${lead.id}) into the send queue.`,
        )
      }
    />
  );
}

function CanvasInner() {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();

  // Inject a chat message + run the agent. Used by the empty-state pills
  // (including "Ping Notion DB") and by inline-in-chat components that
  // need to round-trip a follow-up question to the agent (e.g. SegmentChip's
  // "Edit" button injecting an edit prompt). Also used by drag-drop on the
  // pipeline board to narrate what the user just did.
  const injectPrompt = (prompt: string) => {
    if (!agent) return;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `msg-${Date.now()}`;
    agent.addMessage({ id, role: "user", content: prompt });
    void copilotkit.runAgent({ agent }).catch((error: unknown) => {
      console.error("injectPrompt: runAgent failed", error);
      // Phase 05: when the BFF rewrites a `threads_user_id_fkey` 500 into
      // `{ error, hint, command }`, surface the hint as an actionable toast
      // instead of the generic "Failed to initialize thread" message. The
      // payload may live on the error itself or on a wrapped response — we
      // try both shapes conservatively and fall through to the generic
      // message rather than masking new failure modes.
      let hint: string | undefined;
      if (error && typeof error === "object") {
        const anyErr = error as Record<string, unknown>;
        if (typeof anyErr.hint === "string") {
          hint = anyErr.hint;
        } else if (
          anyErr.response &&
          typeof anyErr.response === "object" &&
          typeof (anyErr.response as Record<string, unknown>).hint === "string"
        ) {
          hint = (anyErr.response as Record<string, unknown>).hint as string;
        } else if (typeof anyErr.message === "string") {
          // Some clients stringify the JSON body into `error.message`. Try
          // to JSON.parse it — bail silently on non-JSON.
          try {
            const parsed = JSON.parse(anyErr.message);
            if (parsed && typeof parsed.hint === "string") hint = parsed.hint;
          } catch {
            /* not JSON */
          }
        }
      }
      if (hint) {
        toast.error(hint, { duration: 8000 });
      }
    });
  };

  // ----- Phase 04: write-back orchestration ---------------------------------
  //
  // `syncingIds` drives the spinner overlay on every view; `justSyncedIds`
  // drives the 800ms ✓-flash. Both are managed at the page level so any
  // active view can read them without each view tracking its own set.
  //
  // `snapshotsRef` keeps the pre-edit copy of every lead currently in flight,
  // keyed by leadId. On a confirmed write, we drop the snapshot. On a failure,
  // we reapply it via revertPatch and show a sonner toast. Two rapid edits to
  // the same card collapse to last-write-wins: the second edit overwrites the
  // first snapshot (we want the second user intent to be the rollback target,
  // not the original), which matches Notion's last-write-wins semantics.
  //
  // The agent communicates outcomes via ToolMessage content. We watch the
  // tail of agent.messages for fresh "Updated …"/"Update failed …"/"Added …"
  // messages from the `update_notion_lead`/`insert_notion_lead` tools and
  // resolve the pending edits accordingly. `processedToolMsgIds` makes the
  // observer idempotent across re-renders.
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [justSyncedIds, setJustSyncedIds] = useState<Set<string>>(new Set());
  const snapshotsRef = useRef<Map<string, Lead>>(new Map());
  const processedToolMsgIds = useRef<Set<string>>(new Set());
  const justSyncedTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const flashJustSynced = useCallback((id: string) => {
    setJustSyncedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const existing = justSyncedTimers.current.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      setJustSyncedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      justSyncedTimers.current.delete(id);
    }, 800);
    justSyncedTimers.current.set(id, t);
  }, []);

  useEffect(() => {
    return () => {
      for (const t of justSyncedTimers.current.values()) clearTimeout(t);
      justSyncedTimers.current.clear();
    };
  }, []);

  const state = mergeAgentState(agent?.state);

  const updateState = (updater: (prev: AgentState) => AgentState) => {
    agent?.setState(updater(mergeAgentState(agent?.state)));
  };

  // ----- Frontend tools (the agent's surface) ---------------------------

  useFrontendTool({
    name: "setHeader",
    description:
      "Set the workspace header (title and subtitle shown above the canvas).",
    parameters: z.object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
    }),
    handler: async ({ title, subtitle }) => {
      updateState((prev) => ({
        ...prev,
        header: {
          title: title ?? prev.header.title,
          subtitle: subtitle ?? prev.header.subtitle,
        },
      }));
      return "header updated";
    },
  });

  useFrontendTool({
    name: "setLeads",
    description:
      "Replace the entire lead list. Call this once after fetching from Notion. Each lead must include id, name, company, email, role, technical_level, tools, workshop, opt_in, message.",
    parameters: z.object({ leads: z.array(leadShape) }),
    handler: async ({ leads }) => {
      const list = leads as Lead[];
      updateState((prev) => ({
        ...prev,
        leads: list,
        // dropping leads that no longer exist in segments and highlights
        segments: prev.segments.map((s) => ({
          ...s,
          leadIds: s.leadIds.filter((id) => list.some((l) => l.id === id)),
        })),
        highlightedLeadIds: prev.highlightedLeadIds.filter((id) =>
          list.some((l) => l.id === id),
        ),
        selectedLeadId:
          prev.selectedLeadId &&
          list.some((l) => l.id === prev.selectedLeadId)
            ? prev.selectedLeadId
            : null,
      }));
      return `loaded ${leads.length} leads`;
    },
  });

  useFrontendTool({
    name: "setSyncMeta",
    description:
      "Record which Notion database is the canvas's source of truth and when we last synced.",
    parameters: z.object({
      databaseId: z.string().optional(),
      databaseTitle: z.string().optional(),
      syncedAt: z.string().optional(),
    }),
    handler: async ({ databaseId, databaseTitle, syncedAt }) => {
      updateState((prev) => ({
        ...prev,
        sync: {
          databaseId: databaseId ?? prev.sync.databaseId,
          databaseTitle: databaseTitle ?? prev.sync.databaseTitle,
          syncedAt: syncedAt ?? new Date().toISOString(),
        },
      }));
      return "sync meta updated";
    },
  });

  useFrontendTool({
    name: "setView",
    description:
      "Switch the primary view. 'pipeline' = kanban grouped by Status (Not started / In progress / Done), 'demand' = workshop/tools/tech charts, 'list' = dense table.",
    parameters: z.object({ view: z.enum(VIEW_VALUES) }),
    handler: async ({ view }) => {
      updateState((prev) => ({ ...prev, view: view as ViewMode }));
      return `view set to ${view}`;
    },
  });

  useFrontendTool({
    name: "setFilter",
    description:
      "Narrow the visible leads. Pass any subset of fields; omitted fields are kept. Pass empty arrays / 'any' to clear a single facet.",
    parameters: z.object({
      workshops: z.array(z.string()).optional(),
      technical_levels: z.array(z.string()).optional(),
      tools: z.array(z.string()).optional(),
      opt_in: z.enum(["any", "yes", "no"]).optional(),
      search: z.string().optional(),
    }),
    handler: async (patch) => {
      updateState((prev) => ({
        ...prev,
        filter: { ...prev.filter, ...(patch as Partial<LeadFilter>) },
      }));
      return "filter updated";
    },
  });

  useFrontendTool({
    name: "clearFilters",
    description: "Reset all filters to show every loaded lead.",
    parameters: z.object({}),
    handler: async () => {
      updateState((prev) => ({ ...prev, filter: emptyFilter }));
      return "filters cleared";
    },
  });

  useFrontendTool({
    name: "highlightLeads",
    description:
      "Visually highlight specific leads (e.g. to draw the user's attention to a query result). Pass an empty array to clear highlights.",
    parameters: z.object({ leadIds: z.array(z.string()) }),
    handler: async ({ leadIds }) => {
      updateState((prev) => ({ ...prev, highlightedLeadIds: leadIds }));
      return `highlighted ${leadIds.length} leads`;
    },
  });

  useFrontendTool({
    name: "selectLead",
    description:
      "Open the detail panel for one lead. Pass null to close it.",
    parameters: z.object({ leadId: z.string().nullable() }),
    handler: async ({ leadId }) => {
      updateState((prev) => ({ ...prev, selectedLeadId: leadId }));
      return leadId ? `selected ${leadId}` : "selection cleared";
    },
  });

  useFrontendTool({
    name: "addSegment",
    description:
      "Define a named group of leads for outreach (e.g. 'CopilotKit-curious developers'). Color is optional.",
    parameters: z.object({
      id: z.string().optional(),
      name: z.string(),
      description: z.string().optional(),
      color: z.enum(SEGMENT_COLOR_VALUES).optional(),
      leadIds: z.array(z.string()),
    }),
    handler: async ({ id, name, description, color, leadIds }) => {
      const segment: Segment = {
        id: id ?? `seg-${Date.now()}`,
        name,
        description,
        color,
        leadIds,
      };
      updateState((prev) => {
        const without = prev.segments.filter((s) => s.id !== segment.id);
        return { ...prev, segments: [...without, segment] };
      });
      return `segment ${segment.id} (${leadIds.length} leads)`;
    },
  });

  useFrontendTool({
    name: "removeSegment",
    description: "Remove a segment by id.",
    parameters: z.object({ id: z.string() }),
    handler: async ({ id }) => {
      updateState((prev) => ({
        ...prev,
        segments: prev.segments.filter((s) => s.id !== id),
      }));
      return `removed ${id}`;
    },
  });

  useFrontendTool({
    name: "clearSegments",
    description: "Remove all segments.",
    parameters: z.object({}),
    handler: async () => {
      updateState((prev) => ({ ...prev, segments: [] }));
      return "segments cleared";
    },
  });

  // ----- Phase 04 write tools (commitLeadEdit, addLead) -------------------
  //
  // Both follow the same dance: snapshot → optimistic patch → injectPrompt
  // (which causes the agent to call `update_notion_lead` / `insert_notion_lead`)
  // → wait for the corresponding ToolMessage to land → confirm or revert.
  //
  // The handler returns a short status string that goes to whoever invoked
  // the tool — useful for the agent if it called this directly, and harmless
  // for the React-side callers (they don't await the return value).

  const commitLeadEdit = useCallback(
    (leadId: string, patch: Partial<Lead>) => {
      // Snapshot from the agent state directly so we always have the
      // server-truth pre-edit shape, not a stale closure copy.
      const snap = mergeAgentState(agent?.state).leads.find((l) => l.id === leadId);
      if (!snap) {
        console.warn(`commitLeadEdit: no lead with id=${leadId}`);
        return;
      }
      // last-write-wins on rapid double-edits: replace any existing snapshot
      // for this lead so the rollback target is the user's most recent
      // pre-edit shape, not the original.
      snapshotsRef.current.set(leadId, snap);

      setSyncingIds((prev) => {
        if (prev.has(leadId)) return prev;
        const next = new Set(prev);
        next.add(leadId);
        return next;
      });

      // Optimistic patch — the canvas updates immediately; the agent's
      // STATE_SNAPSHOT will overwrite this with the truth on success.
      updateState((prev) => applyPatch(prev, leadId, patch));

      // Ask the agent to do the round-trip. We embed the JSON inline so
      // the agent has a single, unambiguous instruction to translate.
      injectPrompt(
        `Update lead ${leadId} in Notion: ${JSON.stringify(patch)}`,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent, updateState, injectPrompt],
  );

  const addLeadHandler = useCallback(
    (lead: Lead) => {
      // Optimistic insert — the lead has no real Notion id yet, so use a
      // local placeholder and let the agent's STATE_SNAPSHOT replace the
      // whole list with the truth (which has the real Notion id).
      const tempId = `pending-${Date.now()}`;
      const optimistic: Lead = { ...lead, id: tempId };
      updateState((prev) => ({
        ...prev,
        leads: [...prev.leads, optimistic],
      }));
      // No snapshot to rollback to — on failure we just drop the temp lead.
      snapshotsRef.current.set(tempId, optimistic);
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.add(tempId);
        return next;
      });
      injectPrompt(
        `Insert this lead into Notion: ${JSON.stringify(lead)}`,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateState, injectPrompt],
  );

  useFrontendTool({
    name: "commitLeadEdit",
    description:
      "Commit an edit to a single lead with optimistic UI: snapshots the lead, applies the patch on the canvas, and asks the agent to persist the change to Notion via update_notion_lead. The patch is a partial Lead — only include fields that change (workshop / technical_level / opt_in / etc.). Returns 'queued: editing <name>' immediately; the round-trip resolves through the agent reply.",
    parameters: z.object({
      leadId: z.string(),
      patch: z
        .object({
          name: z.string().optional(),
          company: z.string().optional(),
          email: z.string().optional(),
          role: z.string().optional(),
          phone: z.string().optional(),
          source: z.string().optional(),
          technical_level: z.string().optional(),
          interested_in: z.array(z.string()).optional(),
          tools: z.array(z.string()).optional(),
          workshop: z.string().optional(),
          status: z.string().optional(),
          opt_in: z.boolean().optional(),
          message: z.string().optional(),
        })
        .passthrough(),
    }),
    handler: async ({ leadId, patch }) => {
      const lead = mergeAgentState(agent?.state).leads.find((l) => l.id === leadId);
      commitLeadEdit(leadId, patch as Partial<Lead>);
      const fields = Object.keys(patch ?? {}).join(",") || "<no fields>";
      return `queued: editing ${lead?.name ?? leadId} (${fields})`;
    },
  });

  useFrontendTool({
    name: "addLead",
    description:
      "Add a new lead with optimistic UI: appends the lead to the canvas immediately and asks the agent to persist it to Notion via insert_notion_lead. id and url are ignored — Notion assigns them. Required fields: name, company, email, role, technical_level, tools, workshop, opt_in, message.",
    parameters: z.object({
      lead: leadShape,
    }),
    handler: async ({ lead }) => {
      addLeadHandler(lead as Lead);
      return `queued: adding ${lead.name}`;
    },
  });

  // ----- Observe agent ToolMessages for write outcomes --------------------
  //
  // The backend tools `update_notion_lead` and `insert_notion_lead` reply
  // with a ToolMessage whose content starts with "Updated " / "Added " on
  // success or "Update failed" / "Insert failed" on failure. We scan the tail
  // of agent.messages for new tool messages, match them against pending
  // snapshots, and resolve.
  const messageTail =
    (agent?.messages as Array<{ id?: string; role?: string; content?: unknown }>)
      ?.slice(-10) ?? [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!agent || !messageTail.length) return;
    for (const m of messageTail) {
      const id = m.id;
      const role = m.role;
      if (!id || role !== "tool") continue;
      if (processedToolMsgIds.current.has(id)) continue;
      processedToolMsgIds.current.add(id);

      const content =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .map((b) =>
                  typeof b === "string"
                    ? b
                    : (b as { text?: string })?.text ?? "",
                )
                .join("")
            : "";
      if (!content) continue;

      const isFailure =
        content.startsWith("Update failed") ||
        content.startsWith("Insert failed");
      const isSuccess =
        content.startsWith("Updated ") || content.startsWith("Added ");

      if (!isFailure && !isSuccess) continue;

      // Resolve every pending snapshot — we don't have the leadId on the
      // ToolMessage itself, but in practice only one write is in flight at
      // a time per UI gesture, and bulk agent-driven writes flush in order.
      // Worst case we clear the spinner one tool-message early, which is
      // fine: the canvas state is the source of truth.
      const pending = Array.from(snapshotsRef.current.entries());
      if (pending.length === 0) continue;

      if (isSuccess) {
        // Drop snapshots and flash the cards green. Use the latest snapshot
        // (by insertion order) as a heuristic for "this is the one that just
        // resolved" — fine because rapid sequential edits drop the older
        // snapshot anyway.
        const [leadId] = pending[pending.length - 1];
        snapshotsRef.current.delete(leadId);
        setSyncingIds((prev) => {
          if (!prev.has(leadId)) return prev;
          const next = new Set(prev);
          next.delete(leadId);
          return next;
        });
        flashJustSynced(leadId);
      } else if (isFailure) {
        // Revert all pending snapshots and surface a toast. We only show one
        // toast per failure — collapsing multiple in-flight reverts into a
        // single "Couldn't sync N leads" notice keeps the UI from spamming.
        const reverted: Lead[] = [];
        updateState((prev) => {
          let next = prev;
          for (const [, snap] of pending) {
            next = revertPatch(next, snap);
            reverted.push(snap);
          }
          return next;
        });
        snapshotsRef.current.clear();
        setSyncingIds(new Set());
        if (reverted.length === 1) {
          toast.error(
            `Couldn't sync ${reverted[0].name} to Notion — change reverted.`,
            { duration: 5000 },
          );
        } else {
          toast.error(
            `Couldn't sync ${reverted.length} leads to Notion — changes reverted.`,
            { duration: 5000 },
          );
        }
      }
    }
  }, [messageTail.map((m) => m.id).join(","), agent, flashJustSynced]);

  // ----- Generative-UI-in-chat tools (render slots only) ---------------
  //
  // These three tools ship a `render` callback so CopilotKit displays a
  // component inline in the chat stream when the agent invokes them. They
  // intentionally have NO `handler` — the agent calls them purely to mount
  // a generative UI affordance. Side effects (selecting a lead, committing
  // a segment, narrating a chart) happen via the existing handler-bearing
  // tools above; the render slot just exposes buttons that fire those.

  useFrontendTool({
    name: "renderLeadMiniCard",
    description:
      "Render an inline lead-mini-card in the chat. Use this WHEN you mention a specific lead by name — prefer this over a text-only mention so the user can click through to the canvas. Pass leadId (Notion page id) and as much of name/role/company/email/workshop/technical_level as you have; the component degrades gracefully on missing fields.",
    parameters: z.object({
      leadId: z.string(),
      name: z.string().optional(),
      role: z.string().optional(),
      company: z.string().optional(),
      email: z.string().optional(),
      workshop: z.string().optional(),
      technical_level: z.string().optional(),
    }),
    render: ({ args }) => (
      <LeadMiniCard
        leadId={args.leadId}
        name={args.name}
        role={args.role}
        company={args.company}
        email={args.email}
        workshop={args.workshop}
        technical_level={args.technical_level}
        onSelect={(id) =>
          updateState((prev) => ({ ...prev, selectedLeadId: id }))
        }
      />
    ),
  });

  useFrontendTool({
    name: "renderSegmentProposal",
    description:
      "Render a proposed segment chip inline in chat BEFORE committing. Use this any time you're about to create a segment so the user can Accept (commits via addSegment), Edit (asks them to refine it), or Discard. Do NOT call addSegment in the same turn — let the user click Accept first.",
    parameters: z.object({
      name: z.string(),
      description: z.string().optional(),
      color: z.enum(SEGMENT_COLOR_VALUES).optional(),
      leadIds: z.array(z.string()),
    }),
    render: ({ args }) => (
      <SegmentChip
        name={args.name}
        description={args.description}
        color={args.color}
        leadIds={args.leadIds}
        onAccept={({ name, description, color, leadIds }) => {
          const segment: Segment = {
            id: `seg-${Date.now()}`,
            name,
            description,
            color,
            leadIds,
          };
          updateState((prev) => ({
            ...prev,
            segments: [...prev.segments, segment],
          }));
        }}
        onEdit={(currentName) =>
          injectPrompt(
            `I want to refine the proposed segment "${currentName}". Suggest a better name, description, and lead set.`,
          )
        }
      />
    ),
  });

  useFrontendTool({
    name: "renderDemandSpark",
    description:
      "Render an inline 3-bar mini chart of top-3 workshops by current lead count. Use this when answering ranking / 'what's hot' questions in chat — you do NOT need to setView('demand') if a quick inline summary will do. Takes no args.",
    parameters: z.object({}),
    // LiveDemandSpark subscribes to agent state itself — see the comment
    // on `useLiveAgentState` for why a static factory is the only render
    // shape that survives v2 useFrontendTool's register-once semantics.
    render: () => <LiveDemandSpark />,
  });

  // EnrichmentStream — the long-running pillar's chat surface. The sheet
  // reads agent state directly (state.enrichment.perLead), so this tool
  // takes no args; the agent calls it when the user asks about enrichment
  // progress / status. Five columns fits the 420px sidebar.
  useFrontendTool({
    name: "renderEnrichmentStream",
    description:
      "Render the live enrichment grid inline in chat. Use when the user asks about progress, status, or how the run is going. The component reads agent state, so this tool takes no args. Prefer renderEnrichmentPill for a quick one-line answer; reach for this when the user wants to SEE per-lead progress.",
    parameters: z.object({}),
    render: () => <LiveEnrichmentStream />,
  });

  // EnrichmentPill — the compact one-line variant. Single sentence: "X / 52
  // enriched · 12s." Use this for status questions where the user doesn't
  // need to see every cell.
  useFrontendTool({
    name: "renderEnrichmentPill",
    description:
      "Render a compact pill summarizing enrichment progress: '{done} / {total} enriched · {elapsed}'. Use this for one-line status answers in chat where the full grid would be overkill. Takes no args.",
    parameters: z.object({}),
    render: () => <LiveEnrichmentPill />,
  });

  // ----- Charts / visualizations ---------------------------------------
  //
  // Render-only tools the agent invokes when a visualization conveys the
  // answer better than prose. Each takes its data inline (not from agent
  // state) so it can render hypotheticals without mutating anything.

  useFrontendTool({
    name: "renderLeadRadar",
    description:
      "Render a 5-axis radar comparing one lead against the ICP target. " +
      "Use when the user asks why a specific lead is Hot/Drop, or when " +
      "introducing a Hot lead in detail. All axes are 0..1.",
    parameters: z.object({
      leadId: z.string(),
      leadName: z.string().optional(),
      tier: z.enum(TIER_VALUES).optional(),
      score: z.number().optional(),
      axes: z.object({
        copilotKitFit: z.number(),
        langChainFit: z.number(),
        agenticUiInterest: z.number(),
        productionReadiness: z.number(),
        decisionMakerScore: z.number(),
      }),
    }),
    render: ({ args }) => <LiveLeadRadar args={args} />,
  });

  useFrontendTool({
    name: "renderTierDonut",
    description:
      "Render a donut chart of leads split by tier (Hot/Warm/Nurture/Drop). " +
      "Use when the user asks 'how do these break down' or 'how many are Hot.' " +
      "Pass counts explicitly so the agent can show what-if states.",
    parameters: z.object({ counts: TIER_COUNTS_SHAPE }),
    render: ({ args }) => {
      if (!args.counts) return <StreamingChip label="Counting tiers…" />;
      return (
        <div className="my-2">
          <TierDonut counts={args.counts} />
        </div>
      );
    },
  });

  useFrontendTool({
    name: "renderScoreDistribution",
    description:
      "Render a 10-bucket histogram of lead scores, stacked by tier. " +
      "Use when the user asks 'show me the score spread' or after a rubric " +
      "change to convey what shifted.",
    parameters: z.object({
      buckets: z.array(
        z.object({
          start: z.number(),
          end: z.number(),
          byTier: TIER_COUNTS_SHAPE,
        }),
      ),
    }),
    render: ({ args }) => {
      if (!args.buckets) return <StreamingChip label="Bucketing scores…" />;
      return (
        <div className="my-2">
          <ScoreDistribution buckets={args.buckets} />
        </div>
      );
    },
  });

  // ----- Soft HITL: rubric proposal -----------------------------------
  //
  // Mirrors the renderSegmentProposal pattern. The agent proposes a rubric
  // (fresh or update) and the user clicks Apply / Tune / Discard. The
  // agent does NOT block — if the user ignores the chip, no apply happens.
  // Side effects (commit) flow through prompt injection so the next agent
  // turn can react.

  useFrontendTool({
    name: "renderRubricProposal",
    description:
      "Propose a rubric inline in chat. Use BEFORE applying any rubric " +
      "change — never call an apply tool in the same turn. If the user " +
      "ignores the chip, nothing should change. For an UPDATE, include " +
      "previousWeights so the chip shows ▲/▼ deltas next to each weight.",
    parameters: z.object({
      name: z.string(),
      description: z.string().optional(),
      reason: z.string().optional(),
      dimensions: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          weight: z.number(),
          description: z.string().optional(),
        }),
      ),
      previousWeights: z.record(z.string(), z.number()).optional(),
    }),
    render: ({ args }) => {
      if (!args.name || !args.dimensions) {
        return <StreamingChip label="Drafting rubric…" />;
      }
      return (
        <RubricProposalCard
          proposal={{
            name: args.name,
            description: args.description,
            reason: args.reason,
            dimensions: args.dimensions,
            previousWeights: args.previousWeights,
          }}
          onApply={(p) =>
            injectPrompt(
              `The user accepted the proposed rubric "${p.name}". Apply it and re-score the leads.`,
            )
          }
          onTune={(p) =>
            injectPrompt(
              `I want to tune the rubric "${p.name}". Show the RubricEditor or suggest weight refinements.`,
            )
          }
        />
      );
    },
  });

  // ----- Inline render: email draft ------------------------------------

  useFrontendTool({
    name: "renderEmailDraft",
    description:
      "Render a draft outreach email inline in chat. Use AFTER drafting, " +
      "BEFORE queueing — the user opens it to edit. Side effects (queue, " +
      "send) happen via the component's buttons, which call other tools. " +
      "Do NOT call queueEmail in the same turn as this render.",
    parameters: z.object({
      leadId: z.string(),
      leadName: z.string().optional(),
      leadEmail: z.string().optional(),
      leadCompany: z.string().optional(),
      leadRole: z.string().optional(),
      draft: z.object({
        subject: z.string(),
        body: z.string(),
        tone: z.enum(TONE_VALUES),
        rationale: z.string().optional(),
      }),
    }),
    render: ({ args }) => <LiveEmailDraft args={args} />,
  });

  // ----- Hard HITL: send-gate interrupt --------------------------------
  //
  // The agent emits an interrupt with a payload of shape
  //   { kind: "send_gate", queue: SendQueueItem[], leadsById: {...} }
  // from inside its LangGraph node. This hook subscribes; when the event
  // arrives, the SendQueueModal mounts and resolves with the approved
  // subset (or empty array on cancel). The agent's run resumes with that.

  useInterrupt({
    enabled: (event) => isSendGateEvent(event),
    render: ({ event, resolve }) => {
      // `enabled` already filtered for send_gate events; cast safely.
      const value = (event as { value: SendGateValue }).value;
      return (
        <SendQueueModal
          open
          queue={value.queue}
          leadsById={value.leadsById}
          onSend={(approved) => resolve({ approved })}
          onCancel={() => resolve({ approved: [] })}
        />
      );
    },
  });

  // ----- Render ---------------------------------------------------------

  const visibleLeads = useMemo(
    () => applyFilter(state.leads, state.filter),
    [state.leads, state.filter],
  );
  const leadsById = useMemo(() => {
    const m: Record<string, Lead> = {};
    for (const l of state.leads) m[l.id] = l;
    return m;
  }, [state.leads]);
  const selectedLead = state.selectedLeadId
    ? leadsById[state.selectedLeadId] ?? null
    : null;

  const handleSelect = (id: string) =>
    updateState((prev) => ({
      ...prev,
      selectedLeadId: prev.selectedLeadId === id ? null : id,
    }));

  const handleFilterChange = (patch: Partial<LeadFilter>) =>
    updateState((prev) => ({
      ...prev,
      filter: { ...prev.filter, ...patch },
    }));

  // Drag-drop on the pipeline board moves a lead between status columns.
  // The move routes through `commitLeadEdit`, which snapshots the lead,
  // optimistically updates state, asks the agent to persist via
  // `update_notion_lead`, and rolls back with a toast if Notion errors.
  const handleMoveLead = (
    leadId: string,
    _fromStatus: string,
    toStatus: string,
  ) => {
    commitLeadEdit(leadId, { status: toStatus });
  };

  return (
    <>
      <main className="relative flex h-screen flex-col overflow-hidden bg-background px-6 py-5">
        {/* Canvas-scoped backdrop dim. The lead profile modal is non-modal
            (so the user can keep typing in the chat sidebar with it
            open), which means Radix doesn't render its own dimmed
            overlay. We paint our own here, scoped to <main> so the chat
            sidebar (a sibling of main, fixed-positioned at the right
            edge) and the threads drawer (a different grid column
            entirely) stay at full brightness. pointer-events-none keeps
            kanban / list / demand-view clicks working through the dim. */}
        {selectedLead ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 bg-black/40 transition-opacity duration-200"
          />
        ) : null}
        <Header
          title={state.header.title}
          subtitle={state.header.subtitle}
          view={state.view}
          onViewChange={(v) => updateState((prev) => ({ ...prev, view: v }))}
          totalLeads={state.leads.length}
          visibleLeads={visibleLeads.length}
          sync={state.sync}
          onResetLocalData={async () => {
            // Confirm because the action wipes any edits the user has made
            // to the local cache. (Notion mode: the button isn't rendered,
            // so this branch never fires there.)
            if (
              typeof window !== "undefined" &&
              !window.confirm(
                "Reset the bundled local lead data back to the starter set? Any edits you've made will be lost.",
              )
            ) {
              return;
            }
            try {
              const res = await fetch("/api/leads/reset", { method: "DELETE" });
              if (!res.ok && res.status !== 204) {
                const body = (await res.json().catch(() => null)) as
                  | { message?: string }
                  | null;
                toast.error(body?.message ?? `Reset failed (${res.status})`);
                return;
              }
              toast.success("Local data reset to starter set");
              // Trigger a re-import so the canvas refreshes from the
              // freshly-restored seed without the user having to type.
              injectPrompt("Re-import the leads");
            } catch (err) {
              toast.error(
                `Reset failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }}
        />

        {state.leads.length === 0 ? (
          <div className="flex-1 overflow-auto">
            <EmptyState onPromptClick={injectPrompt} />
          </div>
        ) : (
          <>
            <MetricsRow leads={visibleLeads} />
            <FilterChips
              filter={state.filter}
              onChange={handleFilterChange}
              onClear={() =>
                updateState((prev) => ({ ...prev, filter: emptyFilter }))
              }
            />

            <div className="flex-1 overflow-auto">
              {state.view === "pipeline" ? (
                <PipelineBoard
                  leads={visibleLeads}
                  segments={state.segments}
                  selectedLeadId={state.selectedLeadId}
                  highlightedLeadIds={state.highlightedLeadIds}
                  onSelect={handleSelect}
                  onMoveLead={handleMoveLead}
                  syncingIds={syncingIds}
                  justSyncedIds={justSyncedIds}
                />
              ) : state.view === "list" ? (
                <LeadList
                  leads={visibleLeads}
                  segments={state.segments}
                  selectedLeadId={state.selectedLeadId}
                  highlightedLeadIds={state.highlightedLeadIds}
                  onSelect={handleSelect}
                  syncingIds={syncingIds}
                  justSyncedIds={justSyncedIds}
                />
              ) : (
                <DemandView
                  leads={visibleLeads}
                  onPickWorkshop={(w) =>
                    handleFilterChange({
                      workshops: state.filter.workshops.includes(w)
                        ? state.filter.workshops.filter((x) => x !== w)
                        : [...state.filter.workshops, w],
                    })
                  }
                  onPickTool={(t) =>
                    handleFilterChange({
                      tools: state.filter.tools.includes(t)
                        ? state.filter.tools.filter((x) => x !== t)
                        : [...state.filter.tools, t],
                    })
                  }
                  onPickTechLevel={(l) =>
                    handleFilterChange({
                      technical_levels: state.filter.technical_levels.includes(
                        l,
                      )
                        ? state.filter.technical_levels.filter((x) => x !== l)
                        : [...state.filter.technical_levels, l],
                    })
                  }
                />
              )}
            </div>

            {state.segments.length > 0 ? (
              <section className="mt-3 max-h-[180px] overflow-y-auto border-t border-border pt-3">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Segments
                </h3>
                <SegmentPanel
                  segments={state.segments}
                  leadsById={leadsById}
                  onSelectLead={handleSelect}
                  onRemove={(id) =>
                    updateState((prev) => ({
                      ...prev,
                      segments: prev.segments.filter((s) => s.id !== id),
                    }))
                  }
                />
              </section>
            ) : null}
          </>
        )}
      </main>

      <LeadDetail
        lead={selectedLead}
        segments={state.segments}
        onClose={() =>
          updateState((prev) => ({ ...prev, selectedLeadId: null }))
        }
        onEdit={commitLeadEdit}
        syncing={selectedLead ? syncingIds.has(selectedLead.id) : false}
      />

      <CopilotSidebar
        defaultOpen
        width={420}
        input={{ disclaimer: () => null, className: "pb-6" }}
      />

      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            error: "!bg-rose-50 !text-rose-900 !border !border-rose-200",
          },
        }}
      />
    </>
  );
}

function HomePage() {
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  return (
    <div className={drawerStyles.layout}>
      <ThreadsDrawer
        agentId="default"
        threadId={threadId}
        onThreadChange={setThreadId}
      />
      <div className={drawerStyles.mainPanel}>
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <CanvasInner />
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <ThemeProvider>
      <ClientOnly>
        <HomePage />
      </ClientOnly>
    </ThemeProvider>
  );
}
