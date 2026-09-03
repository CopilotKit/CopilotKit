"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useFrontendTool, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { useSkinHref } from "@/shell/skin-path";
import { useRecording } from "@/shell/teach";
import { useExecLedger } from "./data/ledger-context";
import type { DashboardId, MetricDef, MetricId } from "./data/types";
import { execNavTarget } from "./nav-target";
import { execNav } from "./nav";

/**
 * Every frontend tool, HITL card and tool-activity label Vantage (the exec
 * skin) ships. Renders null — mirrors every other skin's `tools.tsx` (see
 * `src/skins/commerce/tools.tsx`'s file header for the shared rules: renders
 * are REPLAY-SAFE (keyed off `result`, never `status`), write tools read
 * mutable state through a ref rather than the closure, and nothing sensitive
 * goes into a tool result).
 *
 * This file is built up across several micro-tasks. It now registers beat 3c
 * (the explorer-lever navigation), beat 3a (`confirmPublishCountersign`, the
 * countersign-PIN card gating `publish_board_pack` — keel's
 * `countersignRelease` and banking's card-PIN HITL, both in their own
 * `tools.tsx`, are the references), and beat 6 (the teach chain —
 * `offerWorkflowRecording` → `awaitDemonstration` → `saveLearnedProcedure`,
 * copied from airline's `tools.tsx` lines 1166–1360 and reworded for
 * Vantage's domain: a board-pack publish refused for unexplained variance,
 * watched and learned as a narrative code filed on the Board Packs form).
 */

/**
 * Human labels for the BACKEND tool-activity chips, keyed to the backend tool
 * names: the five `agent.ts` registers (`get_metrics`, `list_exceptions`,
 * `render_metric_block`, `file_variance_narrative`, `publish_board_pack`)
 * plus the platform's `recall_memory` / `save_memory`, which arrive over the
 * Intelligence MCP path (`src/app/api/copilotkit/[[...slug]]/route.ts`) and
 * match through the shell's `includes` lookup despite their
 * `mcp__intelligence__` prefix — so the transcript reads as phrases rather
 * than function names. Mirrors
 * every other skin's `TOOL_LABELS` (e.g. `src/skins/commerce/skin.tsx`), but
 * lives here rather than in `skin.tsx` because this file is where the rest of
 * the beat map is assembled; `skin.tsx` passes this straight through as
 * `toolLabels`.
 */
export const execToolLabels: Record<string, string> = {
  get_metrics: "Reading metrics",
  render_metric_block: "Composing a block",
  file_variance_narrative: "Filing a narrative",
  publish_board_pack: "Publishing the board pack",
  list_exceptions: "Scanning exceptions",
  recall_memory: "Recalling what it knows",
  save_memory: "Saving what it learned",
};

/**
 * A one-line "this happened" receipt. `tone` picks the framing — every write
 * so far has settled positively, but `confirmPublishCountersign` below is the
 * first whose settled result is sometimes a gate refusal, so the negative
 * tone this comment used to only anticipate is now in use.
 */
function Receipt({
  tone = "positive",
  children,
}: {
  tone?: "positive" | "negative";
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        tone === "positive"
          ? "my-1 rounded-md border border-positive/30 bg-surface px-3 py-2 text-sm text-ink"
          : "my-1 rounded-md border border-negative/30 bg-surface px-3 py-2 text-sm text-ink"
      }
    >
      {children}
    </div>
  );
}

/**
 * The shared frame ANY of this file's HITL cards show before they can be
 * drawn — no recorded result AND no `respond`. Live, that is the window while
 * the tool call is still streaming; on replay, it is an interrupt that was
 * never answered. Keyed off the ABSENCE of both, never off `status`, so it
 * replays correctly (see the file header's first rule).
 */
function AwaitingCard() {
  return (
    <div className="my-1 rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
      Waiting on you…
    </div>
  );
}

/** A breach's on-screen identity: metric label, department, period — never a narrative code. */
function metricLabel(defs: MetricDef[], id: MetricId): string {
  return defs.find((d) => d.id === id)?.label ?? id;
}

interface PublishRefusal {
  error: string;
  breaches?: { metric: string; department: string; period: string }[];
}

/**
 * A settled `confirmPublishCountersign` result is always a string (see the
 * render's own comment on why), but a REFUSAL was recorded as a JSON-encoded
 * `{ error, breaches }`. Parse that back out so the render can tell a
 * refusal from a plain success sentence; anything that doesn't parse to that
 * shape (i.e. the success sentence itself) is `null`, not a refusal.
 */
function parseRefusal(result: string): PublishRefusal | null {
  try {
    const parsed: unknown = JSON.parse(result);
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
    ) {
      return parsed as PublishRefusal;
    }
  } catch {
    // Not JSON — the success sentence, or an unrelated settled string.
  }
  return null;
}

/**
 * The nav rail's OWN label for a segment (`./nav`), so a navigation receipt
 * can never name a page the rail itself doesn't also call by that name.
 */
function segmentLabel(segment: string): string {
  return (
    execNav.find((route) => route.segment === segment)?.label ?? "that page"
  );
}

// ══ BEAT 6 — TEACH-MODE DIRECTIVE STRINGS ═══════════════════════════════
//
// The strings the teach chain settles with, and the readers that classify
// them back — modelled on airline's `teach-mode-directives.ts` (also
// mirrored in commerce, keel and logistics), but inlined here rather than
// split into a sibling module: this skin's whole HITL surface lives in one
// file. The rule that module exists to hold is unchanged: A CARD STATES ONLY
// WHAT ITS PRODUCER REPORTED. It never re-derives a fact by parsing its own
// rendering, and the mere PRESENCE of a settle is never treated as an
// answer.
//
// ⚠️ NOTHING HERE NAMES A NARRATIVE CODE. `buildDemonstrationDirective`'s
// output is a tool RESULT the agent reads, so it is on the withheld side of
// beat 6's asymmetry (see `agent.ts`'s `isNarrativeCode` doc comment and
// `pages/board-packs.tsx`'s module doc comment for where the four codes may
// legitimately appear). The code it reports is whatever the presenter
// actually filed on that form, passed through at runtime — never imported
// from a catalogue.

const OFFER_ACCEPTED =
  "The presenter agreed to demonstrate. Call awaitDemonstration now and " +
  "wait — do not guess any steps and do not name a narrative code.";
const OFFER_DECLINED =
  "The presenter declined to demonstrate. Stop here and do not retry the " +
  "refused publish.";

function readOfferAccepted(result: unknown): boolean {
  return typeof result === "string" && /agreed to demonstrate/i.test(result);
}

/**
 * The directive `awaitDemonstration` settles with, and the only supported
 * way to read its step count back out. The count travels INSIDE the string
 * because that string is all the card has on REPLAY: the recording context
 * is live-session state and is empty by the time a reopened thread
 * re-renders the card.
 */
function buildDemonstrationDirective({
  steps,
  code,
}: {
  /** The observed step labels, in order, exactly as the recorder captured them. */
  steps: string[];
  /** The narrative code the presenter actually filed, or `null` if none. */
  code: string | null;
}): string {
  const observed = steps
    .map((label, index) => `${index + 1}. ${label}`)
    .join("\n");
  return (
    `The presenter finished after ${steps.length} ` +
    `${steps.length === 1 ? "step" : "steps"}. Observed steps:\n` +
    `${observed || "(nothing captured)"}\n` +
    (code
      ? `The narrative code they filed was ${code}.`
      : "No narrative code was captured — ask the presenter which one they used before saving anything.")
  );
}

/**
 * Anchored at the START of the result, so nothing inside a free-text step
 * label can be mistaken for the count. `null` means "say nothing about a
 * count", never "zero".
 */
function readDemonstratedStepCount(result: unknown): number | null {
  if (typeof result !== "string") return null;
  const match = /^The presenter finished after (\d+) steps?\./.exec(
    result.trim(),
  );
  return match ? Number(match[1]) : null;
}

/**
 * The save card's two directives. SCOPE IS `user`: this deployment shares
 * one memory backend with other products (EXEC_PROMPT rule 12), so a
 * project-scoped row would leak into every sibling skin.
 */
const SAVE_PROCEDURE_CONFIRMED =
  "The presenter confirmed. Persist this with save_memory now (scope " +
  '"user", kind "operational"), then say in one sentence that you have it.';
const SAVE_PROCEDURE_DECLINED =
  "The presenter declined to save it. Do not call save_memory.";

type SaveProcedureOutcome = "pending" | "saved" | "declined" | "unknown";

/**
 * BOTH buttons settle this card with a string, so `typeof result === "string"`
 * says the card was answered and NOTHING about the answer. Branching on
 * presence alone would print "Saved" over a decline — a durable write
 * asserted on stage that never happened, and identically on every replay.
 */
function classifySaveProcedureResult(result: unknown): SaveProcedureOutcome {
  if (typeof result !== "string") return "pending";
  const text = result.trim();
  if (text.length === 0) return "pending";
  if (text === SAVE_PROCEDURE_CONFIRMED) return "saved";
  if (text === SAVE_PROCEDURE_DECLINED) return "declined";
  // Tolerate a paraphrase, but never GUESS "saved": a decline must read as a
  // decline, and only an explicit confirmation earns the receipt.
  if (/declined|do not call save_memory/i.test(text)) return "declined";
  if (/confirmed/i.test(text) && /save_memory/i.test(text)) return "saved";
  return "unknown";
}

/**
 * A neutral "here's what happened" status line for the teach chain's three
 * settles (offered/declined, steps recorded, saved/declined) — not a
 * `Receipt`, because these report a CHOICE or an observation, not a write
 * that succeeded or was refused; `Receipt`'s tone dichotomy does not fit.
 */
function StatusNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-1 rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
      {children}
    </div>
  );
}

/**
 * BEAT 3a — the countersign card `confirmPublishCountersign` opens. The
 * presenter, not the agent, picks WHICH dashboard to publish and types the
 * four-digit countersign PIN here; both stay inside this component until
 * `onSubmit` POSTs them straight to `/api/exec/v1/packs` via `publishPack`
 * (`useExecLedger`). The agent never sees the digits — see the tool's own
 * description below for the full rule.
 */
function PublishCountersignCard({
  initialDashboardId,
  dashboardTitle,
  onSubmit,
  onCancel,
}: {
  initialDashboardId?: DashboardId;
  /** `snapshot.dashboards[id].title`, read live through the caller's ref. */
  dashboardTitle: (id: DashboardId) => string;
  onSubmit: (dashboardId: DashboardId, pin: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [dashboardId, setDashboardId] = useState<DashboardId>(
    initialDashboardId ?? "ceo",
  );
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter the 4-digit countersign PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Settles the interrupt itself (success or refusal) — see onSubmit's
      // implementation below. Only an unexpected exception (a dropped
      // request, a bad response body) reaches this catch, and THAT stays
      // local: nothing was published, so the card stays open to retry
      // rather than handing the agent a made-up outcome.
      await onSubmit(dashboardId, pin);
    } catch (err) {
      console.error("[exec] publish countersign failed:", err);
      setBusy(false);
      setError("The publish could not be sent. Nothing was published.");
      return;
    }
    setPin("");
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
      <div className="text-sm text-ink">
        Countersign the publish of the{" "}
        <span className="font-semibold text-brand">
          {dashboardTitle(dashboardId)}
        </span>{" "}
        as a board pack.
      </div>

      <div
        role="radiogroup"
        aria-label="Choose a dashboard"
        className="flex gap-2"
      >
        {(["ceo", "cfo"] as const).map((id) => {
          const active = id === dashboardId;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => setDashboardId(id)}
              className={
                active
                  ? "rounded-md border border-brand/50 bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand-indigo"
                  : "rounded-md border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted"
              }
            >
              {dashboardTitle(id)}
            </button>
          );
        })}
      </div>

      <label
        className="text-xs text-ink-muted"
        htmlFor="publish-countersign-pin"
      >
        4-digit countersign PIN
      </label>
      <input
        id="publish-countersign-pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={pin}
        disabled={busy}
        aria-label="Countersign PIN"
        onChange={(e) => {
          setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
          setError(null);
        }}
        className="w-24 rounded-md border border-hairline bg-canvas px-3 py-2 font-mono text-sm tracking-widest"
      />
      <p className="text-xs text-ink-muted">
        Cascade&rsquo;s countersign PIN is 7341.
      </p>
      {error ? <p className="text-xs text-negative">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90 disabled:opacity-40"
          onClick={() => void submit()}
        >
          {busy ? "Publishing…" : "Countersign & publish"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted disabled:opacity-40"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ExecTools() {
  const router = useRouter();
  const skinHref = useSkinHref("exec");
  const ledger = useExecLedger();

  // Read through a ref by `confirmPublishCountersign` below, NEVER through
  // the closure — `useHumanInTheLoop` registers once and keeps that config
  // for as long as its deps (`[]`) stay unchanged, so a closure over `ledger`
  // captured at registration would go stale the moment the first `refresh()`
  // (after any write, anywhere in the skin) produces a new snapshot object.
  // Mirrors keel's `deskRef` — see that file's `tools.tsx` header, rule 2.
  const ledgerRef = useRef(ledger);
  useEffect(() => {
    ledgerRef.current = ledger;
  }, [ledger]);

  // ══ BEAT 3c — NAVIGATE WITH LEVERS ═══════════════════════════════════════
  //
  // `navigateTo`, deliberately camelCase: it is what EXEC_PROMPT's rule 9
  // names verbatim (`agent.ts`), and matches the app-wide convention for a
  // FRONTEND tool name (contrast the backend tools above, which are
  // snake_case). No confirmation card — unlike commerce's `showOrderQueue` or
  // keel's `showRegister`, this fires immediately, mirroring keel's own
  // simpler `navigateTo`.
  //
  // ⚠️ EVERY LEVER IS REQUIRED, each carrying an explicit "not pulled"
  // sentinel ("any" for department/period, `false` for threshold, `0` for
  // top), rather than `.optional()`. Measured in logistics, which needed a
  // fix commit for exactly this (`src/skins/logistics/tools.tsx`, and keel's
  // `showRegister` / `ANY_LEVER` in `src/skins/keel/data/register-levers.ts`
  // make the same argument): told in as many words to leave the filters
  // alone, gpt-5.4 still filled the optional enums and put an EMPTY board on
  // screen under four confidently tinted controls. A model facing an
  // optional enum fills it anyway, because omission is not a choice it can
  // STATE. The sentinels are that way of saying it; the handler below maps
  // each one back to `undefined` before calling `execNavTarget`
  // (`./nav-target`), which is the one place the omission rule itself lives.
  //
  // `department`'s `"any"` is DISTINCT from `"all"` — `"all"` is a real
  // narrowing choice (company-wide rows; see `pages/metric-rows.ts`), not a
  // synonym for "leave it alone". Every advertised `department` value comes
  // from the Metrics Explorer's own vocabulary (`pages/metric-rows.ts`'s
  // `DEPARTMENT_VALUES`) plus the `"any"` sentinel, so this tool cannot offer
  // a value the page has no filter for.
  useFrontendTool(
    {
      name: "navigateTo",
      description:
        "Navigate the desk to one of Vantage's four pages, with the " +
        "Metrics Explorer's levers set: a department, a period, " +
        "breaches-only, and a top-N limit. EVERY lever is REQUIRED: set " +
        "the ones the request implies, and pass 'any'/0/false to say " +
        "'leave this lever alone' — that is the only way to say it. Never " +
        "fill a lever merely because the schema offers it: a lever the " +
        "operator did not ask for narrows the board for no reason and " +
        "claims a choice they never made. The levers only take effect on " +
        "the Metrics Explorer; passing them for another page is harmless " +
        "but has no effect.",
      parameters: z.object({
        segment: z
          .enum(["", "finance", "metrics", "packs"])
          .describe(
            "Which page to open: '' for the CEO dashboard, 'finance' for " +
              "the CFO dashboard, 'metrics' for the Metrics Explorer, " +
              "'packs' for Board packs.",
          ),
        department: z
          .enum([
            "manufacturing",
            "distribution",
            "field-services",
            "corporate",
            "all",
            "any",
          ])
          .describe(
            "Restrict the Metrics Explorer to one department, 'all' for " +
              "company-wide rows only, or 'any' to leave every department " +
              "in. Use 'any' unless the operator named a department.",
          ),
        period: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$|^any$/)
          .describe(
            'One period, spelled "YYYY-MM" (e.g. "2024-06"), or "any" to ' +
              'leave every period in. Use "any" unless the operator named a ' +
              "period.",
          ),
        threshold: z
          .boolean()
          .describe(
            "true to show only metrics breaching their threshold, false " +
              "to leave every metric in.",
          ),
        top: z
          .number()
          .int()
          .min(0)
          .describe(
            "Limit to the top N rows by |variance|. Use 0 for no limit.",
          ),
      }),
      handler: async ({ segment, department, period, threshold, top }) => {
        const target = execNavTarget({
          segment,
          department: department === "any" ? undefined : department,
          period: period === "any" ? undefined : period,
          threshold: threshold === false ? undefined : threshold,
          top: top === 0 ? undefined : top,
        });
        router.push(skinHref(target));
        return `Opened ${segmentLabel(segment)}.`;
      },
      // Replay-safe: the recorded sentence IS the receipt. Nothing here reads
      // `status`, so a reopened thread shows what happened rather than
      // "Opening…" forever.
      render: ({ result }) => {
        const text = typeof result === "string" ? result : null;
        return text ? <Receipt>{text}</Receipt> : null;
      },
    },
    [router, skinHref],
  );

  // ══ BEAT 3a — COUNTERSIGN THE PUBLISH, PIN WITHHELD ═════════════════════
  //
  // The agent names nothing but (optionally) which dashboard — the presenter
  // picks the dashboard and types the four-digit countersign PIN inside
  // `PublishCountersignCard` itself, which calls `publishPack` from
  // `useExecLedger()` DIRECTLY. This is deliberately NOT a second path to
  // `publish_board_pack` (`agent.ts`'s backend tool of the same write): that
  // tool exists only so `store.publishPack`'s gate has one implementation,
  // never as a route this card also drives — see that tool's own doc comment
  // and EXEC_PROMPT rule 4 for why the agent must never call it with a PIN it
  // composed. The agent's `respond()` gets either one sentence naming the
  // published pack, or the refusal `{ error, breaches }` VERBATIM — never the
  // digits, and never fewer than `UNEXPLAINED_VARIANCE` itself needs to
  // trigger beat 6's teach loop.
  useHumanInTheLoop(
    {
      name: "confirmPublishCountersign",
      description:
        "Open the countersign card so the presenter can pick which " +
        "dashboard to publish and type the four-digit countersign PIN " +
        "themselves. Open this card as soon as a publish is asked for — " +
        "you do not know the PIN and must NEVER request it, repeat it " +
        "back, or guess at it; the card is the only place it is typed and " +
        "it never reaches you. If the publish is refused, relay the " +
        "refusal exactly as given and do not look for a way past it.",
      parameters: z.object({
        dashboardId: z
          .enum(["ceo", "cfo"])
          .optional()
          .describe(
            "Which dashboard to publish, if the presenter already named " +
              "one. Omit to let the card's own picker decide.",
          ),
      }),
      render: ({ args, result, respond }) => {
        // Replay-safe: keyed off `result`, never `status`. A refusal settles
        // this call just as much as a publish does — but EITHER way, `core`
        // JSON-stringifies whatever `respond()` was given before it lands
        // here (`copilotKitCore.runTool` does this for every tool, human-in-
        // -the-loop included), so a settled `result` is always a plain
        // string and the refusal shape below has to be parsed back out of
        // it rather than read directly off `result`.
        if (typeof result === "string") {
          const refusal = parseRefusal(result);
          if (refusal) {
            return (
              <Receipt tone="negative">
                Publish refused: {refusal.error}.
                {refusal.breaches && refusal.breaches.length > 0 ? (
                  <ul className="mt-1 list-disc pl-4">
                    {refusal.breaches.map((b, i) => (
                      <li key={i}>
                        {b.metric} · {b.department} · {b.period}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Receipt>
            );
          }
          return <Receipt tone="positive">{result}</Receipt>;
        }
        if (!respond) return <AwaitingCard />;

        return (
          <PublishCountersignCard
            initialDashboardId={args?.dashboardId}
            dashboardTitle={(id) =>
              ledgerRef.current.snapshot.dashboards[id]?.title ?? id
            }
            onSubmit={async (dashboardId, pin) => {
              const { snapshot, publishPack } = ledgerRef.current;
              const outcome = await publishPack(dashboardId, pin);
              // `PublishPackResult` narrows on `status === 200` alone (its
              // own doc comment), but `status`'s OTHER member is `number`,
              // not a second literal — so TS can only narrow the success
              // arm off `status === 200`, never exclude it from the arm
              // that follows. `"pack" in outcome` narrows both directions
              // instead, off the same `pack?: never` the type already uses
              // to stay narrowable.
              if ("pack" in outcome) {
                const title =
                  snapshot.dashboards[dashboardId]?.title ?? dashboardId;
                respond?.(`${title} is published as a board pack.`);
                return;
              }
              // Forwarded VERBATIM: `UNEXPLAINED_VARIANCE` must survive as
              // the literal string for beat 6's teach loop to fire, and each
              // breach is reshaped to metric/department/period only — never
              // the withheld narrative-code vocabulary, which no Exception
              // even carries.
              respond?.({
                error: outcome.error,
                ...(outcome.breaches
                  ? {
                      breaches: outcome.breaches.map((b) => ({
                        metric: metricLabel(snapshot.metricDefs, b.metricId),
                        department: b.department,
                        period: b.period,
                      })),
                    }
                  : {}),
              });
            }}
            onCancel={() =>
              respond?.(
                "The presenter cancelled the countersignature. Nothing was published.",
              )
            }
          />
        );
      },
    },
    [],
  );

  // ══ BEAT 6 — TEACH IT A PROCEDURE IT DOES NOT HAVE ═══════════════════════
  //
  // The chain, in order: offerWorkflowRecording → awaitDemonstration →
  // saveLearnedProcedure. All three are `followUp: true`, so the agent
  // advances to the next card as soon as one settles rather than stopping to
  // narrate. Copied from airline's `tools.tsx` (lines 1166–1360) and
  // reworded for Vantage's domain — never imported across the skin
  // boundary.
  //
  // EXEC_PROMPT rule 6 is this chain's whole trigger condition, spelled out
  // there rather than re-derived here: a publish refused with
  // UNEXPLAINED_VARIANCE, recall_memory turning up nothing, then (once the
  // presenter agrees) awaitDemonstration watching them file a narrative on
  // the Board Packs form (`./pages/board-packs.tsx`'s `NarrativeFilingForm`,
  // which brackets that write with the shell's recorder — see
  // `DemonstrationCard`'s doc comment below). saveLearnedProcedure then
  // persists what was seen, and the agent's NEXT ordinary action — calling
  // confirmPublishCountersign again — is the SAME publish re-attempted with
  // what it just learned; this chain does not re-drive that call itself.
  //
  // ⚠️ THE WITHHELD VOCABULARY. Beat 6 only exists because the four
  // narrative codes are withheld from Vantage on every channel (see
  // `agent.ts`'s `isNarrativeCode` doc comment) — nothing here, in
  // `agent.ts`, or in EXEC_PROMPT may name one. Vantage learns which code
  // clears a breach only by WATCHING the presenter pick one on the filing
  // form.

  useHumanInTheLoop(
    {
      followUp: true,
      name: "offerWorkflowRecording",
      description:
        "Offer to WATCH the presenter do something you have no saved " +
        "procedure for. Call this ONLY immediately after a publish is " +
        "refused with UNEXPLAINED_VARIANCE — the refusal comes back as " +
        "confirmPublishCountersign's result — and recall_memory has turned " +
        "up nothing for it — say plainly which metrics are unexplained and " +
        "that you do not have a saved way past this. Never guess a " +
        "narrative code, re-publish hoping for a different answer, remove " +
        "the offending block from the dashboard, or offer the countersign " +
        "card as a way past it instead of calling this.",
      parameters: z.object({
        situation: z
          .string()
          .describe(
            "Which metrics are unexplained and blocking the publish, in " +
              "one short line.",
          ),
      }),
      render: ({ args, result, respond }) => {
        // Replay-safe, and a HUMAN line rather than `result`: that string is
        // an internal directive addressed to the agent ("Call
        // awaitDemonstration now…"), and printing it verbatim puts the
        // demo's own wiring on screen in front of the room.
        if (typeof result === "string") {
          return (
            <StatusNote>
              {readOfferAccepted(result)
                ? "Watching you do it once."
                : "Left it for now — nothing was recorded."}
            </StatusNote>
          );
        }
        if (!respond) return <AwaitingCard />;
        return (
          <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
            <div className="text-sm text-ink">
              I don&rsquo;t have a saved way through this one
              {args?.situation
                ? ` — ${args.situation.replace(/\.+$/, "")}`
                : ""}
              . Show me once and I&rsquo;ll remember it?
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                onClick={() => respond?.(OFFER_ACCEPTED)}
              >
                Show me
              </button>
              <button
                type="button"
                className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                onClick={() => respond?.(OFFER_DECLINED)}
              >
                Not now
              </button>
            </div>
          </div>
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
        "Hold the conversation while the presenter demonstrates. Call this " +
        "after they agree to show you. Do NOT list steps, name a narrative " +
        "code, or tell them where to click — you do not know it, which is " +
        "the entire reason you are watching. Say only something brief like " +
        "'go ahead, I'm watching'. When they finish you receive the steps " +
        "they took and the exact narrative code they filed on the Board " +
        "Packs form.",
      parameters: z.object({}),
      render: ({ result, respond }) => {
        // Replay-safe, and the count is the one the RECORDER reported —
        // never one re-counted out of this prose.
        if (typeof result === "string") {
          const count = readDemonstratedStepCount(result);
          return (
            <StatusNote>
              Recorded{" "}
              {count === null
                ? "the demonstration"
                : `${count} ${count === 1 ? "step" : "steps"}`}
              .
            </StatusNote>
          );
        }
        if (!respond) return <AwaitingCard />;
        // Its own component, so it subscribes to the recorder directly and
        // re-renders on every logged step, AND owns the outer recording
        // bracket across the presenter's whole demonstration. Inlining
        // either would freeze the feed or strand the demonstrated code —
        // see `DemonstrationCard`'s own doc comment.
        return <DemonstrationCard onDone={(summary) => respond?.(summary)} />;
      },
    },
    [],
  );

  useHumanInTheLoop(
    {
      followUp: true,
      name: "saveLearnedProcedure",
      description:
        "Summarize what you just watched as a numbered procedure and show " +
        "it to the presenter for confirmation. Call this after " +
        "awaitDemonstration reports what it saw, quoting the exact " +
        "narrative code it reports — never paraphrase or substitute a " +
        "different one. After they confirm, persist it with save_memory " +
        'exactly as the card\'s result instructs, at scope "user". Save it ' +
        "AT MOST ONCE.",
      parameters: z.object({
        procedure: z
          .string()
          .describe(
            "The numbered procedure, naming verbatim the narrative code " +
              "awaitDemonstration reported. Do not paraphrase it.",
          ),
      }),
      render: ({ args, result, respond }) => {
        // CLASSIFIED, never merely detected — see
        // `classifySaveProcedureResult`'s doc comment.
        if (typeof result === "string") {
          const outcome = classifySaveProcedureResult(result);
          return (
            <StatusNote>
              {outcome === "saved"
                ? "Saved — I'll use this next time without being asked."
                : outcome === "declined"
                  ? "Left it unsaved — nothing was written to memory."
                  : outcome === "unknown"
                    ? "This card was already answered."
                    : "Writing up what I saw…"}
            </StatusNote>
          );
        }
        if (!respond) return <AwaitingCard />;
        return (
          <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
            <div className="text-sm font-medium text-ink">
              Here&rsquo;s what I picked up — shall I remember it?
            </div>
            <pre className="whitespace-pre-wrap rounded-md bg-surface-muted p-2.5 text-xs leading-relaxed text-ink">
              {args?.procedure}
            </pre>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                onClick={() => respond?.(SAVE_PROCEDURE_CONFIRMED)}
              >
                Remember it
              </button>
              <button
                type="button"
                className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                onClick={() => respond?.(SAVE_PROCEDURE_DECLINED)}
              >
                Don&rsquo;t save
              </button>
            </div>
          </div>
        );
      },
    },
    [],
  );

  return null;
}

/**
 * BEAT 6 — the live "I'm watching" card, rendered inside `awaitDemonstration`'s
 * interrupt.
 *
 * A component rather than an inline render closure for two reasons:
 *
 *  1. It subscribes to the recorder ITSELF, so each `logStep` re-renders the
 *     feed. A feed read from the host card's closure freezes on the
 *     snapshot taken before the presenter touched anything.
 *  2. It OWNS THE OUTER RECORDING BRACKET — `beginRecording()` on mount,
 *     `endRecording()` on unmount. `NarrativeFilingForm`
 *     (`./pages/board-packs.tsx`) brackets its own write NESTED inside this
 *     one; the shell's recorder is ref-counted, so both stay open across
 *     the presenter's whole demonstration rather than clearing the feed the
 *     moment the form's own bracket closes.
 *
 * No feed reset on mount: the shell's `beginRecording` clears it when it
 * opens a FRESH window and deliberately inherits an already-open one.
 */
function DemonstrationCard({ onDone }: { onDone: (summary: string) => void }) {
  const { beginRecording, endRecording, steps, getDemonstratedCode } =
    useRecording();

  useEffect(() => {
    beginRecording();
    return () => endRecording();
  }, [beginRecording, endRecording]);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-negative opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-negative" />
        </span>
        <span className="text-sm text-ink">
          Watching — go ahead and show me.
        </span>
        <span className="ml-auto text-[0.65rem] font-semibold uppercase tracking-wide text-negative">
          Rec
        </span>
      </div>

      {steps.length > 0 ? (
        <ol className="space-y-1 border-l-2 border-brand/30 pl-3">
          {steps.map((step, index) => (
            <li key={step.id} className="text-xs text-ink">
              <span className="mr-1.5 tabular-nums text-ink-muted">
                {index + 1}.
              </span>
              {step.label}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs italic text-ink-muted">Nothing captured yet.</p>
      )}

      <button
        type="button"
        className="self-start rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
        onClick={() =>
          onDone(
            buildDemonstrationDirective({
              steps: steps.map((s) => s.label),
              code: getDemonstratedCode(),
            }),
          )
        }
      >
        I&rsquo;m done
      </button>
    </div>
  );
}
