"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  useAgentContext,
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
  ToolCallStatus,
} from "@copilotkit/react-core/v2";
import { useSkinData } from "@/shell/skin-provider";
import { getDoc } from "@/skins/keel/knowledge/corpus";
import type { Citation } from "@/skins/keel/knowledge/types";
import type { KeelData } from "@/skins/keel/data/types";
import { SourcesCard } from "@/skins/keel/components/sources-card";
import { PlaybookCard } from "@/skins/keel/components/playbook-card";
import { RunPlanPreview } from "@/skins/keel/components/run-plan-preview";
import { ApprovalCard } from "@/skins/keel/components/approval-card";
import { ApprovalsQueue } from "@/skins/keel/components/approvals-queue";
import { RunTimeline } from "@/skins/keel/components/run-timeline";
import { KeelSandboxDataSync } from "@/skins/keel/sandbox-functions";

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

export function KeelTools() {
  const data = useSkinData<KeelData>();
  const router = useRouter();
  const { summaryKey, persona } = data;

  const openCitation = useCallback(
    (c: Citation) => router.push(`/keel/knowledge/${c.docId}#${c.sectionId}`),
    [router],
  );

  // ── Agent-context readables ──────────────────────────────────────────────
  // CHURN GUARD (spec §6.5). The ticker mutates `data.runs` every 900ms, but
  // `summaryKey` changes ONLY on a meaningful transition — it is derived from
  // the (runId, status, currentStepId) tuples, never from elapsed time. These
  // readables therefore memoize on `summaryKey`, NOT on `data.runs`. Depending
  // on `runs` directly would rewrite the agent's context on every tick and
  // inflate token cost for no information gain.
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
    // on every 900ms tick, so it is deliberately omitted from the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summaryKey, data.kpis],
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
          .describe("The passages you actually used, in the order you used them."),
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
        "Open a policy document in the Knowledge section, optionally scrolled " +
        "to a specific section. Use when the user asks to see or read a policy.",
      parameters: z.object({
        docId: z.string(),
        sectionId: z.string().optional(),
      }),
      handler: async ({ docId, sectionId }) => {
        const doc = getDoc(docId);
        if (!doc) return `No document is filed under "${docId}".`;
        router.push(
          `/keel/knowledge/${docId}${sectionId ? `#${sectionId}` : ""}`,
        );
        return `Opened ${doc.ref} — ${doc.title}.`;
      },
      render: ({ status }) => (
        <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
          {status === ToolCallStatus.Complete
            ? "Opened the policy."
            : "Opening the policy…"}
        </div>
      ),
    },
    [router],
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
    [data.playbooks, data.getPlaybook],
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
      render: ({ args, status, respond }) => {
        const playbook = args?.playbookId
          ? data.getPlaybook(args.playbookId)
          : undefined;

        if (status === ToolCallStatus.Executing && respond) {
          if (!playbook) {
            return (
              <div className="pointer-events-auto rounded-md border border-hairline bg-surface p-3 text-sm text-negative">
                No playbook is registered under &quot;{args?.playbookId}&quot;.
                <button
                  className="ml-2 underline"
                  onClick={() =>
                    void respond("That playbook id does not exist.")
                  }
                >
                  Dismiss
                </button>
              </div>
            );
          }
          return (
            <RunPlanPreview
              playbook={playbook}
              subject={args?.subject ?? ""}
              onConfirm={() => {
                const result = data.startRun(playbook.id, {
                  subject: args?.subject ?? "",
                  values: args?.values,
                });
                void respond(
                  result.ok && result.run
                    ? `Started ${result.run.id} — ${result.run.title} for ${result.run.subject}.`
                    : (result.reason ?? "The run could not be started."),
                );
              }}
              onCancel={() =>
                void respond("The user declined to start this run.")
              }
            />
          );
        }
        return (
          <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
            {status === ToolCallStatus.Complete
              ? "Run request handled."
              : "Preparing the plan…"}
          </div>
        );
      },
    },
    [data.getPlaybook, data.startRun],
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
          <div className="rounded-md border border-hairline bg-surface p-3">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="font-mono text-xs font-semibold text-brand">
                {run.id}
              </span>
              <span className="text-sm font-semibold text-ink">
                {run.title}
              </span>
            </div>
            <RunTimeline run={run} compact />
          </div>
        );
      },
    },
    // Depends on `runs` (not summaryKey): the whole point of this card is to
    // re-render as the ticker advances the timeline in front of the user.
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
      render: ({ args, status, respond }) => {
        if (status === ToolCallStatus.Executing && respond) {
          const run = args?.runId ? data.getRun(args.runId) : undefined;
          const step = run?.steps.find((s) => s.id === args?.stepId);

          if (!run || !step) {
            return (
              <div className="pointer-events-auto rounded-md border border-hairline bg-surface p-3 text-sm text-negative">
                That step is no longer available.
                <button
                  className="ml-2 underline"
                  onClick={() =>
                    void respond("That run or step no longer exists.")
                  }
                >
                  Dismiss
                </button>
              </div>
            );
          }

          return (
            <ApprovalCard
              run={run}
              step={step}
              actionable={step.approverRole === persona.role}
              onApprove={(note) => {
                const result = data.approveStep(run.id, step.id, note);
                void respond(
                  result.ok
                    ? `Approved ${step.title} on ${run.id}.`
                    : // The stale-approval race (spec §12): the ticker may have
                      // advanced this run between the proposal and the click.
                      (result.reason ?? "That approval could not be recorded."),
                );
              }}
              onReject={(note) => {
                const result = data.rejectStep(run.id, step.id, note);
                void respond(
                  result.ok
                    ? `Rejected ${step.title} on ${run.id}; the run was cancelled.`
                    : (result.reason ?? "That rejection could not be recorded."),
                );
              }}
            />
          );
        }
        return (
          <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
            {status === ToolCallStatus.Complete
              ? "Approval handled."
              : "Opening the approval…"}
          </div>
        );
      },
    },
    [data.runs, data.getRun, data.approveStep, data.rejectStep, persona.role],
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
          <ApprovalsQueue
            items={data.approvals}
            onApprove={(runId, stepId) => data.approveStep(runId, stepId)}
          />
        );
      },
    },
    [data.approvals, data.approveStep],
  );

  useFrontendTool(
    {
      name: "navigateTo",
      description:
        "Navigate the app to one of Keel's pages. Use when the user asks to go " +
        "to, open, or show a section of the app.",
      parameters: z.object({
        page: z.enum(["desk", "knowledge", "playbooks", "runs"]),
      }),
      handler: async ({ page }) => {
        router.push(page === "desk" ? "/keel" : `/keel/${page}`);
        return `Opened ${page}.`;
      },
      render: ({ status }) => (
        <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
          {status === ToolCallStatus.Complete ? "Navigated." : "Navigating…"}
        </div>
      ),
    },
    [router],
  );

  return <KeelSandboxDataSync />;
}
