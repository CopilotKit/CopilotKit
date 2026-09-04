"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  useFrontendTool,
  useHumanInTheLoop,
  useRenderTool,
} from "@copilotkit/react-core/v2";
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
 * This file is built up across several micro-tasks. It now registers beats
 * 3a/5 (`pinBlockToDashboard`, the agent's route to the same pin the block's
 * own "Add to dashboard" control performs), beat 3c
 * (the explorer-lever navigation), beat 3a (`confirmPublishCountersign`, the
 * countersign-PIN card that is the ONLY publish path — keel's
 * `countersignRelease` and banking's card-PIN HITL, both in their own
 * `tools.tsx`, are the references), and beat 6 (the teach chain —
 * `offerWorkflowRecording` → `awaitDemonstration` → `saveLearnedProcedure`,
 * copied from airline's `tools.tsx` lines 1166–1360 and reworded for
 * Vantage's domain: a board-pack publish refused for unexplained variance,
 * watched and learned as a narrative code filed on the Board Packs form).
 *
 * ⚠️ ONE PLACE CLASSIFIES A SETTLE. Every render below reads its outcome
 * through `classifyToolSettle` / `SettleReceipt` (see the block comment above
 * them), never off `typeof result === "string"` — that says a call SETTLED and
 * nothing about how, and the ad-hoc per-render checks this replaced printed
 * green receipts over a cancelled countersign, an aborted card and an
 * error-prefixed relay alike.
 */

/**
 * Human labels for the BACKEND tool-activity chips, keyed to the backend tool
 * names: the four `agent.ts` registers (`get_metrics`, `list_exceptions`,
 * `render_metric_block`, `file_variance_narrative`) plus the platform's
 * `recall_memory` / `save_memory`, which arrive over the
 * Intelligence MCP path (`src/app/api/copilotkit/[[...slug]]/route.ts`) and
 * match through the shell's `includes` lookup despite their
 * `mcp__intelligence__` prefix — so the transcript reads as phrases rather
 * than function names. Mirrors
 * the sibling skins' `TOOL_LABELS` (e.g. `src/skins/commerce/skin.tsx`), but
 * lives here rather than in `skin.tsx` because this file is where the rest of
 * the beat map is assembled; `skin.tsx` spreads this into its `toolLabels`,
 * adding the six FRONTEND tool labels registered below plus the platform's
 * `generateSandboxedUi`.
 *
 * `publish_board_pack` is labelled even though `agent.ts` deliberately does
 * NOT register it (see that tool's doc comment): the REST write it wraps is
 * the one the countersign card drives, so the label documents that activity
 * if it is ever surfaced, and costs nothing while it is not.
 *
 * `file_variance_narrative`'s label is likewise a FALLBACK now: `ExecTools`
 * registers an exact tool-call renderer for it (see `NarrativeFiledReceipt`),
 * and CopilotKit prefers an exact renderer over the shell's wildcard chip. The
 * entry stays so the chip is still labelled if that registration is ever
 * removed.
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
 * A one-line "this happened" receipt. `tone` picks the framing: `positive` for
 * a write that landed, `negative` for one that was refused or failed. A
 * settle that reports NOTHING happening — a cancel, an abort — is neither, and
 * uses `StatusNote` instead; `SettleReceipt` is the one place that choice is
 * made.
 *
 * `data-settle-tone` carries the choice into the DOM: it is the only
 * externally visible difference between the three framings, so it is what
 * `./tool-settle.test.tsx` asserts on rather than a Tailwind class string.
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
      data-settle-tone={tone}
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

/** A breach as the refusal render prints it — three display strings, always present. */
type Breach = { metric: string; department: string; period: string };

interface PublishRefusal {
  error: string;
  breaches?: Breach[];
}

/**
 * One breach field, as a string safe to render. The refusal body reaching this
 * point was PARSED, never validated — it is `JSON.parse` of whatever the
 * settle carried — so every field is `unknown` until proven otherwise, and a
 * missing one prints a placeholder rather than "undefined" or (worse) throwing
 * out of a transcript render.
 */
function breachField(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

/**
 * A settled `confirmPublishCountersign` result is always a string (see
 * `classifyToolSettle`'s comment on why), but a REFUSAL was recorded as a
 * JSON-encoded `{ error, breaches }`. Parse that back out so the render can
 * tell a refusal from a plain success sentence; anything that doesn't parse to
 * that shape (i.e. the success sentence itself) is `null`, not a refusal.
 *
 * ⚠️ THE SHAPE IS GUARDED, not trusted. `breaches` is only mapped when it is
 * actually an array, and each entry's three fields go through
 * `breachField` — a body with `breaches: [null]` or `breaches: "…"` used to
 * throw `Cannot read properties of null` INSIDE the render, which in a
 * transcript means the whole chat column unmounts mid-demo rather than one
 * malformed receipt reading badly.
 */
function parseRefusal(result: string): PublishRefusal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    // Not JSON — the success sentence, or an unrelated settled string.
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.error !== "string") return null;
  if (!Array.isArray(body.breaches)) return { error: body.error };
  const breaches = body.breaches.map((entry): Breach => {
    const b: Record<string, unknown> =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : {};
    return {
      metric: breachField(b.metric, "an unnamed metric"),
      department: breachField(b.department, "—"),
      period: breachField(b.period, "—"),
    };
  });
  return { error: body.error, breaches };
}

/**
 * The stable prefix `pinBlockToDashboard`'s FAILURE arm settles with, declared
 * to the settle classifier as that tool's `failed` vocabulary. Anchored at the
 * start so nothing in a relayed error message can flip a successful pin into a
 * failed one.
 */
const PIN_FAILED_PREFIX = "Could not pin that block";

/**
 * The sentence `confirmPublishCountersign`'s Cancel button settles the
 * interrupt with. A CONSTANT rather than an inline literal because two places
 * need the identical bytes: the `onCancel` that produces it, and the settle
 * classifier that has to recognise it as "nothing happened" rather than as a
 * publish receipt.
 */
const PUBLISH_CANCELLED =
  "The presenter cancelled the countersignature. Nothing was published.";

// ══ THE SETTLE CLASSIFIER ════════════════════════════════════════════════
//
// EVERY render in this file reads the same kind of value: the string the tool
// (or a HITL card's `respond`) settled the call with. `typeof result ===
// "string"` says the call SETTLED and nothing whatsoever about how — so a
// render that branches on presence alone prints a green receipt over a cancel
// and over an abort. On stage that is a board pack reported as published that
// was never published, and it re-reads identically on every replay of the
// thread.
//
// The five things that string can be, per CopilotKit's settle semantics
// (`copilotKitCore.runTool` JSON-stringifies whatever `respond()` was given,
// for every tool, HITL included):
//
//   respond("a sentence")  → the raw sentence
//   respond({ … })         → its JSON encoding (so a refusal must be PARSED
//                            back out; it is never readable off `result`)
//   respond() / respond(null) → the EMPTY string — answered, nothing said
//   never answered + the run aborts → the platform's `HITL_ABORTED` sentinel
//   still streaming        → `undefined` (no settle at all)
//
// `classifyToolSettle` is the ONE place that distinction is made and
// `SettleReceipt` the one place it is drawn, so a new render cannot re-invent
// a looser rule. The per-tool vocabularies live in `EXEC_SETTLES`: a card's
// own cancel sentence and a handler's own failure prefix are the only
// tool-specific strings, and each is declared beside the code that produces
// it rather than sniffed for with a regex.

/**
 * The literal string CopilotKit settles a NEVER-ANSWERED interrupt with when
 * the run ends under it. It arrives error-prefixed, but it is not a failure of
 * the write — the write never ran — so it classifies as cancelled, and the
 * sentinel itself never reaches the screen: it names the platform's internals
 * in front of the room.
 */
const HITL_ABORTED = "Error: Human-in-the-loop interaction aborted";

/**
 * The tool-specific half of the classification. `cancelled` holds the card's
 * OWN cancel/withdraw sentences (compared whole, never pattern-matched);
 * `failed` holds the handler's own failure prefixes (anchored at the start, so
 * nothing inside a relayed message can flip an outcome); `refusedLabel` words
 * the gate refusal.
 */
type KnownSettles = {
  cancelled?: readonly string[];
  failed?: readonly string[];
  refusedLabel?: string;
  /**
   * What this particular tool did NOT do, for the neutral line an abort or an
   * empty settle reads as ("Nothing was published.", "…nothing was
   * captured."). Optional: the generic line is honest, just vaguer.
   */
  nothingDone?: string;
};

/**
 * Every tool in this file that has a settle vocabulary of its own, keyed by
 * tool name. A tool absent from a field has none — `navigateTo` cannot fail
 * (it pushes a route) and has no card to cancel, so the shared rules are all
 * it needs.
 *
 * Exported for `./tool-settle.test.tsx`, which renders each tool's settled arm
 * exactly as the registration below does.
 */
export const EXEC_SETTLES = {
  confirmPublishCountersign: {
    cancelled: [PUBLISH_CANCELLED],
    refusedLabel: "Publish refused",
    nothingDone:
      "The countersign card was never answered. Nothing was published.",
  },
  pinBlockToDashboard: {
    failed: [PIN_FAILED_PREFIX],
    nothingDone: "Nothing was pinned.",
  },
  navigateTo: {},
  // The one BACKEND tool with a render of its own (`NarrativeFiledReceipt`).
  file_variance_narrative: { nothingDone: "Nothing was filed." },
  offerWorkflowRecording: {
    nothingDone: "The offer was never answered — nothing was captured.",
  },
  awaitDemonstration: {
    nothingDone: "The demonstration wasn't completed — nothing was captured.",
  },
  saveLearnedProcedure: {
    nothingDone: "This was never confirmed — nothing was written to memory.",
  },
} satisfies Record<string, KnownSettles>;

export type ToolSettle =
  | { kind: "pending" }
  | { kind: "refusal"; error: string; breaches?: Breach[] }
  | { kind: "cancelled"; via: "choice" | "abort" | "empty"; text: string }
  | { kind: "error"; message: string }
  | { kind: "success"; text: string };

/**
 * Classify one settled tool result. `known` is that tool's own vocabulary from
 * `EXEC_SETTLES`; omitting it applies only the universal rules, which is why
 * the same cancel sentence classifies as `success` without it — no render may
 * recognise a cancel it was not told about.
 *
 * Exported for `./tool-settle.test.tsx`.
 */
export function classifyToolSettle(
  result: unknown,
  known?: KnownSettles,
): ToolSettle {
  if (typeof result !== "string") return { kind: "pending" };
  const text = result.trim();
  // Answered with nothing (`respond()` / `respond(null)`). The interrupt is
  // closed, so `pending`'s "Waiting on you…" would be a lie too — but nothing
  // was reported, so nothing may be claimed.
  if (text.length === 0) return { kind: "cancelled", via: "empty", text };
  if (text.startsWith(HITL_ABORTED)) {
    return { kind: "cancelled", via: "abort", text };
  }
  if (known?.cancelled?.some((sentence) => text === sentence.trim())) {
    return { kind: "cancelled", via: "choice", text };
  }
  const refusal = parseRefusal(text);
  if (refusal) return { kind: "refusal", ...refusal };
  // `\b` so a sentence merely CONTAINING the word ("Errors were cleared…")
  // is still the success it is.
  if (/^Error\b/i.test(text)) return { kind: "error", message: text };
  if (known?.failed?.some((prefix) => text.startsWith(prefix))) {
    return { kind: "error", message: text };
  }
  return { kind: "success", text };
}

/**
 * The line a cancelled settle reads as. `via: "choice"` prints the card's own
 * sentence — this file wrote it, for the room, and it says more than any
 * generic phrasing could. The other two have no such sentence to print.
 */
function cancelledLine(
  settle: Extract<ToolSettle, { kind: "cancelled" }>,
  known?: KnownSettles,
): string {
  if (settle.via === "choice") return settle.text;
  return known?.nothingDone ?? "This wasn't completed — nothing was done.";
}

/**
 * The settled arm EVERY tool render in this file draws, given that tool's
 * `EXEC_SETTLES` entry. Renders nothing while the call is `pending`, so a
 * caller can fall through to its own card.
 *
 * ⚠️ The `success` arm prints the settled text VERBATIM, which is right for
 * the receipt-shaped tools (their result IS the receipt) and wrong for the
 * teach chain, whose results are directives addressed to the agent. Those
 * three renders word their own success line and delegate only the other kinds
 * here — see `OfferSettle` and its siblings.
 *
 * Exported for `./tool-settle.test.tsx`.
 */
export function SettleReceipt({
  result,
  known,
}: {
  result: unknown;
  known?: KnownSettles;
}) {
  const settle = classifyToolSettle(result, known);
  switch (settle.kind) {
    case "pending":
      return null;
    case "cancelled":
      return <StatusNote>{cancelledLine(settle, known)}</StatusNote>;
    case "error":
      return <Receipt tone="negative">{settle.message}</Receipt>;
    case "refusal":
      return (
        <Receipt tone="negative">
          {known?.refusedLabel ?? "Refused"}: {settle.error}.
          {settle.breaches && settle.breaches.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {settle.breaches.map((b, i) => (
                <li key={i}>
                  {b.metric} · {b.department} · {b.period}
                </li>
              ))}
            </ul>
          ) : null}
        </Receipt>
      );
    case "success":
      return <Receipt tone="positive">{settle.text}</Receipt>;
  }
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
 * one memory backend with other products (EXEC_PROMPT rule 13), so a
 * project-scoped row would leak into every sibling skin.
 */
const SAVE_PROCEDURE_CONFIRMED =
  "The presenter confirmed. Persist this with save_memory now (scope " +
  '"user", kind "operational"), then say in one sentence that you have it.';
const SAVE_PROCEDURE_DECLINED =
  "The presenter declined to save it. Do not call save_memory.";

type SaveProcedureOutcome = "saved" | "declined" | "unknown";

/**
 * BOTH buttons settle this card with a string, so `typeof result === "string"`
 * says the card was answered and NOTHING about the answer. Branching on
 * presence alone would print "Saved" over a decline — a durable write
 * asserted on stage that never happened, and identically on every replay.
 *
 * Called only for a `success` settle (`classifyToolSettle` has already ruled
 * out the empty, aborted, cancelled and error cases), so it decides one thing
 * only: which of the two DIRECTIVES this is.
 */
function classifySaveProcedureResult(text: string): SaveProcedureOutcome {
  if (text === SAVE_PROCEDURE_CONFIRMED) return "saved";
  if (text === SAVE_PROCEDURE_DECLINED) return "declined";
  // Tolerate a paraphrase, but never GUESS "saved": a decline must read as a
  // decline, and only an explicit confirmation earns the receipt.
  if (/declined|do not call save_memory/i.test(text)) return "declined";
  if (/confirmed/i.test(text) && /save_memory/i.test(text)) return "saved";
  return "unknown";
}

/**
 * A neutral "here's what happened" status line — not a `Receipt`, because it
 * reports a CHOICE, an observation, or a thing that simply did not happen,
 * none of which is a write that succeeded or was refused; `Receipt`'s tone
 * dichotomy does not fit any of them.
 *
 * Used by the teach chain's three settles (offered/declined, steps recorded,
 * saved/declined) AND by every cancelled-or-aborted settle in the file, via
 * `SettleReceipt` — a cancel drawn in `Receipt`'s green is the bug this whole
 * classifier exists to prevent.
 */
function StatusNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-settle-tone="neutral"
      className="my-1 rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted"
    >
      {children}
    </div>
  );
}

// ══ BEAT 6 — THE TEACH CHAIN'S THREE SETTLED ARMS ═══════════════════════
//
// Each one runs the SHARED classifier first and only words its own line for a
// `success` — a cancel, an abort or an error is drawn by `SettleReceipt` like
// everywhere else in this file. That ordering is the point: these three cards
// settle with DIRECTIVES addressed to the agent, and a render that reads a
// directive out of the abort sentinel reports a choice ("Left it for now") or
// an observation ("Recorded the demonstration") that nobody made. They print
// a human line rather than `result` for the same reason the offer card always
// did: the directive is the demo's own wiring, and it is not for the room.
//
// Exported for `./tool-settle.test.tsx`.

export function OfferSettle({ result }: { result: unknown }) {
  const settle = classifyToolSettle(
    result,
    EXEC_SETTLES.offerWorkflowRecording,
  );
  if (settle.kind !== "success") {
    return (
      <SettleReceipt
        result={result}
        known={EXEC_SETTLES.offerWorkflowRecording}
      />
    );
  }
  // BOTH buttons settle with a directive, so only the ACCEPTED one may read
  // as accepted — a decline is a real answer and says so.
  return (
    <StatusNote>
      {readOfferAccepted(settle.text)
        ? "Watching you do it once."
        : "Left it for now — nothing was recorded."}
    </StatusNote>
  );
}

export function DemonstrationSettle({ result }: { result: unknown }) {
  const settle = classifyToolSettle(result, EXEC_SETTLES.awaitDemonstration);
  if (settle.kind !== "success") {
    return (
      <SettleReceipt result={result} known={EXEC_SETTLES.awaitDemonstration} />
    );
  }
  // The count is the RECORDER's, read back off its own directive — never
  // re-counted out of this prose. An UNREADABLE count means nothing is known
  // about what was captured, and a count of zero means nothing was: neither
  // may read as "Recorded the demonstration.", which asserts an observation
  // in the exact case where there is none.
  const count = readDemonstratedStepCount(settle.text);
  if (count === null || count === 0) {
    return (
      <StatusNote>The demonstration ended with nothing captured.</StatusNote>
    );
  }
  return (
    <StatusNote>
      Recorded {count} {count === 1 ? "step" : "steps"}.
    </StatusNote>
  );
}

export function SaveProcedureSettle({ result }: { result: unknown }) {
  const settle = classifyToolSettle(result, EXEC_SETTLES.saveLearnedProcedure);
  if (settle.kind !== "success") {
    return (
      <SettleReceipt
        result={result}
        known={EXEC_SETTLES.saveLearnedProcedure}
      />
    );
  }
  // CLASSIFIED, never merely detected — see `classifySaveProcedureResult`.
  const outcome = classifySaveProcedureResult(settle.text);
  return (
    <StatusNote>
      {outcome === "saved"
        ? "Saved — I'll use this next time without being asked."
        : outcome === "declined"
          ? "Left it unsaved — nothing was written to memory."
          : "This card was answered, but not in a way I can report — nothing is claimed either way."}
    </StatusNote>
  );
}

/**
 * BEAT 3a — the countersign card `confirmPublishCountersign` opens. The
 * presenter, not the agent, picks WHICH dashboard to publish and types the
 * four-digit countersign PIN here; both stay inside this component until
 * `onSubmit` POSTs them straight to `/api/exec/v1/packs` via `publishPack`
 * (`useExecLedger`). The agent never sees the digits — see the tool's own
 * description below for the full rule.
 *
 * A MISTYPED PIN IS NOT AN OUTCOME. `onSubmit` returns a message when the
 * card should stay OPEN instead of settling the interrupt — which is exactly
 * the 403 BAD_COUNTERSIGN arm: on stage a typo is one wrong keystroke, and
 * settling on it would end the interrupt, hand the agent a refusal it can do
 * nothing about, and force the presenter to ask for the card again. Only a
 * published pack or the variance refusal beat 6 turns on settle.
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
  /**
   * Resolves `null` once it has settled the interrupt, or a message to show
   * inline while the card stays open for a retype.
   */
  onSubmit: (dashboardId: DashboardId, pin: string) => Promise<string | null>;
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
    let problem: string | null;
    try {
      // Settles the interrupt itself on a publish or the variance refusal,
      // and returns a message instead when the card must stay open — see
      // onSubmit's implementation below. Only an unexpected exception (a
      // dropped request, a bad response body) reaches this catch, and THAT
      // stays local too: nothing was published, so the card stays open to
      // retry rather than handing the agent a made-up outcome.
      problem = await onSubmit(dashboardId, pin);
    } catch (err) {
      console.error("[exec] publish countersign failed:", err);
      setBusy(false);
      setError("The publish could not be sent. Nothing was published.");
      return;
    }
    setPin("");
    if (problem) {
      // Still the presenter's card: re-enable it and say why, rather than
      // leaving four disabled digits and a "Publishing…" button forever.
      setBusy(false);
      setError(problem);
    }
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

/**
 * The receipt for a filed narrative — AND the one thing that puts it on screen.
 *
 * `file_variance_narrative` is exec's only BACKEND write (`agent.ts`): it calls
 * `store.fileNarrative` inside the runtime process, so no client code runs and
 * nothing re-reads `GET /api/exec/v1/ledger`. Every other write in this skin
 * goes through `useExecLedger`'s mutation wrappers, which `await refresh()`
 * themselves (`./data/ledger-context.tsx`) — this one had no such hook, so the
 * Board Packs narrative list, the exception rows and their `explained` flags all
 * stayed on the snapshot from before the filing until some unrelated write
 * happened to refresh. On stage that reads as a filing that did not take.
 *
 * `refresh` is called from an EFFECT keyed on `toolCallId`, so it fires exactly
 * once per completed call: React remounts this component per tool call, and a
 * reopened thread re-running it once is not just harmless but right — the
 * reopened page should show current data.
 *
 * The receipt itself is keyed off `result`, never `status` (see the file
 * header's first rule), so a replayed thread shows what happened rather than
 * "Filing…" forever.
 *
 * Exported for `./narrative-filed-receipt.test.tsx` only — the refresh is the
 * whole point of it and is invisible from the outside, so it is the one thing
 * here worth a test of its own. Nothing else imports it.
 */
export function NarrativeFiledReceipt({
  toolCallId,
  result,
  refresh,
}: {
  toolCallId: string;
  result: string | undefined;
  refresh: () => Promise<void>;
}) {
  const settle = classifyToolSettle(
    result,
    EXEC_SETTLES.file_variance_narrative,
  );
  const settled = settle.kind !== "pending";
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!settled) return;
    // Fire-and-log: a failed re-read must not throw inside a transcript
    // render, and `refresh` already keeps the last good snapshot on screen.
    void refreshRef.current().catch((err) => {
      console.error("[exec] ledger refresh after narrative filing failed", err);
    });
  }, [toolCallId, settled]);

  // The backend result is the filed row, a refusal (`{ error: "BAD_CODE" }`),
  // or — like every other settle in this file — an error relay or the empty
  // settle. All are JSON or wiring the agent reads and none is a sentence
  // worth printing, so the receipt says only WHICH happened; and it goes
  // through the same classifier as the rest, so a settle that is not a filed
  // row cannot read as "Filed."
  switch (settle.kind) {
    case "pending":
      return null;
    case "cancelled":
    case "error":
      return (
        <SettleReceipt
          result={result}
          known={EXEC_SETTLES.file_variance_narrative}
        />
      );
    case "refusal":
      return settle.error === "BAD_CODE" ? (
        <Receipt tone="negative">
          That code isn&rsquo;t one this ledger files under — nothing was filed.
        </Receipt>
      ) : (
        <Receipt tone="negative">Nothing was filed: {settle.error}.</Receipt>
      );
    case "success":
      return <Receipt>Filed the variance narrative.</Receipt>;
  }
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

  // ══ BEATS 3a / 3d / 6 — REFRESH AFTER THE BACKEND FILES A NARRATIVE ══════
  //
  // `useRenderTool`, NOT `useFrontendTool`: this registers a renderer for a
  // tool that is executed SOMEWHERE ELSE (the runtime process) without also
  // declaring a frontend tool of that name, which would shadow the backend
  // one. Same mechanism and same reason as banking's `submit_expense_report`
  // renderer (`src/skins/banking/tools.tsx`, whose comment spells out why
  // `useComponent` cannot do this: it hands the render only the parsed args,
  // so `status` and `result` would both be permanently undefined).
  //
  // Registering an exact renderer takes this tool off the shell's wildcard
  // tool-activity chip (`src/shell/chat/tool-activity.tsx`), which is the
  // trade: a durable "Filed the variance narrative." receipt, in the same
  // shape as the pin and publish receipts below, in place of a chip that
  // vanished after two more tool calls. `execToolLabels`' entry stays as the
  // fallback label if this registration is ever removed.
  useRenderTool(
    {
      name: "file_variance_narrative",
      // The renderer validates nothing of the agent's arguments — it reads the
      // tool's `result`. `z.object({}).passthrough()` keeps the registration
      // shape without rejecting the real (fully populated) argument object.
      parameters: z.object({}).passthrough(),
      render: ({ toolCallId, result }) => (
        <NarrativeFiledReceipt
          toolCallId={toolCallId}
          result={result}
          refresh={ledgerRef.current.refresh}
        />
      ),
    },
    [],
  );

  // ══ BEATS 3a / 5 — PIN A RENDERED BLOCK ══════════════════════════════════
  //
  // The agent's own half of the pin. `render_metric_block` (`agent.ts`) creates
  // a DRAFT and hands back its `blockId`; the operator can pin it from the
  // block's own "Add to dashboard" control, and this tool is the agent's route
  // to the same server write (`useExecLedger().addBlock` → POST
  // `/api/exec/v1/dashboards/<id>/blocks`). Without it beat 5's seeded
  // procedure ("pin all three to the CEO dashboard") had no executable step 4
  // and could only ever be narrated.
  //
  // It pins an ALREADY-RENDERED block and cannot conjure one: `addBlock` 404s
  // on an id with no draft behind it, and that refusal is relayed to the agent
  // rather than swallowed, so a hallucinated id fails loudly in the transcript
  // instead of looking like a pin that happened.
  //
  // The refusal is relayed VERBATIM and this arm appends no advice of its own.
  // It used to end every failure with "Render the block first", which is
  // right for `NOT_FOUND` and actively harmful for `ALREADY_PINNED` (a block
  // the other dashboard holds): re-rendering produces a SECOND block instead
  // of unpinning the one that exists. Each code's remedy is written once,
  // beside the throw, in `store.addBlockToDashboard`.
  useFrontendTool(
    {
      name: "pinBlockToDashboard",
      description:
        "Pin a block you ALREADY rendered onto one of the two dashboards. " +
        "Pass the 'blockId' that render_metric_block returned — never an id " +
        "you composed, and never a title. Render the block first; this tool " +
        "pins an existing one, it does not create anything. Idempotent: " +
        "pinning the same block to the same dashboard twice leaves one card. " +
        "A block lives on ONE dashboard — to move it, the operator unpins it " +
        "from the dashboard holding it first; never render a second copy.",
      parameters: z.object({
        blockId: z
          .string()
          .describe(
            "The id render_metric_block returned for the block to pin, " +
              "verbatim.",
          ),
        dashboardId: z
          .enum(["ceo", "cfo"])
          .describe("Which dashboard the block lands on."),
      }),
      handler: async ({ blockId, dashboardId }) => {
        const { addBlock, snapshot } = ledgerRef.current;
        const title = snapshot.dashboards[dashboardId]?.title ?? dashboardId;
        try {
          await addBlock(dashboardId, blockId);
        } catch (err) {
          // Relayed, not swallowed: the agent has to be able to tell a pin
          // that happened from one that did not, or it confirms a dashboard
          // card that is not on screen.
          console.error("[exec] pinBlockToDashboard failed:", err);
          return `${PIN_FAILED_PREFIX}: ${err instanceof Error ? err.message : String(err)}.`;
        }
        return `Pinned to the ${title}.`;
      },
      // Replay-safe: the recorded sentence IS the receipt, and it is
      // CLASSIFIED (`PIN_FAILED_PREFIX`, plus the shared error/abort rules)
      // rather than read off the mere presence of a settle — a failed pin, or
      // a call the runtime settled with an error string, must never read as a
      // pin that happened.
      render: ({ result }) => (
        <SettleReceipt
          result={result}
          known={EXEC_SETTLES.pinBlockToDashboard}
        />
      ),
    },
    [],
  );

  // ══ BEAT 3c — NAVIGATE WITH LEVERS ═══════════════════════════════════════
  //
  // `navigateTo`, deliberately camelCase: it is what EXEC_PROMPT's rule 10
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
      // "Opening…" forever — and it goes through the shared classifier, so a
      // settle the runtime turned into an error string does not read as a
      // page that opened.
      render: ({ result }) => (
        <SettleReceipt result={result} known={EXEC_SETTLES.navigateTo} />
      ),
    },
    [router, skinHref],
  );

  // ══ BEAT 3a — COUNTERSIGN THE PUBLISH, PIN WITHHELD ═════════════════════
  //
  // The agent names nothing but (optionally) which dashboard — the presenter
  // picks the dashboard and types the four-digit countersign PIN inside
  // `PublishCountersignCard` itself, which calls `publishPack` from
  // `useExecLedger()` DIRECTLY. This card is the agent's ONLY publish path:
  // `agent.ts`'s `publish_board_pack` tool of the same write is exported for
  // its gate's unit tests and deliberately NOT registered, so there is no
  // second route the agent could take with a PIN it composed — see that
  // tool's own doc comment and EXEC_PROMPT rule 5. The agent's `respond()`
  // gets either one sentence naming the
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
        // Replay-safe: keyed off `result`, never `status`. FOUR different
        // things settle this call — a publish, the gate's refusal, the
        // presenter's Cancel, and the platform's abort sentinel if the run
        // ends with the card still open — and `core` JSON-stringifies
        // whatever `respond()` was given before any of them lands here
        // (`copilotKitCore.runTool` does this for every tool, human-in-the-
        // -loop included), so `result` is always a plain string and telling
        // the four apart is `classifyToolSettle`'s job. Only the first is a
        // published board pack; anything else reading as one puts a receipt
        // for an unpublished pack on the screen in front of the room.
        if (typeof result === "string") {
          return (
            <SettleReceipt
              result={result}
              known={EXEC_SETTLES.confirmPublishCountersign}
            />
          );
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
                return null;
              }
              if (outcome.error === "BAD_COUNTERSIGN") {
                // NOT settled — a typo is the presenter's to fix, and the
                // agent has nothing to do with it (EXEC_PROMPT rule 5: "the
                // card's business, not a puzzle"). Returning the message
                // keeps the card open so they can retype the four digits.
                return "That countersign PIN wasn't accepted. Nothing was published — try again.";
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
              return null;
            }}
            // The literal `PUBLISH_CANCELLED` — the settle classifier
            // recognises that exact sentence as "nothing happened", so the
            // two must not drift apart into a cancel that renders as a
            // publish.
            onCancel={() => respond?.(PUBLISH_CANCELLED)}
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
  // EXEC_PROMPT rule 7 is this chain's whole trigger condition, spelled out
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
        // Replay-safe, and a HUMAN line rather than `result` — see
        // `OfferSettle`, which owns both that rule and the classification.
        if (typeof result === "string") return <OfferSettle result={result} />;
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
        // Replay-safe, and the count is the one the RECORDER reported — never
        // one re-counted out of this prose, and never asserted at all when
        // there is none. See `DemonstrationSettle`.
        if (typeof result === "string") {
          return <DemonstrationSettle result={result} />;
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
        // CLASSIFIED, never merely detected — see `SaveProcedureSettle` and
        // `classifySaveProcedureResult`'s doc comments.
        if (typeof result === "string") {
          return <SaveProcedureSettle result={result} />;
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
