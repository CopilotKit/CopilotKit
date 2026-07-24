"use client";
import {
  useAgentContext,
  useComponent,
  useHumanInTheLoop,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { usePathname, useRouter } from "next/navigation";
import { z } from "zod";
import useCreditCards from "@/app/actions";
import { CHARGE_CATEGORIES } from "@/app/charges/charges-data";
import { useAuthContext } from "@/components/auth-context";
import { useRecording } from "@/components/recording-context";
import { ApprovalButtons } from "@/components/approval-buttons";
import { RecordingSteps } from "@/components/recording-feed";
import { PendingApprovalsChat } from "@/components/wow/pending-approvals-chat";
import {
  SpendingTrendChart,
  BudgetUsageChart,
  SpendBreakdownChart,
  IncomeExpenseChart,
} from "@/components/analytics-charts";
import { ApprovalFlowDiagram } from "@/components/approval-flow-diagram";
import { PERMISSIONS } from "@/app/api/v1/permissions";
import { withOverLimit } from "@/lib/over-limit";
import { Button } from "./ui/button";

export enum Page {
  Cards = "cards",
  Team = "team",
}

export enum CardsPageOperations {
  ChangePin = "change-pin",
}

export enum TeamPageOperations {
  InviteMember = "invite-member",
  RemoveMember = "remove-member",
  EditMember = "edit-member",
}

export const AVAILABLE_OPERATIONS_PER_PAGE = {
  [Page.Cards]: Object.values(CardsPageOperations),
  [Page.Team]: Object.values(TeamPageOperations),
};

// Self-learning "teach a workflow" loop — the canonical procedure echoed to the
// agent when the officer saves the demonstrated workflow. It names the exact
// (justifying) code the officer used; finalizing such an exception is what lifts
// the over-limit gate (proven in scripts/over-limit-gate-smoke.mjs). This text
// lands in the thread, which is how the agent recalls the procedure later in the
// SAME session. The agent only ever sees the code, never its human label.
const canonicalProcedure = (code: string): string =>
  `Saved workflow for clearing an over-limit charge: (1) open a policy ` +
  `exception against the transaction with code ${code}, (2) finalize the ` +
  `exception, then (3) approve the transaction. Finalizing a ${code} exception ` +
  `lifts the policy-limit gate. Reuse this same procedure for any other ` +
  `over-limit charge — do not ask how to proceed.`;

// A component dedicated to adding readables/actions that are global to the app.
//
// The self-learning teach/recall tools (offerWorkflowRecording,
// awaitDashboardDemonstration, saveLearnedWorkflow, openPolicyException,
// finalizePolicyException, approveTransaction) live HERE, not on the Credit
// Cards page, because the officer demonstrates on the /dashboard route: if these
// tools were registered by a route component they would unmount on navigation,
// the in-progress card would lose its render, and the followUp continuation
// after "I'm done" would never fire. Registered globally they survive route
// changes and render on whichever page the user is on.
const CopilotContext = ({ children }: { children: React.ReactNode }) => {
  const { currentUser } = useAuthContext();
  const pathname = usePathname();
  const router = useRouter();
  const {
    cards,
    policies,
    transactions,
    changeTransactionStatus,
    openPolicyException,
    finalizePolicyException,
  } = useCreditCards();
  const { beginRecording, endRecording, getDemonstratedCode } = useRecording();

  // A readable of app wide authentication and authorization context.
  // The LLM will now know which user is it working against, when performing operations.
  // Given the respective authorization role, the LLM will allow/deny actions/information throughout the entire app.
  useAgentContext({
    description: "The current user logged into the system",
    value: JSON.stringify(currentUser),
  });

  useAgentContext({
    description:
      "The available pages and operations, as well as the current page",
    value: {
      pages: Object.values(Page),
      operations: AVAILABLE_OPERATIONS_PER_PAGE,
      currentPage: pathname.split("/").pop() as Page,
    },
  });

  // The app's cards, policies and transactions — the single agent-facing data
  // readable (registered globally so it is present on every route). When the
  // user names a charge by merchant/amount, the agent resolves it to the id
  // here. `overLimit: true` is the symptom only — it does NOT reveal the unlock
  // procedure (the agent still has to learn that).
  useAgentContext({
    description:
      "The available credit cards, expense policies and transactions. When the " +
      "user refers to a charge by merchant name and/or amount, resolve it to the " +
      "matching transaction id here and pass that id to the transaction tools; " +
      "never invent an id. `overLimit: true` on a transaction means it is over " +
      "its policy limit and cannot be approved normally — it has no standing " +
      "approval yet.",
    value: JSON.stringify({
      cards,
      policies,
      transactions: withOverLimit(transactions, policies),
    }),
  });

  // Actions the current user is NOT permitted to perform (role-derived). Global
  // so the agent applies the same permission rules on every route.
  useAgentContext({
    description:
      "Actions the current user is NOT permitted to perform. An empty list " +
      "means the user is permitted to use every available action. Only " +
      "refuse an action if it appears in this list — never refuse for any " +
      "other reason. When refusing, say the user lacks permission; do not " +
      "tell them they are on the wrong page.",
    value: Object.keys(PERMISSIONS).filter(
      (key) =>
        !PERMISSIONS[key as keyof typeof PERMISSIONS].includes(
          currentUser.role,
        ),
    ),
  });

  // This action is a generic "fits all" action
  // It's meant to allow the LLM to navigate to a page where an operation is available or probably available, and possibly activate the operation there.
  // It is tired to the readable above, and requires that operations are implemented in their respective pages.
  // The LLM here will redirect the user to a different page, and set an `operation` query param to notify the page of the requested action
  // For example, you can find `change-pin` in the cards page, which is activated when `operation=change-pin` query param is sent
  useHumanInTheLoop({
    name: "navigateToPageAndPerform",
    description: `
            Navigate to a different page to perform an operation.
            IMPORTANT: Only use this action when the user needs to go to a DIFFERENT page than the one they are currently on.
            Do NOT use this if the user is already on the correct page - instead, use the page-specific tools directly.
            For example, if the user is on the cards page and asks to add a card, do NOT use this action - use the addNewCard tool instead.
            Only use this when the user is on the wrong page entirely (e.g., on team page but asking about cards).
        `,
    parameters: z.object({
      page: z
        .enum(["/cards", "/team", "/"])
        .describe("The page in which to perform the operation"),
      operation: z
        .string()
        .describe(
          "The operation to perform. Use operation code from available operations per page. If the operation is unavailable, do not pass it",
        )
        .optional(),
      operationAvailable: z
        .boolean()
        .describe("Flag if the operation is available"),
    }),
    followUp: false,
    render: ({ args, respond }) => {
      const { page, operation, operationAvailable } = args;

      return (
        <div className="flex items-center justify-center gap-4 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <div className="text-sm">
            Navigate to <span className="font-semibold">{page}</span>?
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const operationParams = `?operation=${operation}`;
              // `/cards` mirrors the dashboard; the card tools/operations
              // (add card, change PIN) are registered on the home route, so
              // card requests must land on `/` or the operation dies on
              // arrival.
              const target = page === "/cards" ? "/" : page!.toLowerCase();
              // Client-side navigation: a full reload (window.location) tears
              // down the chat panel mid-run, so the conversation — and the
              // in-flight operation — is lost the moment we navigate.
              router.push(
                `${target}${operationAvailable ? operationParams : ""}`,
              );
              respond?.(page!);
            }}
            aria-label="Confirm Navigation"
            className="h-12 w-12 rounded-full bg-brand-soft text-brand-indigo hover:bg-brand-soft/70 dark:text-brand-violet"
          >
            Yes
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => respond?.("cancelled")}
            aria-label="Cancel Navigation"
            className="h-12 w-12 rounded-full bg-surface-muted text-ink-muted hover:bg-surface-muted/70"
          >
            No
          </Button>
        </div>
      );
    },
  });

  // Charges page: navigate + pre-filter + stack-rank. Fire-and-forget (no
  // confirm) — opening a filtered list is safe. The page reads these as URL
  // params (?sort=&top=&category=&status=&vendor=&from=&to=) so the on-screen
  // controls reflect exactly what the agent chose. "the 10 most expensive
  // charges" => { sort: "amount_desc", top: 10 }.
  useFrontendTool({
    name: "showCharges",
    description: `Open the Charges page pre-filtered and sorted, then stack-ranked. Use for asks like "show me the 10 most expensive charges", "which charges are over limit", or "marketing charges in May". Set sort/top/filters accordingly.`,
    parameters: z.object({
      sort: z
        .enum(["amount_desc", "amount_asc", "date_desc", "date_asc"])
        .optional()
        .describe(
          "Sort order. 'most/least expensive' => amount_desc/amount_asc; 'newest/oldest' => date_desc/date_asc.",
        ),
      top: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Show only the top N rows after sorting (e.g. 10)."),
      categories: z
        .array(z.string())
        .optional()
        .describe(
          `Filter to these categories (exact names): ${CHARGE_CATEGORIES.join(", ")}.`,
        ),
      statuses: z
        .array(z.enum(["approved", "pending", "flagged", "over-limit"]))
        .optional()
        .describe("Filter to these statuses."),
      vendor: z
        .string()
        .optional()
        .describe("Only charges whose merchant contains this text."),
      from: z
        .string()
        .optional()
        .describe("Only charges on/after this ISO date (yyyy-mm-dd)."),
      to: z
        .string()
        .optional()
        .describe("Only charges on/before this ISO date (yyyy-mm-dd)."),
    }),
    handler: async ({ sort, top, categories, statuses, vendor, from, to }) => {
      const params = new URLSearchParams();
      if (sort) params.set("sort", sort);
      if (top) params.set("top", String(top));
      if (categories?.length) params.set("category", categories.join(","));
      if (statuses?.length) params.set("status", statuses.join(","));
      if (vendor) params.set("vendor", vendor);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      router.push(qs ? `/charges?${qs}` : "/charges");
      return `Opened the Charges page${qs ? ` (${qs})` : ""}.`;
    },
  });

  // Generative-UI: the pending-approval queue, rendered IN the chat. Mirrors the
  // dashboard's "Pending approval" tab behaviors (identical over-limit gating,
  // exception filing, and teach-mode recording payloads) so the officer can
  // triage and clear over-limit charges without leaving the conversation.
  // Rendered via PendingApprovalsChat — the dashboard's 4-column table is
  // ~550px wide and its Actions column lands past the ~375px chat card's edge
  // (buttons render but cannot be clicked), so the chat uses a stacked layout
  // with labeled actions instead. Display-only `useComponent` (not
  // useFrontendTool) so the card persists in the transcript after the call;
  // re-registers when the data changes, or the closure captures empty arrays.
  useComponent(
    {
      name: "showPendingApprovals",
      description:
        "Show the queue of transactions awaiting approval (including over-limit " +
        "charges) as an interactive list in the chat. Call this whenever the " +
        "user asks what is pending, what needs approval, or to review pending or " +
        "over-limit charges — do NOT list the transactions in plain text. After " +
        "the list renders, add one short sentence pointing at what needs " +
        "attention (e.g. how many are over their policy limit).",
      parameters: z.object({}),
      render: () => {
        const pending = transactions.filter((t) => t.status === "pending");
        if (!pending.length) {
          return (
            <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
              No transactions are pending approval.
            </div>
          );
        }
        return (
          // `pointer-events-auto`: this is a `useComponent` (display-only) render,
          // which CopilotKit paints with `pointer-events: none` on the assistant
          // message. But this table is interactive (Approve / Deny / File policy
          // exception), so opt its subtree back into pointer events or the row
          // actions (incl. the "More actions" menu) are unclickable in the chat.
          <div className="pointer-events-auto space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
            <h3 className="text-lg font-semibold text-ink">
              Pending approvals
            </h3>
            <PendingApprovalsChat
              transactions={pending}
              policies={policies}
              openPolicyException={openPolicyException}
              finalizePolicyException={finalizePolicyException}
              onApprove={async (id) =>
                (await changeTransactionStatus({ id, status: "approved" })).ok
              }
              onDeny={async (id) =>
                (await changeTransactionStatus({ id, status: "denied" })).ok
              }
            />
          </div>
        );
      },
    },
    [transactions, policies],
  );

  // ── Generative-UI charts & diagrams ─────────────────────────────────────────
  // Visualizations the agent can summon directly in the chat (display-only
  // `useComponent`, so they persist in the transcript like showTransactions).
  // All hand-rolled SVG/CSS in the brand style — no charting dependency. Each
  // re-registers when the data it reads changes.
  //
  // Every chart description carries the same "chart + answer" rule: the chart
  // replaces restating the raw numbers, NOT the answer itself. Without it the
  // model renders the right chart and never addresses the user's actual
  // question ("which policy is closest to its limit?" → chart, silence).
  const CHART_ANSWER_RULE =
    " After the chart renders, ALSO answer the user's specific question in " +
    "one or two sentences grounded in the data — the chart replaces listing " +
    "the raw numbers, not your answer. If the user asked no specific " +
    "question, one short takeaway sentence is enough.";

  useComponent(
    {
      name: "showSpendingTrend",
      description:
        "Render a chart of spending over time in the chat. Call this for any " +
        "question about spend trends, history, or how spending has changed." +
        CHART_ANSWER_RULE,
      parameters: z.object({}),
      render: () => (
        <div className="space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <h3 className="text-lg font-semibold text-ink">Spending trend</h3>
          <SpendingTrendChart transactions={transactions} />
        </div>
      ),
    },
    [transactions],
  );

  useComponent(
    {
      name: "showBudgetUsage",
      description:
        "Render a chart of budget usage per expense policy (spent vs limit) in " +
        "the chat. Call this for questions about budgets, limits, utilization, " +
        "or which teams are close to or over their limit." +
        CHART_ANSWER_RULE,
      parameters: z.object({}),
      render: () => (
        <div className="space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <h3 className="text-lg font-semibold text-ink">
            Budget usage by policy
          </h3>
          <BudgetUsageChart policies={policies} />
        </div>
      ),
    },
    [policies],
  );

  useComponent(
    {
      name: "showSpendBreakdown",
      description:
        "Render a donut chart breaking spend down by team/policy in the chat. " +
        "Call this for 'where is the money going', spend distribution, or " +
        "breakdown-by-team questions." +
        CHART_ANSWER_RULE,
      parameters: z.object({}),
      render: () => (
        <div className="space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <h3 className="text-lg font-semibold text-ink">Spend breakdown</h3>
          <SpendBreakdownChart policies={policies} />
        </div>
      ),
    },
    [policies],
  );

  useComponent(
    {
      name: "showIncomeVsExpenses",
      description:
        "Render a chart comparing total income vs expenses (and the net) in " +
        "the chat. Call this for cash-flow, income-vs-spend, or net-position " +
        "questions." +
        CHART_ANSWER_RULE,
      parameters: z.object({}),
      render: () => (
        <div className="space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <h3 className="text-lg font-semibold text-ink">Income vs expenses</h3>
          <IncomeExpenseChart transactions={transactions} />
        </div>
      ),
    },
    [transactions],
  );

  useComponent(
    {
      name: "showApprovalFlow",
      description:
        "Render a diagram of how an over-limit charge gets cleared (file " +
        "exception → finalize → approve). Call this when the user asks how " +
        "approvals or over-limit charges work, or to explain the process.",
      parameters: z.object({}),
      render: () => (
        <div className="space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <h3 className="text-lg font-semibold text-ink">
            Clearing an over-limit charge
          </h3>
          <ApprovalFlowDiagram />
        </div>
      ),
    },
    [],
  );

  // ── Recall tools (open → finalize → approve) ───────────────────────────────
  // Neutral descriptions: they must not say what each step accomplishes, name a
  // code, or describe a sequence — the agent learns the order from the saved
  // procedure (canonicalProcedure), never from the prompt.

  // Open a draft policy exception against a transaction (human-in-the-loop).
  useHumanInTheLoop({
    // followUp:true so that during recall the agent CONTINUES after the
    // exception is opened — it must chain to finalizePolicyException (and then
    // approval) on its own. With followUp:false the run ended here and the
    // recall stalled after opening the exception.
    followUp: true,
    name: "openPolicyException",
    description:
      "Open a draft policy exception against a transaction. Requires human approval.",
    available: PERMISSIONS.APPROVE_TRANSACTION.includes(currentUser.role),
    parameters: z.object({
      transactionId: z.string(),
      code: z.string(),
    }),
    render: ({ args, respond, status }) => {
      const { transactionId, code } = args;

      if (status === "inProgress") {
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            Loading…
          </div>
        );
      }

      return (
        <div className="space-y-4 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <h3 className="text-lg font-semibold text-ink">
            Open policy exception
          </h3>
          <div className="text-sm space-y-1">
            <p>
              <span className="text-ink-muted">Transaction:</span>{" "}
              {transactionId}
            </p>
            <p>
              <span className="text-ink-muted">Code:</span> {code}
            </p>
          </div>
          <ApprovalButtons
            onApprove={async () => {
              if (!transactionId || !code) {
                respond?.("Missing transaction or exception code");
                return;
              }
              const { ok, data, error } = await openPolicyException({
                transactionId,
                code,
              });
              // Directive result so the agent reliably chains the NEXT step
              // during recall: finalize THIS exception (by id) before any
              // approval. gpt-5.4-mini otherwise tends to jump straight to
              // approving, which the gate then rejects.
              respond?.(
                ok
                  ? `Policy exception opened as a DRAFT. Its exceptionId is "${data?.id ?? ""}" — this is the id of the exception, NOT the transaction id. Next, call finalizePolicyException with exceptionId "${data?.id ?? ""}" exactly. The transaction stays blocked until this exception is finalized — do not try to approve before then.`
                  : `Could not open exception: ${error}`,
              );
            }}
            onDeny={() => respond?.("Denied by user")}
          />
        </div>
      );
    },
  });

  // Finalize a policy exception (human-in-the-loop).
  useHumanInTheLoop({
    // followUp:true so the agent CONTINUES after finalizing to perform the
    // approval — completing the open -> finalize -> approve recall chain.
    followUp: true,
    name: "finalizePolicyException",
    description: "Finalize a policy exception. Requires human approval.",
    available: PERMISSIONS.APPROVE_TRANSACTION.includes(currentUser.role),
    parameters: z.object({
      exceptionId: z.string(),
    }),
    render: ({ args, respond, status }) => {
      const { exceptionId } = args;

      if (status === "inProgress") {
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            Loading…
          </div>
        );
      }

      return (
        <div className="space-y-4 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <h3 className="text-lg font-semibold text-ink">
            Finalize policy exception
          </h3>
          <div className="text-sm space-y-1">
            <p>
              <span className="text-ink-muted">Exception:</span> {exceptionId}
            </p>
          </div>
          <ApprovalButtons
            onApprove={async () => {
              if (!exceptionId) {
                respond?.("Missing exception id");
                return;
              }
              const { ok, error } = await finalizePolicyException({
                exceptionId,
              });
              respond?.(
                ok
                  ? "Exception finalized — the policy-limit gate is now lifted. Approve the transaction to complete it."
                  : `Could not finalize exception: ${error}`,
              );
            }}
            onDeny={() => respond?.("Denied by user")}
          />
        </div>
      );
    },
  });

  // Approve a transaction (human-in-the-loop). The final step of the recall
  // chain, once the over-limit gate has been lifted. Single-purpose and
  // neutral: it says nothing about exceptions or codes. Its description gates it
  // to the post-unlock state so the agent does NOT fire it as the first response
  // to an over-limit approval request — at Beat 1 it has no saved procedure and
  // must offer to record instead.
  useHumanInTheLoop({
    followUp: true,
    name: "approveTransaction",
    description:
      "Approve a single transaction. Only call this for a charge that can actually be approved now — either it is within its policy limit, or its over-limit gate has already been lifted by the earlier steps of your saved procedure. Never call this as the first response to an over-limit approval request.",
    available: PERMISSIONS.APPROVE_TRANSACTION.includes(currentUser.role),
    parameters: z.object({
      transactionId: z.string(),
    }),
    render: ({ args, respond, status }) => {
      const { transactionId } = args;

      if (status === "inProgress") {
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            Loading…
          </div>
        );
      }

      return (
        <div className="space-y-4 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <h3 className="text-lg font-semibold text-ink">
            Approve transaction
          </h3>
          <div className="text-sm space-y-1">
            <p>
              <span className="text-ink-muted">Transaction:</span>{" "}
              {transactionId}
            </p>
          </div>
          <ApprovalButtons
            onApprove={async () => {
              if (!transactionId) {
                respond?.("Missing transaction id");
                return;
              }
              const { ok, error } = await changeTransactionStatus({
                id: transactionId,
                status: "approved",
              });
              respond?.(
                ok
                  ? `Transaction ${transactionId} approved.`
                  : `Could not approve transaction ${transactionId}: ${error}`,
              );
            }}
            onDeny={() => respond?.("Denied by user")}
          />
        </div>
      );
    },
  });

  // ── Self-learning "teach a workflow" loop ──────────────────────────────────
  // The agent drives this as a narrated sequence once it's asked to approve an
  // over-limit charge it has no saved procedure for (the sequencing rules live
  // in api/copilotkit/[[...slug]]/route.ts): offer to record -> wait while the
  // officer demonstrates the fix ON THE DASHBOARD -> summarize and save. All are
  // followUp:true so the agent advances to the next beat after each card
  // resolves. Recording mode (the canvas vignette) opens on "Start recording"
  // and closes on "I'm done"/Save/Discard/Cancel; RecordingProvider ref-counts,
  // so the dashboard's own begin/end brackets nest harmlessly inside this window.

  // BEAT 2 — offer to record, after an approval is declined with no procedure.
  useHumanInTheLoop({
    followUp: true,
    name: "offerWorkflowRecording",
    description:
      "Offer to record how the user handles a charge you have no saved procedure for. Call this immediately after you decline an over-limit approval you have no saved workflow for — do NOT just ask how to proceed.",
    available: PERMISSIONS.APPROVE_TRANSACTION.includes(currentUser.role),
    parameters: z.object({
      transactionId: z
        .string()
        .describe("The transaction whose approval was just declined."),
    }),
    render: ({ args, respond, status, result }) => {
      if (status === "inProgress") {
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            Loading…
          </div>
        );
      }
      // Once the user has chosen, collapse to a static line so the
      // "Start recording" button doesn't linger (or get clicked twice) — the
      // live "Recording your workflow" card (awaitDashboardDemonstration) takes
      // over from here. Branch on the resolved `result` (fresh on complete) — NOT
      // isRecording, whose value in this render closure can be stale and wrongly
      // show "not recording" right after Start recording. onDeny resolves
      // "declined"; onApprove resolves the (non-"declined") directive string.
      if (status === "complete") {
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            {result === "declined"
              ? "Okay — not recording."
              : "Recording started — go ahead and demonstrate the fix on the dashboard."}
          </div>
        );
      }
      return (
        <div className="space-y-4 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-ink">
              Record a workflow?
            </h3>
            <p className="text-sm text-ink-muted">
              No saved procedure for this charge yet. Want me to record how you
              handle it so I can do it myself next time?
            </p>
          </div>
          <ApprovalButtons
            approveLabel="Start recording"
            denyLabel="Not now"
            onApprove={() => {
              beginRecording();
              // Directive result. With a bare "started", gpt-5.4-mini tends to
              // just SAY awaitDashboardDemonstration's "go ahead and I'll watch"
              // line (from its description) instead of CALLING it — leaving this
              // card frozen with no live recording card. Tell it explicitly to
              // call the tool and not reply in prose (mirrors the save beat).
              respond?.(
                `Recording started. Now IMMEDIATELY call awaitDashboardDemonstration with transactionId "${args?.transactionId ?? ""}" — that tool renders the live "Recording your workflow" card and is how you watch. Do NOT reply in plain text; calling that tool is the only correct next step.`,
              );
            }}
            onDeny={() => respond?.("declined")}
          />
        </div>
      );
    },
  });

  // BEAT 3 — the officer demonstrates on the real dashboard. This card just
  // waits: the actual file-exception + approve happens on /dashboard (Transactions
  // -> Pending approval), which records to the active thread. When the officer
  // returns and clicks "I'm done" we end recording and report the exception code
  // they used (captured via the recording context) so the agent can summarize
  // and save it. No deps array: getDemonstratedCode reads a ref, so the click
  // handler always sees the latest code even though this card rendered before
  // the officer filed anything on the dashboard.
  useHumanInTheLoop({
    followUp: true,
    name: "awaitDashboardDemonstration",
    description: `Wait while the user demonstrates how they clear this charge themselves. Call this after the user agrees to record (offerWorkflowRecording returned "started"). Do NOT give the user step-by-step directions or tell them where to click — you do not know the procedure, which is the whole point of watching. Say only something brief like "Go ahead and do it now and I'll watch and learn." When they finish you receive the exception code they used.`,
    available: PERMISSIONS.APPROVE_TRANSACTION.includes(currentUser.role),
    parameters: z.object({
      transactionId: z
        .string()
        .describe("The transaction the user will demonstrate on."),
    }),
    render: ({ respond, status, result }) => {
      if (status === "inProgress") {
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            Loading…
          </div>
        );
      }
      // Once resolved, collapse so the "I'm done" button can't linger.
      if (status === "complete") {
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            {result === "cancelled"
              ? "Recording cancelled."
              : "Recording finished — saving the workflow…"}
          </div>
        );
      }
      return (
        <div className="space-y-4 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-negative opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-negative" />
              </span>
              <h3 className="text-lg font-semibold text-ink">
                Recording your workflow
              </h3>
              <span className="ml-auto text-[0.65rem] font-semibold uppercase tracking-wide text-negative">
                Rec
              </span>
            </div>
            <p className="text-sm text-ink-muted">
              I don&apos;t know how to do this yet — go ahead and do it yourself
              now and I&apos;ll watch and learn. Click{" "}
              <span className="font-medium text-ink">I&apos;m done</span> when
              you&apos;re finished.
            </p>
          </div>
          {/* Live feed of the actions being captured — same chat card, so it
              reads consistently with the other cards (not a floating overlay). */}
          <RecordingSteps />
          <ApprovalButtons
            approveLabel="I'm done"
            denyLabel="Cancel"
            onApprove={() => {
              endRecording();
              const code = getDemonstratedCode();
              // Directive result so the agent reliably renders the Save card as
              // its next step instead of just asking "should I save this?" in
              // prose (gpt-5.4-mini otherwise tends to summarize in text and
              // stall, leaving the user nothing to click). saveLearnedWorkflow
              // IS the way it asks.
              respond?.(
                code
                  ? `The user filed a policy exception with code ${code} and approved the charge on the dashboard. Now call saveLearnedWorkflow with this transaction id and code "${code}" exactly — that renders the card that asks them to save it. Do NOT ask whether to save in plain text; the card is how you ask.`
                  : "The user finished on the dashboard, but no exception code was captured. Ask them which exception code they used, then call saveLearnedWorkflow with it.",
              );
            }}
            onDeny={() => {
              endRecording();
              respond?.("cancelled");
            }}
          />
        </div>
      );
    },
  });

  // BEAT 4 — summarize and save. Echoes the demonstrated procedure back into the
  // thread (the same-session recall mechanism) and closes recording mode.
  useHumanInTheLoop({
    followUp: true,
    name: "saveLearnedWorkflow",
    description:
      "Summarize the procedure the user just demonstrated and ask to save it. Call this after awaitDashboardDemonstration reports a filed exception, passing the exact code from that result.",
    available: PERMISSIONS.APPROVE_TRANSACTION.includes(currentUser.role),
    parameters: z.object({
      transactionId: z.string(),
      code: z
        .string()
        .describe(
          "The exception code the user demonstrated, taken from awaitDashboardDemonstration's result.",
        ),
    }),
    render: ({ args, respond, status, result }) => {
      if (status === "inProgress") {
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            Loading…
          </div>
        );
      }
      // Once resolved, collapse so the "Save workflow" button can't linger or be
      // re-clicked. `result` carries the value passed to respond() on complete.
      if (status === "complete") {
        const saved =
          typeof result === "string" && result.includes("status: saved");
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            {saved
              ? "Workflow saved — I’ll reuse it for future over-limit charges."
              : "Discarded — not saved."}
          </div>
        );
      }
      const { code, transactionId } = args;
      return (
        <div className="space-y-4 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-ink">
              Save this workflow?
            </h3>
            <p className="text-sm text-ink-muted">
              To clear an over-limit charge:
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
              <li>
                Open a policy exception under code{" "}
                <span className="font-mono text-xs">{code}</span>
              </li>
              <li>Finalize the exception</li>
              <li>Approve the transaction</li>
            </ol>
          </div>
          <ApprovalButtons
            approveLabel="Save workflow"
            denyLabel="Discard"
            onApprove={() => {
              endRecording();
              // Resolve a result the agent recognizes as "saved" and that drives it
              // to persist the procedure durably via save_memory (Option A — see the
              // TEACH & RECALL prompt). The demonstrated charge was cleared BY the
              // demonstration, so it is already approved; say so explicitly or the
              // agent tends to re-run the just-saved procedure on that same charge —
              // opening a redundant exception on an approved transaction.
              respond?.(
                `(status: saved) ${canonicalProcedure(code)} Now persist this durably: call save_memory with scope "project", kind "operational", and content describing this over-limit procedure using code "${code}". You learned this by watching the user clear transaction ${transactionId}, which is already approved now — do NOT apply the procedure to ${transactionId} again or re-approve it. The original request is complete; wait for the user's next instruction before acting.`,
              );
            }}
            onDeny={() => {
              endRecording();
              respond?.("discarded");
            }}
          />
        </div>
      );
    },
  });

  return children;
};

export default CopilotContext;
