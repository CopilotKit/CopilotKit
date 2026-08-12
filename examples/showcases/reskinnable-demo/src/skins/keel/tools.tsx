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
import { useKeelHref } from "@/skins/keel/href";
import { SourcesCard } from "@/skins/keel/components/sources-card";
import { PlaybookCard } from "@/skins/keel/components/playbook-card";
import { RunPlanPreview } from "@/skins/keel/components/run-plan-preview";
import { ApprovalCard } from "@/skins/keel/components/approval-card";
import { ApprovalsQueueSurface } from "@/skins/keel/components/approvals-queue";
import { RunTimeline } from "@/skins/keel/components/run-timeline";
import { RegisterHealthCard } from "@/skins/keel/components/register-health-card";
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

  return <KeelSandboxDataSync />;
}
