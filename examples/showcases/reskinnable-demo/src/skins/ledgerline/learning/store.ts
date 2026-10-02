/**
 * The demo-local trajectory store. SERVER-ONLY, in memory, pinned on
 * `globalThis` so every route bundle (the recorder's ingest route, the
 * CopilotKit runtime's trace shim, the MCP server and the contract routes)
 * shares one copy.
 *
 * It holds three things:
 *  1. product trajectories: the AG-UI CUSTOM events the in-app recorder posts
 *     (what the human did), grouped into trajectories;
 *  2. agent traces: tool calls and messages of the in-app Threads (captured
 *     server-side from the agent's AG-UI stream) and of ChatGPT's MCP calls;
 *  3. learning output: insights, skills and eval candidates.
 *
 * Grouping rule. Events go to the one OPEN trajectory. Page and navigation
 * events seen while none is open wait in a short lead-in buffer; the first
 * meaningful event (a click, a screen.context, a semantic event or a Thread)
 * opens a trajectory and takes the lead-in with it. A trajectory closes when
 * the user completes the task by hand (`expense.reimbursed`) or an agent Thread
 * succeeds, so the next attempt starts a fresh trajectory.
 */

import { randomBytes } from "node:crypto";
import * as ledger from "../data/store";
import { CARDS } from "../data/recon-seed";
import type {
  CapturedEvent,
  CustomEvent,
  EvalCandidate,
  Insight,
  MissingContext,
  Skill,
  ThreadMessage,
  ThreadRecord,
  TraceEntry,
  TrajectoryDetail,
  TrajectoryOutcome,
  TrajectorySummary,
} from "./types";
import { DEMO_USER, PROJECT_ID } from "./types";
import { buildHistory } from "./history";

export interface TrajectoryRec {
  trajectoryId: string;
  createdAt: number;
  closedAt?: number;
  closedBy?: "user" | "agent";
  seeded?: boolean;
}

export interface ThreadRec extends ThreadRecord {
  trajectoryId: string;
}

interface PendingCall {
  threadId: string;
  trajectoryId: string;
  entryId: string;
  at: number;
}

export interface LearningState {
  trajectories: TrajectoryRec[];
  events: CapturedEvent[];
  threads: ThreadRec[];
  leadIn: CustomEvent[];
  pendingCalls: Map<string, PendingCall>;
  seenMessageIds: Set<string>;
  chatgptSessions: Map<string, { threadId: string; lastAt: number }>;
  insights: Insight[];
  skills: Skill[];
  evalCandidates: EvalCandidate[];
  position: number;
}

const KEY = Symbol.for("ledgerline.learning.v1");
type Pinned = typeof globalThis & { [KEY]?: LearningState };

export const newId = (prefix: string) =>
  `${prefix}_${randomBytes(6).toString("base64url").replace(/[-_]/g, "x").toLowerCase()}`;

function materialize(): LearningState {
  const s: LearningState = {
    trajectories: [],
    events: [],
    threads: [],
    leadIn: [],
    pendingCalls: new Map(),
    seenMessageIds: new Set(),
    chatgptSessions: new Map(),
    insights: [],
    skills: [],
    evalCandidates: [],
    position: 0,
  };
  buildHistory(s, Date.now());
  return s;
}

export function state(): LearningState {
  const g = globalThis as Pinned;
  g[KEY] ??= materialize();
  return g[KEY]!;
}

export function reset(): void {
  (globalThis as Pinned)[KEY] = materialize();
}

// ── Trajectories ────────────────────────────────────────────────────────────

const LEAD_IN_MAX = 4;
/** After an agent success closes a trajectory, its own Thread may still finish. */
const AGENT_CLOSE_GRACE_MS = 120_000;

function openTrajectory(): TrajectoryRec | undefined {
  return state().trajectories.find((t) => !t.closedAt && !t.seeded);
}

function createTrajectory(now: number): TrajectoryRec {
  const s = state();
  const t: TrajectoryRec = { trajectoryId: newId("trj"), createdAt: now };
  s.trajectories.push(t);
  const lead = s.leadIn.splice(0);
  for (const e of lead) persist(t, e, now);
  return t;
}

function ensureTrajectory(now: number): TrajectoryRec {
  return openTrajectory() ?? createTrajectory(now);
}

function persist(
  t: TrajectoryRec,
  event: CustomEvent,
  now: number,
): CapturedEvent {
  const s = state();
  const captured: CapturedEvent = {
    eventId: newId("evt"),
    trajectoryId: t.trajectoryId,
    position: ++s.position,
    persistedAt: now,
    event,
  };
  s.events.push(captured);
  return captured;
}

const OPENING = new Set([
  "click",
  "screen.context",
  "thread.linked",
  "network",
]);

function opensTrajectory(e: CustomEvent): boolean {
  return (
    OPENING.has(e.name) ||
    e.name.startsWith("expense.") ||
    e.name.startsWith("recon.")
  );
}

/** A person finishing the task by hand: a reimbursement, or closing a card's month. */
const isManualCompletion = (name: string) =>
  name === "expense.reimbursed" || name === "recon.period_closed";

export function isCustomEvent(v: unknown): v is CustomEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    e.type === "CUSTOM" &&
    typeof e.name === "string" &&
    e.name.length > 0 &&
    e.name.length < 64 &&
    typeof e.timestamp === "number" &&
    !!e.value &&
    typeof e.value === "object"
  );
}

/** Persist recorder events. Returns the captured rows (with ids). */
export function ingest(
  events: CustomEvent[],
  now = Date.now(),
): CapturedEvent[] {
  const s = state();
  const out: CapturedEvent[] = [];
  for (const e of events) {
    let t = openTrajectory();
    if (!t) {
      if (!opensTrajectory(e)) {
        s.leadIn.push(e);
        if (s.leadIn.length > LEAD_IN_MAX) s.leadIn.shift();
        continue;
      }
      t = createTrajectory(now);
    }
    out.push(persist(t, e, now));
    if (e.name === "thread.linked" && typeof e.value.threadId === "string") {
      threadFor(e.value.threadId, "in_app", now);
    }
    if (isManualCompletion(e.name)) {
      t.closedAt = now;
      t.closedBy = "user";
    }
  }
  return out;
}

// ── Threads and agent traces ───────────────────────────────────────────────

function findTrajectory(id: string): TrajectoryRec | undefined {
  return state().trajectories.find((t) => t.trajectoryId === id);
}

/** The thread record a new trace item belongs to, creating one when needed. */
export function threadFor(
  threadId: string,
  surface: "in_app" | "chatgpt",
  now = Date.now(),
): ThreadRec {
  const s = state();
  const latest = [...s.threads]
    .toReversed()
    .find((r) => r.threadId === threadId);
  if (latest) {
    const t = findTrajectory(latest.trajectoryId);
    const reusable =
      t &&
      (!t.closedAt ||
        (t.closedBy === "agent" && now - t.closedAt < AGENT_CLOSE_GRACE_MS));
    if (reusable) return latest;
  }
  const t = ensureTrajectory(now);
  const rec: ThreadRec = {
    threadId,
    trajectoryId: t.trajectoryId,
    surface,
    linkStrength: surface === "in_app" ? "strong" : "weak",
    messages: [],
    agentTrace: [],
    outcome: "in_progress",
    note:
      surface === "chatgpt"
        ? "ChatGPT keeps the conversation text; the MCP server sees the tool calls only. Linked to this trajectory by time and MCP request context."
        : undefined,
  };
  s.threads.push(rec);
  if (surface === "chatgpt") {
    persist(
      t,
      {
        type: "CUSTOM",
        name: "thread.linked",
        timestamp: now,
        value: { threadId, surface, linkStrength: "weak", source: "mcp" },
      },
      now,
    );
  }
  return rec;
}

export function recordMessage(
  threadId: string,
  surface: "in_app" | "chatgpt",
  msg: ThreadMessage,
): void {
  const s = state();
  if (s.seenMessageIds.has(msg.id) || !msg.text.trim()) return;
  s.seenMessageIds.add(msg.id);
  const rec = threadFor(threadId, surface, msg.at);
  rec.messages.push(msg);
  settleThread(rec, msg.at);
}

export function recordToolCall(
  threadId: string,
  surface: "in_app" | "chatgpt",
  call: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    at: number;
  },
): TraceEntry {
  const s = state();
  const rec = threadFor(threadId, surface, call.at);
  const entry: TraceEntry = {
    id: call.toolCallId,
    kind: "tool.call",
    name: call.name,
    args: call.args,
    status: "pending",
    at: call.at,
  };
  rec.agentTrace.push(entry);
  s.pendingCalls.set(call.toolCallId, {
    threadId,
    trajectoryId: rec.trajectoryId,
    entryId: entry.id,
    at: call.at,
  });
  return entry;
}

export function recordThinking(
  threadId: string,
  text: string,
  at: number,
): void {
  const t = text.trim();
  if (!t) return;
  const rec = threadFor(threadId, "in_app", at);
  rec.agentTrace.push({
    id: newId("th"),
    kind: "thinking",
    text: t.slice(0, 600),
    at,
  });
}

/** A tool result: parsed when JSON, error when it carries an `error`. */
export function parseResult(raw: unknown): {
  result: unknown;
  status: "ok" | "error";
} {
  let result: unknown = raw;
  if (typeof raw === "string") {
    try {
      result = JSON.parse(raw);
    } catch {
      result = raw;
    }
  }
  const isError =
    (result !== null &&
      typeof result === "object" &&
      "error" in (result as object)) ||
    (typeof result === "string" &&
      /^(REFUSED|ERROR|UNAVAILABLE)\b/.test(result));
  return { result, status: isError ? "error" : "ok" };
}

export function recordToolResult(
  toolCallId: string,
  raw: unknown,
  at = Date.now(),
): void {
  const s = state();
  const pending = s.pendingCalls.get(toolCallId);
  if (!pending) return;
  s.pendingCalls.delete(toolCallId);
  const rec = s.threads.find(
    (r) =>
      r.threadId === pending.threadId &&
      r.trajectoryId === pending.trajectoryId,
  );
  const entry = rec?.agentTrace.find((e) => e.id === pending.entryId);
  if (!rec || !entry) return;
  const { result, status } = parseResult(raw);
  entry.result = result;
  entry.status = status;
  entry.durationMs = Math.max(1, at - pending.at);
  settleThread(rec, at);
}

function sawOpenHold(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as { error?: unknown; holds?: { status?: string }[] };
  return (
    r.error === "POLICY_HOLD" ||
    (Array.isArray(r.holds) && r.holds.some((h) => h.status === "open"))
  );
}

/** A validate result that did not pass every pair. */
function validationFailed(result: unknown): boolean {
  const body = (
    result as { body?: { valid?: unknown; total?: unknown } } | undefined
  )?.body;
  return (
    !!body &&
    typeof body.valid === "number" &&
    typeof body.total === "number" &&
    body.valid < body.total
  );
}

/**
 * Month-end close: the cardholder confirming the agent's review card is a
 * success; a run whose integration-API calls failed and that ended without a
 * review card is a failure once the agent has replied (ChatGPT's reply never
 * reaches us, so its failed calls are enough).
 */
function reconOutcome(rec: ThreadRecord): ThreadRecord["outcome"] | null {
  const confirmed = rec.agentTrace.some(
    (e) =>
      e.status === "ok" &&
      (e.result as { closed?: unknown } | undefined)?.closed === true,
  );
  if (confirmed) return "succeeded";
  const api = rec.agentTrace.filter(
    (e) => e.name === "ledgerlineApi" && e.status !== "pending",
  );
  const handedOver = rec.agentTrace.some(
    (e) => e.name === "reviewMatches" && e.status === "ok",
  );
  const refusedReview = rec.agentTrace.some(
    (e) => e.name === "reviewMatches" && e.status === "error",
  );
  if (!api.length || handedOver) return null;
  if (
    !refusedReview &&
    !api.some((e) => e.status === "error" || validationFailed(e.result))
  )
    return null;
  if (rec.surface === "chatgpt") return "failed";
  const last = api[api.length - 1]!;
  const lastAssistant = [...rec.messages]
    .toReversed()
    .find((m) => m.role === "assistant");
  return lastAssistant && lastAssistant.at >= last.at
    ? "failed"
    : "in_progress";
}

export function threadOutcome(rec: ThreadRecord): ThreadRecord["outcome"] {
  const recon = reconOutcome(rec);
  if (recon) return recon;
  const reimbursed = rec.agentTrace.some(
    (e) =>
      e.status === "ok" &&
      (e.result as { status?: unknown } | undefined)?.status === "reimbursed",
  );
  if (reimbursed) return "succeeded";
  const approvals = rec.agentTrace.filter(
    (e) => e.name === "approveReport" && e.status !== "pending",
  );
  const last = approvals[approvals.length - 1];
  if (last?.status === "ok") {
    const asked = rec.messages.some(
      (m) => m.role === "user" && /reimburse/i.test(m.text),
    );
    return asked ? "in_progress" : "succeeded";
  }
  if (last?.status === "error") {
    const lastAssistant = [...rec.messages]
      .toReversed()
      .find((m) => m.role === "assistant");
    return lastAssistant && lastAssistant.at >= last.at
      ? "failed"
      : rec.surface === "chatgpt"
        ? "failed"
        : "in_progress";
  }
  // ChatGPT's answer never reaches the MCP server: a ChatGPT Thread that saw an
  // open hold and never got an approval through is a failed attempt.
  if (
    rec.surface === "chatgpt" &&
    rec.agentTrace.some((e) => sawOpenHold(e.result))
  )
    return "failed";
  return "in_progress";
}

function settleThread(rec: ThreadRec, now: number): void {
  rec.outcome = threadOutcome(rec);
  if (rec.outcome === "succeeded") {
    const t = findTrajectory(rec.trajectoryId);
    if (t && !t.closedAt) {
      t.closedAt = now;
      t.closedBy = "agent";
    }
  }
}

/** ChatGPT has no thread id over MCP: group calls by caller within 15 minutes. */
const CHATGPT_SESSION_MS = 15 * 60_000;

export function chatgptThreadId(callerKey: string, now = Date.now()): string {
  const s = state();
  const prev = s.chatgptSessions.get(callerKey);
  if (prev && now - prev.lastAt < CHATGPT_SESSION_MS) {
    prev.lastAt = now;
    return prev.threadId;
  }
  const threadId = newId("thr_chatgpt");
  s.chatgptSessions.set(callerKey, { threadId, lastAt: now });
  return threadId;
}

// ── Read models (the contract shapes) ──────────────────────────────────────

function eventsOf(trajectoryId: string): CapturedEvent[] {
  return state()
    .events.filter((e) => e.trajectoryId === trajectoryId)
    .sort((a, b) => a.position - b.position);
}

function threadsOf(trajectoryId: string): ThreadRec[] {
  return state().threads.filter((r) => r.trajectoryId === trajectoryId);
}

function reportIdOf(events: CapturedEvent[]): string | undefined {
  for (const e of events) {
    const id =
      e.event.value.reportId ??
      (e.event.value.fields as Record<string, unknown> | undefined)?.reportId;
    if (typeof id === "string") return id;
  }
  return undefined;
}

function cardTitle(events: CapturedEvent[]): string | undefined {
  for (const e of events) {
    const id =
      e.event.value.cardId ??
      (e.event.value.fields as Record<string, unknown> | undefined)?.cardId;
    const card = CARDS.find((c) => c.id === id);
    if (card) return `Close out ${card.holder}'s ${card.periodLabel} card`;
  }
  return undefined;
}

/** The card the agent worked on, from its own calls (a card the screen merely showed comes second). */
function cardFromThreads(threads: ThreadRec[]): string | undefined {
  const seen = JSON.stringify(
    threads.flatMap((t) => t.agentTrace.map((e) => e.args ?? {})),
  );
  const last4 =
    /card_(\d{4})|card=(\d{4})|"cardId":\s*"(?:card_)?(\d{4})"/.exec(seen);
  const digits = last4?.slice(1).find(Boolean);
  const card = CARDS.find((c) => c.last4 === digits);
  return card
    ? `Close out ${card.holder}'s ${card.periodLabel} card`
    : undefined;
}

function titleOf(events: CapturedEvent[], threads: ThreadRec[]): string {
  const card = cardFromThreads(threads) ?? cardTitle(events);
  if (card) return card;
  const reportId = reportIdOf(events) ?? reportIdFromThreads(threads);
  if (reportId) {
    try {
      const r = ledger.getReport(reportId);
      let short = r.title.replace(/^(Q\d)\s+team\s+/i, "$1 ");
      if (/^[A-Z][a-z]/.test(short))
        short = short.charAt(0).toLowerCase() + short.slice(1);
      return `Approve ${r.employeeName}'s ${short} report`;
    } catch {
      // A seeded or unknown id: fall through.
    }
  }
  const first = threads
    .flatMap((t) => t.messages)
    .find((m) => m.role === "user");
  if (first)
    return first.text.length > 72
      ? `${first.text.slice(0, 69)}...`
      : first.text;
  return "Untitled trajectory";
}

function reportIdFromThreads(threads: ThreadRec[]): string | undefined {
  for (const t of threads) {
    for (const e of t.agentTrace) {
      const id = e.args?.reportId;
      if (typeof id === "string") return id.toUpperCase();
    }
  }
  return undefined;
}

export function outcomeOf(
  t: TrajectoryRec,
  events: CapturedEvent[],
  threads: ThreadRec[],
): TrajectoryOutcome {
  const userCompleted = events.some((e) => isManualCompletion(e.event.name));
  const agentFailed = threads.some((r) => r.outcome === "failed");
  const agentSucceeded = threads.some((r) => r.outcome === "succeeded");
  if (userCompleted && agentFailed) return "agent_failed_user_completed";
  if (agentSucceeded) return "agent_succeeded";
  return "in_progress";
}

export function summarize(t: TrajectoryRec): TrajectorySummary {
  const events = eventsOf(t.trajectoryId);
  const threads = threadsOf(t.trajectoryId);
  const times = [
    ...events.map((e) => e.event.timestamp),
    ...threads.flatMap((r) => [
      ...r.messages.map((m) => m.at),
      ...r.agentTrace.map((e) => e.at),
    ]),
  ];
  const surfaces: TrajectorySummary["surfaces"] = [];
  if (threads.some((r) => r.surface === "in_app")) surfaces.push("in_app");
  if (threads.some((r) => r.surface === "chatgpt")) surfaces.push("chatgpt");
  const byHand = (e: CapturedEvent) =>
    e.event.name === "click" ||
    ((e.event.name.startsWith("expense.") ||
      e.event.name.startsWith("recon.")) &&
      e.event.value.by !== "agent");
  if (events.some(byHand)) surfaces.push("manual");
  return {
    trajectoryId: t.trajectoryId,
    projectId: PROJECT_ID,
    title: titleOf(events, threads),
    user: DEMO_USER,
    createdAt: t.createdAt,
    firstEventAt: times.length ? Math.min(...times) : t.createdAt,
    lastEventAt: times.length ? Math.max(...times) : t.createdAt,
    outcome: outcomeOf(t, events, threads),
    surfaces,
    threadIds: [...new Set(threads.map((r) => r.threadId))],
    eventCount: events.length,
  };
}

export function listTrajectories(): TrajectorySummary[] {
  return state()
    .trajectories.map(summarize)
    .sort((a, b) => b.lastEventAt - a.lastEventAt);
}

/** Every screen.context the user saw that no linked agent ever received. */
export function missingContextOf(
  events: CapturedEvent[],
  threads: ThreadRecord[],
): MissingContext[] {
  const agentSaw = JSON.stringify(
    threads.map((t) => [
      t.messages.map((m) => m.text),
      t.agentTrace.map((e) => [e.args, e.result, e.text]),
    ]),
  ).toLowerCase();
  return events
    .filter((e) => e.event.name === "screen.context")
    .filter((e) => {
      const text = String(
        (e.event.value.fields as Record<string, unknown> | undefined)?.text ??
          e.event.value.label ??
          "",
      );
      const probe = text.toLowerCase().slice(0, 40);
      return probe.length > 0 && !agentSaw.includes(probe);
    })
    .map((e) => ({
      eventId: e.eventId,
      label: String(e.event.value.label ?? "Screen context"),
      why: "Shown on screen, never given to the agent",
    }));
}

export function threadView(r: ThreadRec): ThreadRecord {
  const { trajectoryId: _ignored, ...rest } = r;
  void _ignored;
  return rest;
}

export function trajectoryDetail(id: string): TrajectoryDetail | null {
  const t = findTrajectory(id);
  if (!t) return null;
  const events = eventsOf(id);
  const threads = threadsOf(id);
  return {
    trajectory: summarize(t),
    threads: threads.map(threadView),
    events,
    missingContext: missingContextOf(events, threads),
  };
}

/** The trajectory /learn works over: the latest one the agent failed and a person finished. */
export function learnableTrajectory(): TrajectoryDetail | null {
  const all = listTrajectories().filter(
    (t) => !findTrajectory(t.trajectoryId)?.seeded,
  );
  const pick =
    all.find((t) => t.outcome === "agent_failed_user_completed") ??
    all.find((t) => t.eventCount > 0);
  return pick ? trajectoryDetail(pick.trajectoryId) : null;
}

export function publishedSkills(): Skill[] {
  return state().skills.filter((s) => s.status === "published");
}

export function getSkill(name: string): Skill | undefined {
  return state().skills.find((s) => s.name === name);
}
