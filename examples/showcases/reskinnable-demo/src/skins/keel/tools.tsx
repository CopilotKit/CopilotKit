"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  useAgentContext,
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { useKeelDesk } from "@/skins/keel/desk-data";
import { getDoc } from "@/skins/keel/knowledge/corpus";
import { requestSection } from "@/skins/keel/knowledge/citation-target";
import type { Citation } from "@/skins/keel/knowledge/types";
import type { DocumentRecord } from "@/skins/keel/data/types";
import { canonicalRef } from "@/skins/keel/data/bulletin-citations";
import { missingEndorsements } from "@/skins/keel/data/attention";
import {
  REVIEW_FLAG_REASONS,
  OWNER_NOTICE_TEMPLATES,
} from "@/skins/keel/data/handling";
import {
  ATTENTION_ARGUMENTS,
  SORT_ARGUMENTS,
  SPACE_ARGUMENTS,
  normalizeRegisterLevers,
  registerLeverChips,
  registerLeverQuery,
} from "@/skins/keel/data/register-levers";
import {
  OFFER_ACCEPTED,
  OFFER_DECLINED,
  SAVE_PROCEDURE_CONFIRMED,
  SAVE_PROCEDURE_DECLINED,
  classifySaveProcedureResult,
  readDemonstratedStepCount,
  readOfferAccepted,
} from "@/skins/keel/teach-mode-directives";
import { useKeelHref } from "@/skins/keel/href";
import { SourcesCard } from "@/skins/keel/components/sources-card";
import { PlaybookCard } from "@/skins/keel/components/playbook-card";
import { RunPlanPreview } from "@/skins/keel/components/run-plan-preview";
import { ApprovalCard } from "@/skins/keel/components/approval-card";
import { ApprovalsQueueSurface } from "@/skins/keel/components/approvals-queue";
import { RunTimeline } from "@/skins/keel/components/run-timeline";
import { RegisterHealthCard } from "@/skins/keel/components/register-health-card";
import { RegisterSummaryCard } from "@/skins/keel/components/register-summary-card";
import { DemonstrationCard } from "@/skins/keel/components/demonstration-card";
import { SigningPinCard } from "@/skins/keel/components/signing-pin-card";
import { ChatSurface } from "@/skins/keel/components/chat-surface";
import { KeelSandboxDataSync } from "@/skins/keel/sandbox-functions";

/**
 * Every frontend tool, HITL card, gen-UI component and global readable Keel
 * ships. Renders null (bar the OGUI snapshot sync at the end).
 *
 * FOUR RULES RUN THROUGH THIS WHOLE FILE, and every one of them fails SILENTLY.
 *
 *  1. RENDERS ARE REPLAY-SAFE — keyed off the recorded `result`, NEVER off
 *     `status`. On reopening a thread you get the result back with no live
 *     status transition, so a status-keyed terminal branch is perfect during the
 *     demo and renders the pending copy forever the moment anyone revisits —
 *     which is exactly when beat 2 is being shown. `settledText` below is the
 *     one place that check is written.
 *
 *  2. WRITE TOOLS READ THE DESK THROUGH `deskRef`, NEVER THROUGH THE CLOSURE,
 *     and close with `[]` deps. `useFrontendTool` / `useHumanInTheLoop` TEAR
 *     DOWN and re-register whenever their deps change — and this skin's ledger
 *     snapshot is a NEW object every 900 ms while any run is live, so a `[data]`
 *     dep would unregister a tool in the middle of its own call: the write
 *     lands, the tool vanishes, and the agent gets no result. Read-only
 *     `useComponent`s take real deps on purpose: re-registering is how they
 *     repaint as runs advance, and they have no in-flight call to break.
 *
 *  3. NOTHING SENSITIVE GOES INTO A TOOL RESULT. Whatever a handler returns is
 *     stored in the thread forever. Beat 3a's e-signature PIN therefore never
 *     travels through `respond` — see `components/signing-pin-card.tsx`.
 *
 *  4. A CARD NEVER ROUTES AROUND A SERVER GATE. The countersignature card
 *     relays `UNENDORSED_REVISION` verbatim; it does not offer, and must never
 *     grow, a second path to the same write. See the card's header.
 */

/**
 * The recorded outcome of a settled tool call, or `null` while it is still live.
 *
 * ONE place decides what "settled" means, so no render re-implements it and none
 * of them can drift into keying off `status` instead. The parameter is
 * deliberately `unknown`: a tool result is whatever the runtime recorded, and
 * reaching into it as if it were a string is how a replayed card renders
 * `undefined` at the exact moment beat 2 is being demonstrated.
 */
function settledText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A one-line "this happened" receipt. Every settled write gets one. */
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
 * The frame a HITL card shows before it can be drawn — no recorded result AND no
 * `respond`.
 *
 * That state has two causes and one right answer. Live, it is the window while
 * the tool call is still streaming: `args` are half-parsed, so a card drawn from
 * them would flash its own "no such playbook" branch at the operator for a frame
 * or two on every single call. On replay, it is an interrupt that was never
 * answered — the thread was closed on an open card — and "waiting on you" is
 * exactly what happened.
 *
 * It is deliberately NOT keyed off `status`: the discriminator is the ABSENCE of
 * both a result and a responder, which replays correctly. See rule 1 at the top
 * of this file.
 */
function AwaitingCard() {
  return (
    <div className="my-1 rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
      Waiting on you…
    </div>
  );
}

/** ~200 characters of a section body, for a resolved citation snippet. */
function snippetOf(body: string): string {
  return body.length <= 200 ? body : `${body.slice(0, 197).trimEnd()}…`;
}

/**
 * Resolve an agent-supplied (docId, sectionId) pair against the REAL corpus.
 * Returns null when either id is unknown.
 *
 * This is the anti-fabrication guarantee: the agent never supplies the citation
 * text, only the two ids. Everything the user sees — the ref, the heading, the
 * snippet — is read from the corpus on the client. A citation the model invents
 * simply fails to resolve and is dropped, rather than rendering as a
 * plausible-looking fake.
 */
function resolveCitation(docId: string, sectionId: string): Citation | null {
  const doc = getDoc(docId);
  if (!doc) return null;
  const section = doc.sections.find((s) => s.id === sectionId);
  if (!section) return null;
  return {
    docId: doc.id,
    ref: doc.ref,
    sectionId: section.id,
    heading: section.heading,
    snippet: snippetOf(section.body),
  };
}

/**
 * Find a register row from whatever the agent typed — the human-facing ref
 * ("STD-045", "std 045") or the docId ("third-party-risk").
 *
 * The ref is canonicalized because the string arrives from a MODEL that read it
 * off a policy page or a PDF whose headings are shouted, hyphenated
 * inconsistently, or spaced. An exact `===` would call "POL 114" and "POL-114"
 * strangers, and beat 3a would refuse a release for a typographic reason while
 * telling the room the document is not in the register. Mirrors
 * `findDocumentByRef` in `data/store.ts`, using the same shared `canonicalRef`.
 */
function findRecord(
  documents: DocumentRecord[],
  query: string,
): DocumentRecord | undefined {
  const key = canonicalRef(query ?? "");
  if (!key) return undefined;
  return (
    documents.find((doc) => doc.docId === query) ??
    documents.find((doc) => canonicalRef(doc.ref) === key)
  );
}

/**
 * The one POST path every tool in this file writes through.
 *
 * Deliberately NOT routed through `useKeelDesk`'s `write`: the desk exposes the
 * run-engine mutations, and beats 5 and 6 write to document-control routes that
 * are not part of that surface. Keel already establishes this pattern — the
 * e-signature card and `fileImpactBrief` both POST through their own fetch and
 * then call `refresh()` — so a second copy of the ok/reason contract here is the
 * SAME one, in one place, rather than four hand-rolled `fetch` blocks.
 *
 * A refusal's `message` is relayed VERBATIM. The routes write those to be read by
 * a human AND by the agent (the release gate names the body that has not
 * endorsed), and flattening them into one house string costs exactly the
 * information that tells the agent whether to relay, stop, or ask.
 */
async function postToDesk(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; message: string; payload?: unknown }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : `That request was refused (HTTP ${res.status}).`;
      return { ok: false, message };
    }
    return { ok: true, message: "", payload };
  } catch (error) {
    console.error(`[keel] write to ${url} failed:`, error);
    return {
      ok: false,
      message: "The desk could not be reached. Nothing was recorded.",
    };
  }
}

export function KeelTools() {
  const data = useKeelDesk();
  const router = useRouter();
  const keelHref = useKeelHref();
  const { summaryKey, persona } = data;

  /**
   * The desk, read through a ref by every WRITE tool — see rule 2 above. The
   * effect re-syncs after each render commit (never during render), which is the
   * repo's ref convention.
   */
  const deskRef = useRef(data);
  useEffect(() => {
    deskRef.current = data;
  }, [data]);

  /**
   * The instant the register is measured at: the snapshot's OWN `asOf`, never
   * the wall clock — the same decision `pages/knowledge.tsx` documents. Reading
   * `Date.now()` during render would be impure (the app's `react-hooks/purity`
   * rule rejects it) and would give the card in the transcript a different
   * "today" from the page behind it.
   */
  const now = useMemo(() => Date.parse(data.asOf), [data.asOf]);

  const openCitation = useCallback(
    (c: Citation) => {
      // Signal the target BEFORE navigating: a second citation into the same
      // open doc is a hash-only push, which fires no hashchange and remounts
      // nothing, so the reader would otherwise never see it (finding A5).
      requestSection(c.docId, c.sectionId);
      router.push(`${keelHref(`knowledge/${c.docId}`)}#${c.sectionId}`);
    },
    [router, keelHref],
  );

  // ── Agent-context readables ──────────────────────────────────────────────
  // CHURN GUARD (spec §6.5). The ledger poll hands back a NEW snapshot every
  // 900ms while a run is live, but `summaryKey` changes ONLY on a meaningful
  // transition — it is derived from the (runId, status, currentStepId) tuples,
  // never from elapsed time. These readables therefore memoize on `summaryKey`,
  // NOT on `data.runs`. Depending on `runs` directly would rewrite the agent's
  // context on every poll and inflate token cost for no information gain.
  const runSummary = useMemo(
    () =>
      JSON.stringify({
        counts: {
          open: data.kpis.openRuns,
          blocked: data.kpis.blockedRuns,
          completed: data.kpis.completedRuns,
        },
        blocked: data.runs
          .filter((r) => r.status === "blocked")
          .map((r) => {
            const step = r.steps.find((s) => s.status === "awaiting_approval");
            return {
              run_id: r.id,
              title: r.title,
              subject: r.subject,
              blocked_step_id: step?.id,
              blocked_step: step?.title,
              awaiting_role: step?.approverRole,
              policy_ref: step?.policyRef?.ref,
            };
          }),
        running: data.runs
          .filter((r) => r.status === "running")
          .map((r) => ({ run_id: r.id, title: r.title, subject: r.subject })),
      }),
    // summaryKey is the intentional churn guard (see the CHURN GUARD comment
    // above): depending on `data.runs` here would rewrite the agent's context
    // on every poll, so it is deliberately omitted from the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summaryKey, data.kpis],
  );

  /**
   * The register's release board, available on EVERY page.
   *
   * Narrow on purpose. The Policy Register page publishes the full on-screen
   * readable (rows, levers, tiles); this one carries only the scale of the book
   * and the revisions AWAITING RELEASE, because that is what an operator asks
   * for from anywhere ("release the STD-045 revision") and beat 3a would
   * otherwise be answerable only while standing on one page.
   *
   * `missing_endorsements` is the SYMPTOM the release gate is allowed to state —
   * which body has not signed. It says nothing about a variance, a code or a
   * catalogue, and it must never learn to: that vocabulary is withheld from the
   * agent on purpose, and a readable is one of the five channels it could leak
   * through.
   *
   * No semicolons in the description — the repo's readable omission guards
   * anchor on a `useAgentContext(` window terminated by the statement's own
   * semicolon.
   */
  const registerSummary = useMemo(
    () =>
      JSON.stringify({
        as_of: data.asOf || null,
        documents: data.documents.length,
        awaiting_release: data.documents
          .filter((record) => record.pendingRevision)
          .map((record) => ({
            ref: record.ref,
            doc_id: record.docId,
            title: record.title,
            owner: record.owner,
            revision: record.pendingRevision?.label,
            stage: record.pendingRevision?.stage,
            missing_endorsements: missingEndorsements(record),
          })),
        impact_briefs_filed: data.impactBriefs.length,
      }),
    [data.asOf, data.documents, data.impactBriefs.length],
  );

  useAgentContext({
    description:
      "The signed-in staff member at Harbor Point Health: their name, role, and unit. A run's approval gate is actionable only when the gate's approver role matches this role.",
    value: JSON.stringify(persona),
  });

  useAgentContext({
    description:
      "Live operations state: counts of open/blocked/completed runs, every blocked run with the step it is waiting on and the policy that requires the gate, and every currently running run.",
    value: runSummary,
  });

  useAgentContext({
    description:
      "The policy register's release board, wherever the operator is standing — how many documents the register holds, and every revision awaiting release with the bodies that have not endorsed it. An empty missing_endorsements list means that revision is fully endorsed and ready to be countersigned.",
    value: registerSummary,
  });

  useAgentContext({
    description:
      "The approval gates awaiting THIS user right now. If this is empty, nothing needs their approval.",
    value: JSON.stringify(
      data.approvalsForMe.map((a) => ({
        run_id: a.run.id,
        step_id: a.step.id,
        step: a.step.title,
        subject: a.run.subject,
        policy_ref: a.step.policyRef?.ref,
      })),
    ),
  });

  useAgentContext({
    description:
      "The catalog of automatable processes (playbooks) that can be started, with their steps and approval gates.",
    value: JSON.stringify(
      data.playbooks.map((p) => ({
        id: p.id,
        title: p.title,
        summary: p.summary,
        steps: p.steps.length,
        gates: p.steps.filter((s) => s.requiresApproval).length,
      })),
    ),
  });

  // ══ BEAT 1 — THE FACE: policy-library health, as a card ══════════════════
  //
  // A `useComponent` rather than a `useFrontendTool` render, because durable
  // visuals replay from thread history (beat 2). It takes NO figures: the card
  // re-derives every one from the live register through the same functions the
  // Register page uses, so the transcript and the page can never disagree.
  useComponent(
    {
      name: "showRegisterHealth",
      description:
        "Render the policy library's health as a card: documents in force, " +
        "how many are past their review date, attestation coverage, revisions " +
        "awaiting release, and a per-space breakdown. Call this for 'how " +
        "healthy is the library', 'how are we doing on policy', a register " +
        "overview, or any question about review debt or attestation coverage " +
        "across the book. You pass NO numbers — the app reads every figure from " +
        "the register itself. Do NOT restate the figures in prose afterwards.",
      parameters: z.object({
        note: z
          .string()
          .optional()
          .describe(
            "One short sentence of your own framing, e.g. which group deserves " +
              "attention first. Prose only — never a figure, never a percentage.",
          ),
      }),
      // useComponent renders receive the parsed tool args directly as props.
      render: ({ note }) => (
        <RegisterHealthCard records={data.documents} now={now} note={note} />
      ),
    },
    [data.documents, now],
  );

  // ── Knowledge: cite, and navigate to the cited section ───────────────────
  useComponent(
    {
      name: "showSources",
      description:
        "Render the policy sources that support the answer you just wrote. " +
        "Pass ONLY the docId and sectionId of passages that came back from " +
        "search_knowledge — never invent one, and never pass quoted text. The " +
        "app resolves the reference, heading and excerpt from the real policy " +
        "library itself. Call this after every grounded policy answer.",
      parameters: z.object({
        citations: z
          .array(
            z.object({
              docId: z.string().describe('e.g. "phi-access-policy"'),
              sectionId: z.string().describe('e.g. "minimum-necessary"'),
            }),
          )
          .describe(
            "The passages you actually used, in the order you used them.",
          ),
      }),
      // useComponent renders receive the parsed tool args directly as props
      // (not wrapped in `{ args }` — that shape is for useFrontendTool /
      // useHumanInTheLoop). During streaming the parse is partial, so `citations`
      // may still be undefined; default it.
      render: ({ citations }) => {
        const resolved = (citations ?? [])
          .map((c) => resolveCitation(c.docId, c.sectionId))
          .filter((c): c is Citation => c !== null);

        if (resolved.length === 0) {
          return (
            <div className="rounded-md border border-dashed border-hairline p-3 text-sm text-ink-muted">
              No matching policy sections in the library.
            </div>
          );
        }
        return <SourcesCard citations={resolved} onOpen={openCitation} />;
      },
    },
    [openCitation],
  );

  useFrontendTool(
    {
      name: "openDocument",
      description:
        "Open a policy document in the Register, optionally scrolled to a " +
        "specific section. Use when the user asks to see or read a policy.",
      parameters: z.object({
        docId: z.string(),
        sectionId: z.string().optional(),
      }),
      handler: async ({ docId, sectionId }) => {
        const doc = getDoc(docId);
        if (!doc) return `No document is filed under "${docId}".`;
        // Same signal as openCitation, so re-opening a section of the doc that
        // is already on screen still scrolls + highlights (finding A5).
        if (sectionId) requestSection(docId, sectionId);
        router.push(
          `${keelHref(`knowledge/${docId}`)}${sectionId ? `#${sectionId}` : ""}`,
        );
        return `Opened ${doc.ref} — ${doc.title}.`;
      },
      // Replay-safe: the recorded sentence IS the receipt. Nothing reads status,
      // so a reopened thread shows what happened rather than "Opening…" forever.
      render: ({ result }) => {
        const text = settledText(result);
        if (!text) return null;
        return (
          <Receipt tone={text.startsWith("Opened") ? "positive" : "negative"}>
            {text}
          </Receipt>
        );
      },
    },
    [router, keelHref],
  );

  // ── Process: preview a playbook, then start a run behind a HITL gate ──────
  useComponent(
    {
      name: "showPlaybook",
      description:
        "Show what a playbook will do — its steps, who performs each, which " +
        "steps need approval, and the policy behind each. ALWAYS call this " +
        "before startRun so the user sees the plan before anything begins.",
      parameters: z.object({ playbookId: z.string() }),
      // useComponent render props are the parsed args themselves.
      render: ({ playbookId }) => {
        const playbook = playbookId ? data.getPlaybook(playbookId) : undefined;
        if (!playbook) {
          return (
            <div className="rounded-md border border-dashed border-hairline p-3 text-sm text-ink-muted">
              No playbook is registered under that id.
            </div>
          );
        }
        return <PlaybookCard playbook={playbook} />;
      },
    },
    [data.getPlaybook],
  );

  useHumanInTheLoop(
    {
      name: "startRun",
      description:
        "Start a process run from a playbook. The user confirms in the UI " +
        "before anything is created — do NOT assume the run started until this " +
        "tool returns confirmation. Always show the playbook first.",
      parameters: z.object({
        playbookId: z.string(),
        subject: z
          .string()
          .describe(
            'Who or what the run is about, e.g. "Priya Raman — Radiology contractor".',
          ),
        values: z
          .record(z.string())
          .optional()
          .describe("Optional playbook inputs, keyed by the input key."),
      }),
      render: ({ args, result, respond }) => {
        const text = settledText(result);
        if (text) {
          return (
            <Receipt
              tone={text.startsWith("Started ") ? "positive" : "negative"}
            >
              {text}
            </Receipt>
          );
        }
        // Streaming, or a replayed interrupt nobody answered — see AwaitingCard.
        if (!respond) return <AwaitingCard />;

        const playbook = args?.playbookId
          ? deskRef.current.getPlaybook(args.playbookId)
          : undefined;

        if (!playbook) {
          return (
            <ChatSurface className="rounded-md border border-hairline bg-surface p-3 text-sm text-negative">
              No playbook is registered under &quot;{args?.playbookId}&quot;.
              <button
                className="ml-2 underline"
                onClick={() =>
                  void respond?.("That playbook id does not exist.")
                }
              >
                Dismiss
              </button>
            </ChatSurface>
          );
        }
        return (
          <RunPlanPreview
            playbook={playbook}
            subject={args?.subject ?? ""}
            onConfirm={() => {
              // Awaited through `.then`: the run is created by a POST and the
              // ledger is re-read before anything is claimed. Reporting a start
              // before the write settled is how the agent ends up narrating a
              // run id the register never issued.
              void deskRef.current
                .startRun(playbook.id, {
                  subject: args?.subject ?? "",
                  values: args?.values,
                })
                .then((outcome) =>
                  respond?.(
                    outcome.ok && outcome.run
                      ? `Started ${outcome.run.id} — ${outcome.run.title} for ${outcome.run.subject}.` +
                          (outcome.reason ? ` ${outcome.reason}` : "")
                      : (outcome.reason ?? "The run could not be started."),
                  ),
                );
            }}
            onCancel={() =>
              void respond?.("The user declined to start this run.")
            }
          />
        );
      },
    },
    [],
  );

  // ── Process: inspect a run, approve a gate, review the queue ──────────────
  useComponent(
    {
      name: "showRun",
      description:
        "Show a run's live step timeline in the chat. Use when the user asks " +
        "about the status or progress of a specific run.",
      parameters: z.object({ runId: z.string() }),
      // useComponent render props are the parsed args themselves.
      render: ({ runId }) => {
        const run = runId ? data.getRun(runId) : undefined;
        if (!run) {
          return (
            <div className="rounded-md border border-dashed border-hairline p-3 text-sm text-ink-muted">
              No run is filed under that id.
            </div>
          );
        }
        return (
          // `RunTimeline` is context-agnostic (also used by the run-detail
          // PAGE, where pointer events are normal), so the pointer-events fix
          // belongs on THIS chat wrapper, not inside the timeline. Rooting it in
          // `ChatSurface` re-enables the timeline's per-step policy `<Link>`,
          // which is otherwise dead under the `useComponent` `pointer-events:
          // none`.
          <ChatSurface className="rounded-md border border-hairline bg-surface p-3">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="font-mono text-xs font-semibold text-brand">
                {run.id}
              </span>
              <span className="text-sm font-semibold text-ink">
                {run.title}
              </span>
            </div>
            <RunTimeline run={run} compact />
          </ChatSurface>
        );
      },
    },
    // Depends on `runs` (not summaryKey): the whole point of this card is to
    // re-render as the server-settled runs advance under the ledger poll.
    [data.runs, data.getRun],
  );

  useHumanInTheLoop(
    {
      name: "approveStep",
      description:
        "Ask the user to approve (or reject) a run's approval gate. The card " +
        "shows the policy that requires the gate. Only the role named as the " +
        "gate's approver can act; if the current user is not that role, say who " +
        "it is waiting on instead of calling this.",
      parameters: z.object({ runId: z.string(), stepId: z.string() }),
      render: ({ args, result, respond }) => {
        const text = settledText(result);
        if (text) {
          return (
            <Receipt
              tone={
                /^(Approved|Rejected) /.test(text) ? "positive" : "negative"
              }
            >
              {text}
            </Receipt>
          );
        }
        if (!respond) return <AwaitingCard />;

        const desk = deskRef.current;
        const run = args?.runId ? desk.getRun(args.runId) : undefined;
        const step = run?.steps.find((s) => s.id === args?.stepId);

        if (!run || !step) {
          return (
            <ChatSurface className="rounded-md border border-hairline bg-surface p-3 text-sm text-negative">
              That step is no longer available.
              <button
                className="ml-2 underline"
                onClick={() =>
                  void respond?.("That run or step no longer exists.")
                }
              >
                Dismiss
              </button>
            </ChatSurface>
          );
        }

        return (
          <ApprovalCard
            run={run}
            step={step}
            actionable={step.approverRole === desk.persona.role}
            onApprove={(note) => {
              void deskRef.current
                .approveStep(run.id, step.id, note)
                .then((outcome) =>
                  respond?.(
                    outcome.ok
                      ? `Approved ${step.title} on ${run.id}.` +
                          (outcome.reason ? ` ${outcome.reason}` : "")
                      : // The stale-gate race (spec §12): the server settles
                        // elapsed time on every read, so the run may have moved
                        // past this gate between the proposal and the click.
                        (outcome.reason ??
                          "That approval could not be recorded."),
                  ),
                );
            }}
            onReject={(note) => {
              void deskRef.current
                .rejectStep(run.id, step.id, note)
                .then((outcome) =>
                  respond?.(
                    outcome.ok
                      ? `Rejected ${step.title} on ${run.id}; the run was cancelled.` +
                          (outcome.reason ? ` ${outcome.reason}` : "")
                      : (outcome.reason ??
                          "That rejection could not be recorded."),
                  ),
                );
            }}
          />
        );
      },
    },
    [],
  );

  useComponent(
    {
      name: "showApprovals",
      description:
        "Show the approval queue. Call when the user asks what is waiting on " +
        "them, what needs approval, or to review the queue — do NOT list " +
        "approvals in prose.",
      parameters: z.object({}),
      render: () => {
        if (data.approvals.length === 0) {
          return (
            <div className="rounded-md border border-dashed border-hairline p-3 text-sm text-ink-muted">
              Nothing is awaiting approval.
            </div>
          );
        }
        return (
          <ApprovalsQueueSurface
            items={data.approvals}
            approve={data.approveStep}
          />
        );
      },
    },
    [data.approvals, data.approveStep],
  );

  // ══ BEAT 3a — DRIVE THE APP, SECRET WITHHELD ═════════════════════════════
  //
  // The agent names the DOCUMENT and nothing else. The card reads that record's
  // OWN pending revision out of the ledger, takes the operator's six-digit
  // e-signature PIN, and POSTs it straight to `/countersignatures`. The agent's
  // `respond()` gets one sentence and never the digits.
  //
  // ⚠️ There is deliberately NO `revision` parameter. If the caller could choose
  // which revision to release, the agent could choose an unendorsed one — and we
  // would be asking a second factor to do the release gate's job, which is
  // exactly the authority-override failure `failure-modes.md` § 12 names. The
  // route re-runs `checkReleaseAuthority()` regardless, so this is defence in
  // depth rather than the only guard.
  useHumanInTheLoop(
    {
      name: "countersignRelease",
      description:
        "Open the e-signature card so the operator can countersign the release " +
        "of a document's pending revision to the workforce. Call this when the " +
        "user asks to release, publish, or issue a revision. You name ONLY the " +
        "document — the card reads which revision is waiting, and you never ask " +
        "for, receive, or repeat the PIN. If the release is refused, relay the " +
        "refusal exactly as given and do not look for another way to release it.",
      parameters: z.object({
        document: z
          .string()
          .describe(
            'The document\'s register reference (e.g. "STD-045") or its docId.',
          ),
      }),
      render: ({ args, result, respond }) => {
        const text = settledText(result);
        if (text) {
          // CLASSIFIED, not merely detected. A refusal and a cancellation are
          // settled results too, and rendering the success receipt for every
          // settled call would replay a release that never happened — worse than
          // a blank card, and only visible when someone reopens the thread.
          const released = /is released\./.test(text);
          return (
            <Receipt tone={released ? "positive" : "negative"}>{text}</Receipt>
          );
        }
        if (!respond) return <AwaitingCard />;

        const desk = deskRef.current;
        const record = findRecord(desk.documents, args?.document ?? "");

        if (!record) {
          return (
            <ChatSurface className="rounded-md border border-hairline bg-surface p-3 text-sm text-negative">
              &quot;{args?.document}&quot; is not in the policy register.
              <button
                className="ml-2 underline"
                onClick={() =>
                  void respond?.(
                    `"${args?.document}" is not in the policy register.`,
                  )
                }
              >
                Dismiss
              </button>
            </ChatSurface>
          );
        }
        if (!record.pendingRevision) {
          return (
            <ChatSurface className="rounded-md border border-hairline bg-surface p-3 text-sm text-ink-muted">
              {record.ref} has no revision awaiting release.
              <button
                className="ml-2 underline"
                onClick={() =>
                  void respond?.(
                    `${record.ref} has no revision awaiting release.`,
                  )
                }
              >
                Dismiss
              </button>
            </ChatSurface>
          );
        }

        return (
          <SigningPinCard
            documentRef={record.ref}
            revisionLabel={record.pendingRevision.label}
            personaId={desk.persona.id}
            onSigned={(message) => {
              // Re-read so the register behind the chat stops showing the
              // revision as awaiting release. The card POSTs through its own
              // fetch, so nothing in the ledger module can notice that write.
              void deskRef.current.refresh();
              void respond?.(message);
            }}
            onDeclined={() =>
              void respond?.(
                "The operator cancelled the countersignature. Nothing was released.",
              )
            }
          />
        );
      },
    },
    [],
  );

  // ══ BEAT 3d — the DURABLE artifact from an ingested bulletin ═════════════
  //
  // The ingest half is the paperclip + pill in `skin.tsx` (`attach-bulletin.ts`).
  // This is the half that turns the reading into a record the application owns:
  // `POST /briefs` files it, and the server SETTLES `currentRevision` against
  // the live register in both directions — overwritten on a ref match, DROPPED
  // when the register carries no such ref. The response's `settled`/`unmatched`
  // lists come back to the agent so it can SAY what the library does not carry
  // rather than being silently overruled. `render_impact_brief` (a SERVER tool,
  // in agent.ts) then puts the filed record on the canvas by id.
  useFrontendTool(
    {
      name: "fileImpactBrief",
      description:
        "File a durable Impact Brief from a regulatory bulletin the user " +
        "attached. Call this after reading the attachment — the brief belongs " +
        "to the application and outlives this conversation. Take `source`, " +
        "`effective`, `summary`, the cited policy refs and their required " +
        "actions FROM THE DOCUMENT; never invent a citation and never guess a " +
        "revision number — the app fills the current revision in from the " +
        "register and tells you which refs it could not match. Returns the " +
        "brief's id; pass it to render_impact_brief to put it on the canvas.",
      parameters: z.object({
        source: z
          .string()
          .describe("The issuing body, exactly as the document names it."),
        space: z
          .enum(["privacy", "clinical", "vendor"])
          .describe("The corpus space the bulletin covers."),
        effective: z
          .string()
          .describe("The effective date the document states, verbatim."),
        summary: z.string().describe("Two or three sentences, no more."),
        citations: z
          .array(
            z.object({
              ref: z
                .string()
                .describe(
                  'The policy reference the bulletin names, e.g. "POL-114".',
                ),
              title: z.string().describe("The document title as you read it."),
              requiredAction: z
                .string()
                .describe("What the bulletin requires be done to that policy."),
            }),
          )
          .describe(
            "One entry per policy the bulletin touches. Do NOT include a " +
              "revision number — the register owns that fact.",
          ),
        impacts: z
          .array(z.string())
          .max(3)
          .optional()
          .describe("At most three short consequences for the desk."),
      }),
      handler: async (input) => {
        const desk = deskRef.current;
        try {
          const res = await fetch("/api/keel/v1/briefs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...input, personaId: desk.persona.id }),
          });
          const body = await res.json().catch(() => null);
          if (!res.ok) {
            return `REFUSED: ${body?.message ?? `the brief could not be filed (HTTP ${res.status}).`}`;
          }
          await deskRef.current.refresh();
          const brief = body?.brief as { id?: string } | undefined;
          const unmatched: string[] = body?.unmatched ?? [];
          return (
            `Filed impact brief ${brief?.id ?? ""} on the Register.` +
            (unmatched.length
              ? ` The register carries no document under ${unmatched.join(", ")} — say so rather than assuming it does.`
              : "")
          );
        } catch (error) {
          console.error("[keel] filing the impact brief failed:", error);
          return "REFUSED: the desk could not be reached. Nothing was filed.";
        }
      },
      render: ({ result }) => {
        const text = settledText(result);
        if (!text) return null;
        const refused = text.startsWith("REFUSED");
        return (
          <Receipt tone={refused ? "negative" : "positive"}>
            {text.replace(/^REFUSED:\s*/, "")}
          </Receipt>
        );
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "navigateTo",
      description:
        "Navigate the app to one of Keel's pages. Use when the user asks to go " +
        "to, open, or show a section of the app. `knowledge` is the Policy " +
        "Register.",
      parameters: z.object({
        page: z.enum(["desk", "knowledge", "playbooks", "runs"]),
      }),
      handler: async ({ page }) => {
        router.push(page === "desk" ? keelHref() : keelHref(page));
        return `Opened ${page === "knowledge" ? "the Register" : page}.`;
      },
      render: ({ result }) => {
        const text = settledText(result);
        return text ? <Receipt>{text}</Receipt> : null;
      },
    },
    [router, keelHref],
  );

  // ══ BEAT 3c — THE FOUR LEVERS, AS A MANEUVER ═════════════════════════════
  //
  // A plain `navigateTo` does not earn this beat. The room has to see the levers
  // NAMED before anything moves, and TINTED on the Register afterwards, so the
  // claim "it reached the app's real controls" is something they can check rather
  // than take on faith. Four rather than one, deliberately: a single filter looks
  // like a link with extra steps.
  //
  // Every advertised value comes from `data/register-levers.ts` — the page's OWN
  // control vocabulary — so this tool cannot offer a value the Register has no
  // control for.
  //
  // ⚠️ EVERY LEVER IS REQUIRED, each carrying an explicit "not pulled" member
  // ("all", or 0 for the limit — `ANY_LEVER` in `data/register-levers.ts`),
  // rather than `.optional()`. Measured in logistics, which
  // needed a fix commit for exactly this: told in as many words to leave the
  // filters alone, gpt-5.4 still filled the optional enums and put an EMPTY board
  // on screen under four confidently tinted controls. A model facing an optional
  // enum fills it anyway, because omission is not a choice it can STATE. The
  // sentinels are that way of saying it, and `normalizeRegisterLevers` drops them
  // to `null` downstream — no chip, no query param, no extra branch.
  useHumanInTheLoop(
    {
      name: "showRegister",
      description:
        "Take the operator to the Policy Register with a knowledge space, an " +
        "attention class, a sort order and a top-N limit applied. Confirm with " +
        "them first — the card lists the levers before anything moves. Use this " +
        "for any 'what is overdue for review', 'which policies need attention', " +
        "'show me the register' or 'lowest attestation first' request. EVERY " +
        "lever is REQUIRED: set the ones the request implies, and pass 'all' (or " +
        "0 for the limit) for the ones it does not — that is how you say 'leave " +
        "this lever alone', and it is the only way to say it. Never omit a lever, " +
        "and never fill one merely because the schema offers it: a lever the " +
        "operator did not ask for narrows the board for no reason and claims a " +
        "choice they never made. The register holds nine documents across three " +
        "spaces, so setting `space` narrows it hard. Whatever you set, say " +
        "afterwards how many rows the board is showing out of how many match.",
      parameters: z.object({
        space: z
          .enum(SPACE_ARGUMENTS)
          .describe(
            "Restrict to one knowledge space, or 'all' for every space. Use 'all' unless the operator named a space.",
          ),
        attention: z
          .enum(ATTENTION_ARGUMENTS)
          .describe(
            "Restrict to one attention class, or 'all' for any. Use 'all' unless the operator named a concern.",
          ),
        sort: z
          .enum(SORT_ARGUMENTS)
          .describe("Row order, or 'all' to keep the register's own order."),
        top: z
          .number()
          .int()
          .min(0)
          .describe("Limit to the first N rows. Use 0 for no limit."),
      }),
      render: ({ args, result, respond }) => {
        const text = settledText(result);
        if (text) {
          return (
            <Receipt tone={text.startsWith("Opened") ? "positive" : "negative"}>
              {text}
            </Receipt>
          );
        }
        if (!respond) return <AwaitingCard />;

        // Normalized from ONE record — the same one the URL below is built from,
        // so the view this opens is the view the card just promised. Arguments
        // STREAM, so mid-render a lever that has not arrived yet is simply unset
        // and draws NO chip; a `?? "all"` default would assert a choice the agent
        // never made and then flip when the real value landed.
        const levers = normalizeRegisterLevers(args ?? {});
        const chips = registerLeverChips(levers);
        return (
          <ChatSurface className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
            <div className="text-sm text-ink">
              {chips.length
                ? "Open the Register with these controls set?"
                : "Open the Register?"}
            </div>
            {chips.length ? (
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span
                    key={c.label}
                    className="rounded-md bg-brand-soft px-2 py-1 text-xs font-medium text-brand-indigo dark:text-brand-violet"
                  >
                    {c.label}: {c.value}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                onClick={() => {
                  const query = registerLeverQuery(levers);
                  // Through `keelHref`, never a literal `/keel/knowledge` —
                  // under LOCK_SKIN this deploy is served at `/`. `pnpm lint`
                  // enforces it.
                  let navigated = true;
                  try {
                    router.push(
                      `${keelHref("knowledge")}${query ? `?${query}` : ""}`,
                    );
                  } catch (error) {
                    navigated = false;
                    console.error("[keel] could not open the Register", error);
                  }
                  // Respond either way: a throw that escaped this handler would
                  // leave the interrupt unsettled and WEDGE the run, which is the
                  // one outcome worse than not navigating.
                  void respond?.(
                    navigated
                      ? `Opened the Register${
                          chips.length
                            ? ` with ${chips
                                .map(
                                  (c) =>
                                    `${c.label.toLowerCase()} ${c.value.toLowerCase()}`,
                                )
                                .join(", ")}`
                            : ""
                        }. The controls are highlighted on screen.`
                      : "The Register could not be opened — the navigation failed, so the operator is still where they were.",
                  );
                }}
              >
                Apply and go
              </button>
              <button
                type="button"
                className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                onClick={() =>
                  void respond?.("The operator declined the navigation.")
                }
              >
                Not now
              </button>
            </div>
          </ChatSurface>
        );
      },
    },
    [router, keelHref],
  );

  // ══ BEAT 4 — MEMORY RECALL, WITH A VISIBLE "WHY" ═════════════════════════
  //
  // A `useComponent`, so it replays from thread history (beat 2) and re-derives
  // every figure from the live register through `summarizeRegister` — the same
  // function the beat-1 card uses.
  //
  // ⚠️ THE `note` PARAMETER IS THE BEAT. A grouped, overdue-first list is not
  // evidence of recall: a model with no memory at all could produce one, so
  // without the agent NAMING the preference it recalled, the room sees an
  // ordinary answer and the beat is invisible. Banking's `note` is the pattern.
  // The prompt (rule 10) requires `recall_memory` BEFORE this call and requires
  // the recalled preference to be put here in the agent's own words.
  useComponent(
    {
      name: "showRegisterSummary",
      description:
        "Summarize the policy library as a card, grouped by knowledge space " +
        "with the documents past their review date leading each group. Call " +
        "this for 'summarize the library', 'how does the register look', 'walk " +
        "me through the policies', or any request for an overview of the book. " +
        "You pass NO figures — the app reads every one from the register, so do " +
        "NOT restate them in prose afterwards. You MUST pass `note`: the saved " +
        "reading preference you recalled and applied, in your own words.",
      parameters: z.object({
        note: z
          .string()
          .describe(
            "The saved reading preference you recalled and applied, in your own " +
              "words — for example 'You read the register by space, with " +
              "anything past its review date first'. Prose only, never a figure " +
              "and never a percentage. If recall_memory returned nothing, say " +
              "that plainly here instead of inventing a preference.",
          ),
      }),
      // useComponent renders receive the parsed tool args directly as props.
      render: ({ note }) => (
        <RegisterSummaryCard records={data.documents} now={now} note={note} />
      ),
    },
    [data.documents, now],
  );

  // ══ BEAT 5 — THE STORED PROCEDURE: three ordered writes on ONE record ════
  //
  // "POL-121 is out of date — handle it" recalls a seeded operational memory and
  // runs `raiseReviewFlag` → `sendOwnerNotice` → `addDocumentNote`, in order,
  // immediately, with NO confirmation.
  //
  // ⚠️ ALL THREE ARE `useFrontendTool`, NOT `useHumanInTheLoop`, and that is a
  // beat requirement rather than a convenience. Banking's equivalent once opened a
  // confirmation card mid-procedure; a presenter moved on without answering it,
  // that tool call sat unresolved, and the NEXT message failed the whole thread
  // with "Tool result is missing for tool call ...". A procedure with no
  // half-finished state cannot leave one behind.
  //
  // ⚠️ THESE VOCABULARIES ARE THE OPPOSITE OF BEAT 6's. `REVIEW_FLAG_REASONS` and
  // `OWNER_NOTICE_TEMPLATES` are closed AND GIVEN to the agent, enumerated on the
  // schemas, because the whole claim of beat 5 is that it ALREADY KNOWS the
  // procedure — there is nothing to discover, so a value outside the set is a
  // model error worth naming. `data/handling.ts` says so out loud, and its
  // identifiers deliberately end `_REASONS`/`_TEMPLATES` so eslint's
  // `withheldGateVocabulary` selector (`/_(CODE_LABELS|CODES)$/`) does not match
  // them. Beat 6's catalogue lives one directory over and is never imported here.
  useFrontendTool(
    {
      name: "raiseReviewFlag",
      description:
        "Put a document on the desk's review list with a reason. Step 1 of " +
        "handling a document that is out of date. Names the document by its " +
        'register reference (e.g. "POL-121") or its docId.',
      parameters: z.object({
        document: z
          .string()
          .describe('The register reference (e.g. "POL-121") or the docId.'),
        reason: z
          .enum(REVIEW_FLAG_REASONS)
          .describe("Why it is on the review list."),
      }),
      handler: async ({ document, reason }) => {
        const desk = deskRef.current;
        const record = findRecord(desk.documents, document ?? "");
        if (!record)
          return `REFUSED: "${document}" is not in the policy register.`;
        const outcome = await postToDesk(
          `/api/keel/v1/documents/${encodeURIComponent(record.docId)}/flag`,
          { reason, personaId: desk.persona.id },
        );
        if (!outcome.ok) return `REFUSED: ${outcome.message}`;
        await deskRef.current.refresh();
        return `Raised a ${reason} review flag on ${record.ref}.`;
      },
      render: ({ result }) => {
        const text = settledText(result);
        if (!text) return null;
        const refused = text.startsWith("REFUSED");
        return (
          <Receipt tone={refused ? "negative" : "positive"}>
            {text.replace(/^REFUSED:\s*/, "")}
          </Receipt>
        );
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "sendOwnerNotice",
      description:
        "Send the document's owning department a templated notice. Step 2 of " +
        "handling a document that is out of date.",
      parameters: z.object({
        document: z
          .string()
          .describe('The register reference (e.g. "POL-121") or the docId.'),
        template: z
          .enum(OWNER_NOTICE_TEMPLATES)
          .describe("Which notice the owning department receives."),
      }),
      handler: async ({ document, template }) => {
        const desk = deskRef.current;
        const record = findRecord(desk.documents, document ?? "");
        if (!record)
          return `REFUSED: "${document}" is not in the policy register.`;
        const outcome = await postToDesk(
          `/api/keel/v1/documents/${encodeURIComponent(record.docId)}/notices`,
          { template, personaId: desk.persona.id },
        );
        if (!outcome.ok) return `REFUSED: ${outcome.message}`;
        await deskRef.current.refresh();
        return `Sent ${record.owner} the ${template} notice for ${record.ref}.`;
      },
      render: ({ result }) => {
        const text = settledText(result);
        if (!text) return null;
        const refused = text.startsWith("REFUSED");
        return (
          <Receipt tone={refused ? "negative" : "positive"}>
            {text.replace(/^REFUSED:\s*/, "")}
          </Receipt>
        );
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "addDocumentNote",
      description:
        "Post a short note on a document's register record. Step 3 of handling " +
        "a document that is out of date. One line — what was flagged and why. " +
        "The register adds its own attention marker, so do not add one yourself.",
      parameters: z.object({
        document: z
          .string()
          .describe('The register reference (e.g. "POL-121") or the docId.'),
        text: z.string().describe("One short line for the record."),
      }),
      handler: async ({ document, text }) => {
        const desk = deskRef.current;
        const record = findRecord(desk.documents, document ?? "");
        if (!record)
          return `REFUSED: "${document}" is not in the policy register.`;
        const outcome = await postToDesk(
          `/api/keel/v1/documents/${encodeURIComponent(record.docId)}/notes`,
          { text, personaId: desk.persona.id },
        );
        if (!outcome.ok) return `REFUSED: ${outcome.message}`;
        await deskRef.current.refresh();
        return `Posted a note on ${record.ref}.`;
      },
      render: ({ result }) => {
        const text = settledText(result);
        if (!text) return null;
        const refused = text.startsWith("REFUSED");
        return (
          <Receipt tone={refused ? "negative" : "positive"}>
            {text.replace(/^REFUSED:\s*/, "")}
          </Receipt>
        );
      },
    },
    [],
  );

  // ══ BEAT 6 — TEACH IT A PROCEDURE IT DOES NOT HAVE ═══════════════════════
  //
  // The chain, in order: offerWorkflowRecording → awaitDemonstration →
  // saveLearnedProcedure. All three are `followUp: true`, so the agent advances to
  // the next card as soon as one settles rather than stopping to narrate.
  //
  // The REPLAY chain is not new: once the procedure is saved, a request on a
  // DIFFERENT document goes through the tools that already exist —
  // `fileReleaseVariance` (files AND ratifies in one call) then
  // `countersignRelease`, the very write that was refused. Nothing is
  // special-cased for the replay, which is the point: the agent applies ordinary
  // tools in an order it was never told, on POL-208 Rev C rather than the POL-114
  // Rev D it was taught on.
  //
  // ⚠️ FIVE LEAK CHANNELS, AND CLOSING FOUR IS CLOSING NONE
  // (`.claude/skills/reskin/failure-modes.md` § 10). There is no variance-code
  // readable in this file, no `z.enum` on any code parameter, no code named in any
  // description here, none in the prompt, and none in the 422 body. This INVERTS
  // the enumerate-every-closed-set rule the beat-5 tools above follow, because for
  // a GATE, reaching the model IS the defect. `fileReleaseVariance`'s `code` is a
  // free `z.string()` whose `.describe()` states the withholding out loud.
  // `tools-replay-safety.test.ts` and `agent.test.ts` both assert the absence;
  // eslint's `withheldGateVocabulary` covers the IMPORT, and prose is a
  // hand-review item no rule can see.
  //
  // ⚠️ RUNTIME-CONDITIONAL, IN ONE HALF ONLY. Gate → decline → demonstrate →
  // summarize works on the plain OSS SSE path: every tool below is an ordinary
  // frontend tool and the REST gate is real. What needs Intelligence is the
  // DURABLE half — `recall_memory` and `save_memory` attach only when the
  // Intelligence runtime is configured. Without it the save card still renders and
  // still settles; the agent simply has no `save_memory` to call, so it reports
  // that it has the procedure for this conversation and nothing crosses to a fresh
  // thread. That degrades to "learned for now", not to an error.
  useFrontendTool(
    {
      name: "fileReleaseVariance",
      description:
        "File and ratify a coded variance against a document's pending " +
        "revision, so the register records an authorization to release it ahead " +
        "of an endorsement it is waiting on. YOU DO NOT KNOW THE CODES: the " +
        "catalogue is the operator's, is deliberately not published to you, and " +
        "only some of it authorizes anything. Call this ONLY with a code a saved " +
        "procedure or the operator gave you, VERBATIM. Never invent one, never " +
        "guess, and never file one to see what happens — a code that does not " +
        "authorize is recorded on the register and lifts nothing. If you have no " +
        "code, call offerWorkflowRecording instead of calling this.",
      parameters: z.object({
        document: z
          .string()
          .describe('The register reference (e.g. "POL-208") or the docId.'),
        code: z
          .string()
          .describe(
            "The exact code, copied verbatim from a saved procedure or from " +
              "what the operator told you. The valid codes are WITHHELD from " +
              "you on purpose — you cannot derive one, so do not try.",
          ),
        rationale: z
          .string()
          .describe("One line for the register, in the operator's terms."),
      }),
      handler: async ({ document, code, rationale }) => {
        const desk = deskRef.current;
        const record = findRecord(desk.documents, document ?? "");
        if (!record)
          return `REFUSED: "${document}" is not in the policy register.`;
        const filed = await postToDesk("/api/keel/v1/variances", {
          docId: record.docId,
          code,
          rationale,
          personaId: desk.persona.id,
        });
        // The route refuses an unrecognized code WITHOUT enumerating the valid
        // set, and this relays that refusal unchanged — the fifth leak channel
        // stays closed even on the failure path, which is where it is easiest to
        // open by "helpfully" listing the options.
        if (!filed.ok) return `REFUSED: ${filed.message}`;
        const varianceId = (filed.payload as { id?: string } | null)?.id;
        if (!varianceId) {
          return "REFUSED: the register accepted the filing but returned no id, so it could not be ratified.";
        }
        // FILED AND RATIFIED IN ONE CALL. A draft variance authorizes nothing, so
        // leaving the ratification to a second tool call doubles the failure
        // surface for a step that has no decision in it.
        const ratified = await postToDesk(
          `/api/keel/v1/variances/${encodeURIComponent(varianceId)}/ratify`,
          {},
        );
        if (!ratified.ok) return `REFUSED: ${ratified.message}`;
        await deskRef.current.refresh();
        return (
          `Filed and ratified a ${code} variance against ${record.ref} ` +
          `${record.pendingRevision?.label ?? "the pending revision"}. ` +
          `Re-attempt the release to see whether it clears.`
        );
      },
      render: ({ result }) => {
        const text = settledText(result);
        if (!text) return null;
        const refused = text.startsWith("REFUSED");
        return (
          <Receipt tone={refused ? "negative" : "positive"}>
            {text.replace(/^REFUSED:\s*/, "")}
          </Receipt>
        );
      },
    },
    [],
  );

  useHumanInTheLoop(
    {
      followUp: true,
      name: "offerWorkflowRecording",
      description:
        "Offer to WATCH the operator do something you have no saved procedure " +
        "for. Call this immediately after a write is refused and recall_memory " +
        "turned up nothing — say plainly that you do not know this one. Never " +
        "guess a workaround, substitute a different action, or call another tool " +
        "instead of this.",
      parameters: z.object({
        situation: z
          .string()
          .describe("What you were blocked on, in one short line."),
      }),
      render: ({ args, result, respond }) => {
        const text = settledText(result);
        // Replay-safe, and a HUMAN line rather than `result`: that string is an
        // internal directive addressed to the agent ("Call awaitDemonstration
        // now…"), and printing it verbatim puts the demo's own wiring on screen in
        // front of the room.
        if (text) {
          return (
            <Receipt tone={readOfferAccepted(text) ? "positive" : "negative"}>
              {readOfferAccepted(text)
                ? "Watching you do it once."
                : "Left it for now — nothing was recorded."}
            </Receipt>
          );
        }
        if (!respond) return <AwaitingCard />;
        return (
          <ChatSurface className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
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
                onClick={() => void respond?.(OFFER_ACCEPTED)}
              >
                Show me
              </button>
              <button
                type="button"
                className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                onClick={() => void respond?.(OFFER_DECLINED)}
              >
                Not now
              </button>
            </div>
          </ChatSurface>
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
        "Hold the conversation while the operator demonstrates. Call this after " +
        "they agree to show you. Do NOT list steps, name a code, or tell them " +
        "where to click — you do not know the procedure, which is the entire " +
        "reason you are watching. Say only something brief like 'go ahead, I'm " +
        "watching'. When they finish you receive the steps they took and the " +
        "exact code they filed.",
      parameters: z.object({}),
      render: ({ result, respond }) => {
        const text = settledText(result);
        // Replay-safe, and the count is the one the RECORDER reported — never one
        // re-counted out of this prose. See ../teach-mode-directives.
        if (text) {
          const count = readDemonstratedStepCount(text);
          return (
            <Receipt>
              Recorded{" "}
              {count === null
                ? "the demonstration"
                : `${count} ${count === 1 ? "step" : "steps"}`}
              .
            </Receipt>
          );
        }
        if (!respond) return <AwaitingCard />;
        // Its own component, so it subscribes to the recorder directly and
        // re-renders on every logged step, AND owns the outer recording bracket
        // across the operator's two clicks. Inlining either would freeze the feed
        // or strand the demonstrated code — see components/demonstration-card.tsx.
        return (
          <DemonstrationCard onDone={(summary) => void respond(summary)} />
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
        "Summarize what you just watched as a numbered procedure and show it to " +
        "the operator for confirmation. Call this after awaitDemonstration " +
        "reports what it saw, quoting the exact code it reports. After they " +
        "confirm, persist it with save_memory exactly as the card's result " +
        "instructs. Save it AT MOST ONCE.",
      parameters: z.object({
        procedure: z
          .string()
          .describe(
            "The numbered procedure, naming verbatim the code awaitDemonstration reported. Do not paraphrase it.",
          ),
      }),
      render: ({ args, result, respond }) => {
        const text = settledText(result);
        // CLASSIFIED, never merely detected. Both buttons settle this card with a
        // string, so "is there a result at all" would print the saved receipt over
        // a decline — asserting a durable write that never happened, live and
        // identically on every replay.
        if (text) {
          const outcome = classifySaveProcedureResult(text);
          return (
            <Receipt tone={outcome === "saved" ? "positive" : "negative"}>
              {outcome === "saved"
                ? "Saved — I'll use this next time without being asked."
                : outcome === "declined"
                  ? "Left it unsaved — nothing was written to memory."
                  : "This card was already answered."}
            </Receipt>
          );
        }
        if (!respond) return <AwaitingCard />;
        return (
          <ChatSurface className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
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
                onClick={() => void respond?.(SAVE_PROCEDURE_CONFIRMED)}
              >
                Remember it
              </button>
              <button
                type="button"
                className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                onClick={() => void respond?.(SAVE_PROCEDURE_DECLINED)}
              >
                Don&rsquo;t save
              </button>
            </div>
          </ChatSurface>
        );
      },
    },
    [],
  );

  return <KeelSandboxDataSync />;
}
