"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  useAgentContext,
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Radio,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { useRecording } from "@/shell/teach";
import { useMyelinLedger } from "./data/ledger-context";
import {
  LEARNER_SORTS,
  SORT_LABEL,
  STATUS_LABEL,
  audienceSize,
  calendarDays,
  groupNames,
  totalMinutes,
} from "./data/derive";
import type { LearnerSort } from "./data/derive";
import type {
  AudienceConflict,
  LearnerStatus,
  MyelinState,
} from "./data/types";
import { JourneyGraph } from "./components/journey-graph";
import { Pill, useNow } from "./components/primitives";
import {
  SAVE_PROCEDURE_CONFIRMED,
  SAVE_PROCEDURE_DECLINED,
  buildDemonstrationDirective,
  classifySaveProcedureResult,
  readDemonstratedStepCount,
} from "./teach-mode-directives";

/**
 * Every frontend tool, HITL card and gen-UI component Myelin ships. Renders
 * null. The ADK agent reaches all of these through `AGUIToolset()` — they are
 * forwarded from this browser on every run.
 *
 * The rules carried over from the other skins, each of which fails silently:
 *  1. Every registration closes with a deps array; write tools use `[]` + refs.
 *  2. A `useComponent` render receives its args DIRECTLY; HITL renders get
 *     `{ args, respond, result }`.
 *  3. Renders are replay-safe: keyed off `result`, never `status`.
 *  4. Nothing sensitive in a result — learner names never leave the card.
 *  5. Every button settles through `settleInterrupt` (respond may be undefined
 *     while args stream).
 */

type RespondFn = (result: unknown) => Promise<void> | void;

async function settleInterrupt(
  respond: RespondFn | undefined,
  message: string,
): Promise<string | null> {
  if (!respond)
    return "The assistant wasn't ready to receive that yet — try again.";
  try {
    await respond(message);
    return null;
  } catch (error) {
    return `Couldn't hand that back to the assistant: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function arrived(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length ? t : null;
}

function ToolCard({
  tone = "brand",
  children,
}: {
  tone?: "brand" | "positive" | "negative";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "my-1 rounded-lg border bg-surface p-3 text-ink shadow-soft",
        tone === "brand" && "border-brand/25",
        tone === "positive" && "border-positive/30",
        tone === "negative" && "border-negative/30",
      )}
    >
      {children}
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return (
    <ToolCard>
      <p className="text-[0.78rem] text-ink-muted">{children}</p>
    </ToolCard>
  );
}

function findJourney(state: MyelinState, needle: string | null) {
  if (!needle) return undefined;
  const n = needle.toLowerCase();
  return (
    state.journeys.find((j) => j.id === needle) ??
    state.journeys.find((j) => j.name.toLowerCase() === n) ??
    state.journeys.find((j) => j.name.toLowerCase().includes(n))
  );
}

const answeredReviews = new Map<string, string>();
const answeredLevers = new Map<string, string>();

export function MyelinTools() {
  const { data, admin } = useMyelinLedger();
  const router = useRouter();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const now = useNow(1000);

  const ledgerRef = useRef<MyelinState>(data);
  useEffect(() => {
    ledgerRef.current = data;
  }, [data]);
  const navRef = useRef({ router, skinHref });
  useEffect(() => {
    navRef.current = { router, skinHref };
  }, [router, skinHref]);

  // ── Global readable: what EXISTS (ids for name resolution) ───────────────
  useAgentContext({
    description:
      "Every journey and group in this Myelin workspace (Harvest Lane Grocers), with ids, so names can be " +
      "resolved without asking. Learner names are never included.",
    value: JSON.stringify({
      tenant: "Harvest Lane Grocers",
      signedInAdmin: admin.name,
      journeys: data.journeys.map((j) => ({
        id: j.id,
        name: j.name,
        status: j.status,
        steps: j.items.length,
        audience: groupNames(data.groups, j.audienceGroupIds),
      })),
      groups: data.groups.map((g) => ({
        id: g.id,
        name: g.name,
        learners: g.learnerCount,
      })),
    }),
  });

  // ── Navigation: follow the build ─────────────────────────────────────────
  useFrontendTool(
    {
      name: "openJourney",
      description:
        "Open a journey in the builder so the admin can watch it change. Call it right after creating a journey, " +
        "and before editing one that is not already on screen.",
      parameters: z.object({
        journeyId: z.string().describe("The journey id, e.g. j-seafood."),
      }),
      handler: async ({ journeyId }) => {
        const j = findJourney(ledgerRef.current, journeyId);
        // A just-created journey may not be in this window's ledger yet — the
        // poll is a second behind the agent's write. Navigate by id anyway.
        const id = j?.id ?? journeyId;
        navRef.current.router.push(navRef.current.skinHref(`journey/${id}`));
        return `Opened ${j?.name ?? id} in the builder.`;
      },
    },
    [],
  );

  // ══ BEAT 1 + 2 + 4 — the journey card ═══════════════════════════════════
  useComponent(
    {
      name: "showJourney",
      description:
        "Render a journey as a card in the chat: its map of steps and prerequisites plus seat time, calendar " +
        "length and audience. Use it after building or editing a journey, or whenever the admin asks about one. " +
        "Put any remembered convention you applied into `note`, in your own words. Render the card AND answer " +
        "in one or two sentences.",
      parameters: z.object({
        journeyId: z.string().describe("The journey id."),
        note: z
          .string()
          .optional()
          .describe(
            "One sentence naming the admin's saved conventions you applied, e.g. 'Kept every lesson under 5 minutes, as you like.'",
          ),
      }),
      render: ({ journeyId, note }) => {
        const id = arrived(journeyId);
        if (!id) return <Muted>Pulling up the journey…</Muted>;
        const j = findJourney(data, id);
        if (!j) return <Muted>Loading {id}…</Muted>;
        const noteText = arrived(note);
        return (
          <ToolCard>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[0.85rem] font-semibold">
                  {j.name}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.68rem] text-ink-muted">
                  <span className="my-num">{j.items.length} steps</span>·
                  <span className="my-num">{totalMinutes(j)} min</span>·
                  <span className="my-num">{calendarDays(j)} days</span>·
                  <span className="my-num">
                    {audienceSize(data.groups, j)} learners
                  </span>
                </div>
              </div>
              <Pill tone={j.status === "published" ? "positive" : "accent"}>
                {j.status === "published" ? "Published" : "Draft"}
              </Pill>
            </div>
            {noteText ? (
              <div className="mt-2 flex items-start gap-1.5 rounded-md bg-brand-violet/10 px-2.5 py-1.5 text-[0.72rem] text-ink">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-brand-violet" />
                {noteText}
              </div>
            ) : null}
            <div className="mt-2.5">
              <JourneyGraph
                items={j.items}
                admins={data.admins}
                compact
                now={now}
              />
            </div>
          </ToolCard>
        );
      },
    },
    [data, now],
  );

  // ══ GOVERNANCE — review the impact before anything goes live ═════════════
  useHumanInTheLoop(
    {
      name: "reviewPublish",
      description:
        "Open the governance card for publishing a journey: it shows the admin exactly who would be affected " +
        "(audience size, any learners already inside another active journey) and asks them to approve. " +
        "ALWAYS call this before publish_journey. Returns a string starting APPROVED or DECLINED.",
      parameters: z.object({
        journeyId: z.string().describe("The journey id to publish."),
      }),
      render: ({ args, respond, result, toolCallId }) => {
        const settled =
          (toolCallId && answeredReviews.get(toolCallId)) ||
          (typeof result === "string" ? result : null);
        if (settled) {
          const ok = settled.startsWith("APPROVED");
          return (
            <ToolCard tone={ok ? "positive" : "negative"}>
              <p className="flex items-start gap-1.5 text-[0.78rem]">
                {ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-positive" />
                ) : (
                  <CircleAlert className="mt-0.5 h-4 w-4 text-negative" />
                )}
                {ok
                  ? "Approved for publishing."
                  : "Held — nothing was published."}
              </p>
            </ToolCard>
          );
        }
        const id = arrived(args?.journeyId);
        if (!id) return <Muted>Preparing the audience check…</Muted>;
        return (
          <ReviewPublishCard
            journeyId={id}
            onDecide={async (approved, summary) => {
              const text = approved
                ? `APPROVED by ${admin.name}. ${summary} Now call publish_journey.`
                : `DECLINED by ${admin.name}. Do not publish.`;
              const failure = await settleInterrupt(respond, text);
              if (!failure && toolCallId) answeredReviews.set(toolCallId, text);
              return failure;
            }}
          />
        );
      },
    },
    [admin.name],
  );

  // ══ BEAT 3c — levers: navigate to a real view ═══════════════════════════
  useHumanInTheLoop(
    {
      name: "showLearners",
      description:
        "Take the admin to the Learners page with a specific view applied (journey, status filter, group, sort). " +
        "Shows the levers for confirmation first. Use for questions like 'who is behind on X'.",
      parameters: z.object({
        journeyId: z.string().optional().describe("A PUBLISHED journey id."),
        status: z
          .enum(["overdue", "in-progress", "not-started", "complete", "all"])
          .optional(),
        groupId: z
          .string()
          .optional()
          .describe("A group id, or omit for all groups."),
        sortBy: z.enum(LEARNER_SORTS).optional(),
      }),
      render: ({ args, respond, result, toolCallId }) => {
        const settled =
          (toolCallId && answeredLevers.get(toolCallId)) ||
          (typeof result === "string" ? result : null);
        if (settled) {
          return (
            <ToolCard
              tone={settled.startsWith("Navigated") ? "positive" : "brand"}
            >
              <p className="text-[0.78rem]">
                {settled.startsWith("Navigated")
                  ? "Opened the Learners view."
                  : "Stayed on this page."}
              </p>
            </ToolCard>
          );
        }
        const state = ledgerRef.current;
        const j = findJourney(state, arrived(args?.journeyId));
        const groupId = arrived(args?.groupId);
        const status = args?.status as LearnerStatus | "all" | undefined;
        const sortBy = args?.sortBy as LearnerSort | undefined;
        const chips = [
          j ? `Journey · ${j.name}` : null,
          status && status !== "all"
            ? `Status · ${STATUS_LABEL[status]}`
            : null,
          groupId ? `Group · ${groupNames(state.groups, [groupId])[0]}` : null,
          sortBy ? `Sort · ${SORT_LABEL[sortBy]}` : null,
        ].filter((c): c is string => Boolean(c));
        return (
          <ToolCard>
            <p className="text-[0.8rem] font-medium">
              Open the Learners page with this view?
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.length ? (
                chips.map((c) => (
                  <Pill key={c} tone="brand">
                    {c}
                  </Pill>
                ))
              ) : (
                <span className="text-[0.72rem] text-ink-muted">
                  Setting up the view…
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  const q = new URLSearchParams({ levers: "1" });
                  if (j) q.set("journey", j.id);
                  if (status) q.set("status", status);
                  if (groupId) q.set("group", groupId);
                  if (sortBy) q.set("sort", sortBy);
                  navRef.current.router.push(
                    `${navRef.current.skinHref("learners")}?${q.toString()}`,
                  );
                  const text = `Navigated to Learners with ${chips.join(", ") || "the default view"}.`;
                  const failure = await settleInterrupt(respond, text);
                  if (!failure && toolCallId)
                    answeredLevers.set(toolCallId, text);
                }}
                className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground"
              >
                Take me there
              </button>
              <button
                type="button"
                onClick={async () => {
                  const text = "The admin chose to stay on this page.";
                  const failure = await settleInterrupt(respond, text);
                  if (!failure && toolCallId)
                    answeredLevers.set(toolCallId, text);
                }}
                className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
              >
                Not now
              </button>
            </div>
          </ToolCard>
        );
      },
    },
    [],
  );

  // ══ BEAT 6 — the teach chain: offer → watch → save ══════════════════════
  useHumanInTheLoop(
    {
      followUp: true,
      name: "offerWorkflowRecording",
      description:
        "Call this when a write was refused and you have no saved procedure for it. Say plainly you do not know " +
        "this one and offer to watch the admin do it. Never guess a workaround instead.",
      parameters: z.object({
        situation: z
          .string()
          .describe("What you were blocked on, in one line."),
      }),
      render: ({ args, respond, result }) => {
        if (typeof result === "string") {
          return (
            <ToolCard>
              <p className="text-[0.78rem] text-ink-muted">
                {/agreed to demonstrate/i.test(result)
                  ? "Watching you do it once."
                  : "Left it for now — nothing was recorded."}
              </p>
            </ToolCard>
          );
        }
        const situation = arrived(args?.situation);
        return (
          <ToolCard>
            <p className="text-[0.8rem]">
              I don&rsquo;t have a saved way to handle this yet
              {situation ? ` — ${situation.replace(/\.+$/, "")}` : ""}. Want to
              show me once, and I&rsquo;ll remember it?
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  void settleInterrupt(
                    respond,
                    "The user agreed to demonstrate. Call awaitDemonstration now and wait — do not guess any steps.",
                  )
                }
                className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground"
              >
                Show me
              </button>
              <button
                type="button"
                onClick={() =>
                  void settleInterrupt(
                    respond,
                    "The user declined to demonstrate. Stop here.",
                  )
                }
                className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
              >
                Not now
              </button>
            </div>
          </ToolCard>
        );
      },
    },
    [],
  );

  useHumanInTheLoop(
    {
      followUp: true,
      name: "awaitDemonstration",
      description:
        "Hold the conversation while the admin demonstrates in the app. Do NOT list steps or suggest what to do — " +
        "you do not know yet. That is the point.",
      parameters: z.object({}),
      render: ({ respond, result }) => {
        if (typeof result === "string") {
          const count = readDemonstratedStepCount(result);
          return (
            <ToolCard tone="positive">
              <p className="text-[0.78rem]">
                Recorded{" "}
                {count === null
                  ? "the demonstration"
                  : `${count} ${count === 1 ? "step" : "steps"}`}
                .
              </p>
            </ToolCard>
          );
        }
        return (
          <DemonstrationCard
            onDone={(summary) => settleInterrupt(respond, summary)}
          />
        );
      },
    },
    [],
  );

  useHumanInTheLoop(
    {
      followUp: true,
      name: "saveLearnedProcedure",
      description:
        "Show the procedure you just watched, as numbered steps naming the exact audience rule that worked, for " +
        "confirmation. After the admin confirms, persist it with save_memory (scope 'user', kind 'operational'). " +
        "Save it AT MOST ONCE.",
      parameters: z.object({
        procedure: z
          .string()
          .describe("The numbered procedure, naming the exact rule applied."),
      }),
      render: ({ args, respond, result }) => {
        const outcome = classifySaveProcedureResult(result);
        if (outcome === "saved") {
          return (
            <ToolCard tone="positive">
              <p className="flex items-center gap-1.5 text-[0.78rem]">
                <CheckCircle2 className="h-4 w-4 text-positive" /> Saved.
                I&rsquo;ll handle this myself next time.
              </p>
            </ToolCard>
          );
        }
        if (outcome === "declined")
          return (
            <Muted>Left it unsaved — nothing was written to memory.</Muted>
          );
        if (outcome === "unknown")
          return <Muted>This card was already answered.</Muted>;
        return (
          <ToolCard>
            <p className="text-[0.78rem] font-medium">
              Here&rsquo;s what I picked up — shall I remember it?
            </p>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface-muted p-2.5 text-[0.73rem] leading-relaxed text-ink">
              {args?.procedure}
            </pre>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  void settleInterrupt(respond, SAVE_PROCEDURE_CONFIRMED)
                }
                className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground"
              >
                Remember it
              </button>
              <button
                type="button"
                onClick={() =>
                  void settleInterrupt(respond, SAVE_PROCEDURE_DECLINED)
                }
                className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
              >
                Don&rsquo;t save
              </button>
            </div>
          </ToolCard>
        );
      },
    },
    [],
  );

  return null;
}

// ── The governance card ────────────────────────────────────────────────────

interface Check {
  audienceSize: number;
  totalMinutes: number;
  conflicts: AudienceConflict[];
  unresolved: number;
}

function ReviewPublishCard({
  journeyId,
  onDecide,
}: {
  journeyId: string;
  onDecide: (approved: boolean, summary: string) => Promise<string | null>;
}) {
  const { data } = useMyelinLedger();
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const journey = findJourney(data, journeyId);
  const id = journey?.id ?? journeyId;

  useEffect(() => {
    let live = true;
    fetch(`/api/myelin/v1/journeys/${id}/audience-check`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!live) return;
        if (r.ok) setCheck(body as Check);
        else setError(String(body.message ?? "The audience check failed."));
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [id, data.version]);

  if (error) return <Muted>{error}</Muted>;
  if (!journey || !check) return <Muted>Running the audience check…</Muted>;

  // Names are resolved HERE, in the browser, from the ledger. The agent's
  // result below carries counts only.
  const idsInConflict = new Set(check.conflicts.flatMap((c) => c.learnerIds));
  const names = data.learners
    .filter((l) => idsInConflict.has(l.id))
    .map((l) => l.name);
  const byGroup = journey.audienceGroupIds
    .map((gid) => data.groups.find((g) => g.id === gid))
    .filter(Boolean);

  const decide = async (approved: boolean) => {
    setBusy(true);
    const summary =
      `Audience: ${check.audienceSize} learners in ${byGroup.length} groups. ` +
      (check.conflicts.length
        ? check.conflicts
            .map(
              (c) =>
                `${c.learnerIds.length} are mid-way through ${c.otherJourneyName} (two onboarding journeys at once, against policy)`,
            )
            .join("; ") + "."
        : "No overlaps.");
    const failure = await onDecide(approved, summary);
    if (failure) setError(failure);
    setBusy(false);
  };

  return (
    <ToolCard tone={check.unresolved ? "negative" : "brand"}>
      <div className="flex items-center gap-1.5 text-[0.8rem] font-semibold">
        <ShieldCheck className="h-4 w-4 text-brand" /> Publish “{journey.name}”?
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="rounded-md bg-surface-muted p-2">
          <div className="text-[0.62rem] uppercase tracking-wide text-ink-muted">
            Learners
          </div>
          <div className="my-num text-[0.95rem] font-semibold">
            {check.audienceSize}
          </div>
        </div>
        <div className="rounded-md bg-surface-muted p-2">
          <div className="text-[0.62rem] uppercase tracking-wide text-ink-muted">
            Groups
          </div>
          <div className="my-num text-[0.95rem] font-semibold">
            {byGroup.length}
          </div>
        </div>
        <div
          className={cn(
            "rounded-md p-2",
            check.conflicts.length ? "bg-negative-soft" : "bg-positive-soft",
          )}
        >
          <div className="text-[0.62rem] uppercase tracking-wide text-ink-muted">
            Overlaps
          </div>
          <div
            className={cn(
              "my-num text-[0.95rem] font-semibold",
              check.conflicts.length ? "text-negative" : "text-positive",
            )}
          >
            {idsInConflict.size}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {byGroup.map((g) => (
          <Pill key={g!.id} tone="brand">
            <Users className="h-3 w-3" /> {g!.name} · {g!.learnerCount}
          </Pill>
        ))}
      </div>
      {check.conflicts.map((c) => (
        <div
          key={c.otherJourneyId}
          className="mt-2 flex items-start gap-1.5 text-[0.74rem]"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-negative" />
          <span>
            <strong className="my-num">{c.learnerIds.length}</strong> learners
            are mid-way through <strong>{c.otherJourneyName}</strong> — two
            onboarding journeys at once breaks policy.
          </span>
        </div>
      ))}
      {names.length ? (
        <details className="mt-1.5 text-[0.7rem] text-ink-muted">
          <summary className="cursor-pointer">
            See who ({names.length}) — shown only to you
          </summary>
          <p className="mt-1 leading-relaxed">{names.join(", ")}</p>
        </details>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(true)}
          className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground disabled:opacity-40"
        >
          Approve &amp; publish
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(false)}
          className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
        >
          Hold
        </button>
      </div>
    </ToolCard>
  );
}

// ── Teach mode: the recorder card ───────────────────────────────────────────

function DemonstrationCard({
  onDone,
}: {
  onDone: (summary: string) => Promise<string | null>;
}) {
  const { beginRecording, endRecording, steps, getDemonstratedCode } =
    useRecording();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    beginRecording();
    return () => endRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ToolCard>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-negative-soft px-2 py-0.5 text-[0.68rem] font-semibold text-negative">
          <Radio className="h-3 w-3 animate-pulse" /> Rec
        </span>
        <p className="text-[0.8rem]">
          Watching — go ahead and show me in the app.
        </p>
      </div>
      {steps.length > 0 ? (
        <ol className="mt-2.5 space-y-1 border-l-2 border-brand/30 pl-3">
          {steps.map((step, index) => (
            <li key={step.id} className="text-[0.74rem] text-ink">
              <span className="my-num mr-1.5 text-ink-muted">{index + 1}.</span>
              {step.label}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-[0.72rem] text-ink-muted">
          Nothing captured yet.
        </p>
      )}
      <button
        type="button"
        disabled={sending}
        onClick={async () => {
          setFailure(null);
          setSending(true);
          try {
            setFailure(
              await onDone(
                buildDemonstrationDirective({
                  steps: steps.map((s) => s.label),
                  rule: getDemonstratedCode(),
                }),
              ),
            );
          } finally {
            setSending(false);
          }
        }}
        className="mt-3 rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground disabled:opacity-40"
      >
        {sending ? "Saving…" : "I’m done"}
      </button>
      {failure ? (
        <p
          role="alert"
          className="mt-2 flex items-start gap-1.5 text-[0.72rem] text-negative"
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {failure}
        </p>
      ) : null}
    </ToolCard>
  );
}
