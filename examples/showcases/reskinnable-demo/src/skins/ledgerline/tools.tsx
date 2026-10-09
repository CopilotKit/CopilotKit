"use client";

import { z } from "zod";
import {
  useAgentContext,
  useFrontendTool,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { useRouter } from "next/navigation";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { Check, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { API, useLedger } from "./data/client";
import {
  agentPolicies,
  agentReport,
  agentReportRow,
  holdRefusal,
} from "./data/agent-view";
import { LEDGERLINE_API_DESCRIPTION } from "./data/agent-api-index";
import type { ExpenseReport, PolicyDoc } from "./data/types";
import { LearnedSkillTools } from "./learned-skills";
import { ReportCard, ReportTable } from "./genui/cards";
import type {
  ReportRowView,
  ReportView,
  ReviewOutcome,
  ReviewView,
} from "./genui/views";
import { ReviewMatchesCard } from "./genui/review-card";
import { CloseStatusCard } from "./genui/close-status-card";
import type { CloseStatusView } from "./genui/views";

/**
 * Ledgerline's frontend tools. Each handler calls the same REST API the pages
 * use (`/api/ledgerline/v1`) and returns JSON: `{ error, code, message }` on a
 * refusal, so the agent trace records the status the server gave.
 *
 * Every tool draws its own one-line activity row (`ToolLine`), so a run that
 * does not converge shows every attempt in the chat instead of the shell's
 * last-two-chips summary.
 */

async function call(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${path}`, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, body };
}

const post = (path: string, body?: unknown) =>
  call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function refusal(body: Record<string, unknown>, reportId: string): string {
  if (body.error === "POLICY_HOLD")
    return JSON.stringify(holdRefusal(reportId, String(body.code ?? "")));
  return JSON.stringify({
    error: body.error ?? "REFUSED",
    message: body.message ?? "The request was refused.",
  });
}

const id = (v: unknown) =>
  typeof v === "string" ? v.trim().toUpperCase() : "";

/** One tool call as a single line: what it did, and how it came back. */
function ToolLine({
  label,
  detail,
  result,
}: {
  label: string;
  detail?: string;
  result: unknown;
}) {
  const [open, setOpen] = useState(false);
  const pending = typeof result !== "string";
  let parsed: Record<string, unknown> | null = null;
  if (typeof result === "string") {
    try {
      parsed = JSON.parse(result) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  const failed = !!parsed && typeof parsed === "object" && "error" in parsed;
  const errorLabel = failed
    ? [parsed!.error, parsed!.code].filter(Boolean).join(" ")
    : "";
  return (
    <div data-testid="ledgerline-tool-line" className="my-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-1.5 text-left text-[13px] text-ink-muted hover:text-ink"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 flex-none animate-spin" />
        ) : failed ? (
          <X className="h-3.5 w-3.5 flex-none text-negative" />
        ) : (
          <Check className="h-3.5 w-3.5 flex-none text-positive" />
        )}
        <span className="ll-tool-label font-medium text-ink">{label}</span>
        {detail ? (
          <span className="ll-mono truncate text-[12px] text-[hsl(var(--ll-faint))]">
            {detail}
          </span>
        ) : null}
        {failed ? (
          <span className="ll-mono rounded-[5px] bg-negative-soft px-1.5 py-0.5 text-[11px] font-semibold text-negative">
            {errorLabel}
          </span>
        ) : null}
        <ChevronRight
          className={cn(
            "h-3 w-3 flex-none transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {/* Only the newest line of a run shows; this reveals the earlier ones
          (theme.css hides them and shows this arrow only where some are hidden). */}
      <button
        type="button"
        aria-label="Show every tool call"
        data-testid="ledgerline-tool-expand"
        onClick={(e) => {
          const list = e.currentTarget.closest<HTMLElement>(
            ".copilotKitMessages",
          );
          if (!list) return;
          list.dataset.llTools = list.dataset.llTools === "open" ? "" : "open";
        }}
        className="ll-tool-expand ml-5 hidden items-center gap-1 text-[11px] text-[hsl(var(--ll-faint))] hover:text-ink"
      >
        <ChevronDown className="h-3 w-3 transition-transform" />
        <span>All steps</span>
      </button>
      {open && typeof result === "string" ? (
        <pre className="ml-5 mt-1 max-h-48 overflow-auto whitespace-pre-wrap border-l border-hairline pl-3 text-[0.68rem] text-ink-muted">
          {result.length > 1500 ? `${result.slice(0, 1500)}...` : result}
        </pre>
      ) : null}
    </div>
  );
}

function parseJson<T>(v: unknown): T | null {
  if (typeof v !== "string") return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

export function LedgerlineTools() {
  const { data, refresh } = useLedger();
  const router = useRouter();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const ledgerRef = useRef(data);
  useEffect(() => {
    ledgerRef.current = data;
  }, [data]);

  useAgentContext({
    description: "Who you are helping and today's date in Ledgerline.",
    value: JSON.stringify({
      company: data.company,
      user: data.currentUser,
      today: data.today,
    }),
  });

  useFrontendTool(
    {
      name: "listReports",
      description:
        "List expense reports, newest first. Filter by employee name (or part of it) and status ('submitted' = awaiting approval).",
      parameters: z.object({
        employee: z
          .string()
          .optional()
          .describe("Employee name or part of it."),
        status: z
          .enum([
            "all",
            "draft",
            "submitted",
            "approved",
            "reimbursed",
            "rejected",
          ])
          .optional(),
      }),
      handler: async ({ employee, status }) => {
        const q = new URLSearchParams();
        if (employee) q.set("employee", employee);
        q.set("status", status ?? "all");
        const { body } = await call(`/reports?${q}`);
        const rows = (body as unknown as ExpenseReport[]).map(agentReportRow);
        return JSON.stringify({
          count: rows.length,
          shownToUser:
            "The list is drawn as a table card in the chat. Answer in one or two sentences; never list the rows yourself.",
          reports: rows.slice(0, 50),
        });
      },
      render: ({ args, result }) => {
        const parsed = parseJson<{ reports?: ReportRowView[] }>(result);
        const title =
          args?.status === "submitted"
            ? args?.employee
              ? `${args.employee}: awaiting approval`
              : "Awaiting your approval"
            : args?.employee
              ? `Reports for ${args.employee}`
              : "Expense reports";
        return (
          <>
            <ToolLine
              label="listReports"
              detail={[args?.employee, args?.status].filter(Boolean).join(", ")}
              result={result}
            />
            {parsed?.reports && parsed.reports.length > 1 ? (
              <ReportTable
                title={title}
                rows={parsed.reports}
                onOpen={(rid) => router.push(skinHref(`reports/${rid}`))}
              />
            ) : null}
          </>
        );
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "getReport",
      description:
        "Read one expense report: line items, totals, cost center, notes and any policy holds.",
      parameters: z.object({
        reportId: z.string().describe("Report id, e.g. EXP-2291."),
      }),
      handler: async ({ reportId }) => {
        const { ok, body } = await call(
          `/reports/${encodeURIComponent(id(reportId))}`,
        );
        return ok
          ? JSON.stringify(agentReport(body as unknown as ExpenseReport))
          : refusal(body, id(reportId));
      },
      render: ({ args, result }) => {
        const report = parseJson<ReportView>(result);
        return (
          <>
            <ToolLine
              label="getReport"
              detail={args?.reportId}
              result={result}
            />
            {report && !("error" in report) && report.lines ? (
              <ReportCard
                report={report}
                onOpen={(rid) => router.push(skinHref(`reports/${rid}`))}
              />
            ) : null}
          </>
        );
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "ledgerlineApi",
      description: LEDGERLINE_API_DESCRIPTION,
      parameters: z.object({
        method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
        path: z.string().describe("e.g. /reports/EXP-2291"),
        // A JSON string: a free-form object schema reaches the model as an
        // empty object, and every body would arrive as {}.
        body: z
          .string()
          .optional()
          .describe(
            'JSON body as a string, for endpoints that take one, e.g. {"name": "value"}.',
          ),
      }),
      handler: async ({ method, path, body }) => {
        const { body: out } = await post("/agent/api", { method, path, body });
        await refresh();
        // Keep a refusal's { error } at the top level so the tool line shows it.
        const res = out as { status?: number; body?: Record<string, unknown> };
        return JSON.stringify(
          res.body && "error" in res.body
            ? { ...res.body, status: res.status }
            : res,
        );
      },
      render: ({ args, result }) => (
        <ToolLine
          label="ledgerlineApi"
          detail={[args?.method, args?.path].filter(Boolean).join(" ")}
          result={result}
        />
      ),
    },
    [],
  );

  useFrontendTool(
    {
      name: "searchPolicies",
      description:
        "Search Ledgerline's policy library (travel and expense policy, approvals handbook, budget guide).",
      parameters: z.object({ query: z.string() }),
      handler: async ({ query }) => {
        const { body } = await call(`/policies?q=${encodeURIComponent(query)}`);
        return JSON.stringify(
          agentPolicies(
            body as unknown as {
              query: string;
              results: PolicyDoc[];
              note?: string;
            },
          ),
        );
      },
      render: ({ args, result }) => (
        <ToolLine
          label="searchPolicies"
          detail={args?.query ? `"${args.query}"` : undefined}
          result={result}
        />
      ),
    },
    [],
  );

  useFrontendTool(
    {
      name: "openReport",
      description: "Take the user to one expense report's page in Ledgerline.",
      parameters: z.object({ reportId: z.string() }),
      handler: async ({ reportId }) => {
        const rid = id(reportId);
        if (!ledgerRef.current.reports.some((r) => r.id === rid)) {
          return JSON.stringify({
            error: "NOT_FOUND",
            message: `There is no expense report ${rid}.`,
          });
        }
        router.push(skinHref(`reports/${rid}`));
        return JSON.stringify({ opened: rid });
      },
      render: ({ args, result }) => (
        <ToolLine label="openReport" detail={args?.reportId} result={result} />
      ),
    },
    [],
  );

  useFrontendTool(
    {
      name: "openCardClose",
      description:
        "Take the user to the Card close board for a card (Visa last four digits, e.g. 4417), where its exceptions are cleared by hand.",
      parameters: z.object({ card: z.string().optional() }),
      handler: async ({ card }) => {
        const c = card
          ? `card_${String(card).replace(/\D/g, "").slice(-4)}`
          : "";
        router.push(`${skinHref("reconciliation")}${c ? `?card=${c}` : ""}`);
        return JSON.stringify({ opened: "card close", card: c || undefined });
      },
      render: ({ args, result }) => (
        <ToolLine label="openCardClose" detail={args?.card} result={result} />
      ),
    },
    [],
  );

  // Generative UI: the close at a glance, drawn when the agent starts a card close.
  useFrontendTool(
    {
      name: "showCloseStatus",
      description:
        "Draw the month-end close status card for one card in the chat: its charges, the receipts Ledgerline auto-matched, and each exception with whether it still needs a person. Call it first, before any other step, whenever you start closing out a card's month. The card follows the close live, so never repeat its contents in text.",
      parameters: z.object({
        card: z
          .string()
          .describe("The card's id or Visa last four digits, e.g. 4417."),
      }),
      handler: async ({ card }) => {
        const last4 = String(card ?? "")
          .replace(/\D/g, "")
          .slice(-4);
        const { ok, body } = await call(
          `/reconciliation/status?card=${encodeURIComponent(last4 || String(card))}`,
        );
        if (!ok)
          return JSON.stringify({
            error: body.error ?? "NOT_FOUND",
            message: body.message ?? `There is no card ${card}.`,
          });
        return JSON.stringify({
          component: "CloseStatusCard",
          props: body,
          shownToUser:
            "The close status card is on screen and updates as the close moves. Do not repeat it; go on with the close.",
        });
      },
      render: ({ args, result }) => {
        const parsed = parseJson<{
          props?: CloseStatusView;
          error?: string;
        }>(result);
        if (!parsed?.props)
          return (
            <ToolLine
              label="showCloseStatus"
              detail={args?.card}
              result={result}
            />
          );
        return <LiveCloseStatus initial={parsed.props} />;
      },
    },
    [],
  );

  // Handing a month-end close to the person: only their Confirm validates and closes.
  useHumanInTheLoop(
    {
      name: "reviewMatches",
      description:
        "Hand the close you prepared in a reconciliation session to the user: opens the review card in the chat, every auto-matched receipt and cleared exception. You never close a period yourself; only the user's Confirm in the card validates and closes it. Do not ask in chat first.",
      parameters: z.object({ sessionId: z.string() }),
      render: ({ args, respond, result, status }) => (
        <ReviewTool
          // Args stream in: only a call that is executing has the whole id.
          sessionId={
            status === "inProgress" ? "" : String(args?.sessionId ?? "")
          }
          result={result}
          respond={respond}
          onEdit={(card) =>
            router.push(`${skinHref("reconciliation")}?card=${card}`)
          }
        />
      ),
    },
    [],
  );

  return <LearnedSkillTools />;
}

/** The in-app half of `reviewMatches`: load the session, draw the card, answer once. */
function ReviewTool({
  sessionId,
  result,
  respond,
  onEdit,
}: {
  sessionId: string;
  result: unknown;
  respond?: (out: string) => Promise<unknown> | void;
  onEdit: (cardId: string) => void;
}) {
  const [view, setView] = useState<ReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorBody, setErrorBody] = useState<Record<string, unknown> | null>(
    null,
  );
  const answered = typeof result === "string";
  const settled = answered
    ? parseJson<ReviewOutcome & { error?: string }>(result)
    : null;
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    void fetch(
      `${API}/reconciliation/sessions/${encodeURIComponent(sessionId)}/review`,
      {
        cache: "no-store",
      },
    )
      .then(async (r) => {
        const body = (await r.json()) as ReviewView & {
          message?: string;
          error?: string;
          valid?: number;
          total?: number;
        };
        if (!alive) return;
        if (r.ok) setView(body);
        else {
          setError(body.message ?? "That session could not be loaded.");
          setErrorBody({
            error: body.error ?? "SESSION_NOT_FOUND",
            message: body.message,
            valid: body.valid,
            total: body.total,
          });
        }
      })
      .catch(() => alive && setError("That session could not be loaded."));
    return () => {
      alive = false;
    };
  }, [sessionId]);
  // A bad session id answers the agent at once rather than leaving it waiting.
  const sentError = useRef(false);
  useEffect(() => {
    if (!error || answered || sentError.current || !respond) return;
    sentError.current = true;
    void respond(
      JSON.stringify(
        errorBody ?? { error: "SESSION_NOT_FOUND", message: error },
      ),
    );
  }, [error, errorBody, answered, respond]);
  if (error)
    return (
      <ToolLine
        label="reviewMatches"
        detail={sessionId}
        result={JSON.stringify(errorBody ?? { error: "SESSION_NOT_FOUND" })}
      />
    );
  if (!view)
    return (
      <ToolLine label="reviewMatches" detail={sessionId} result={undefined} />
    );
  return (
    <ReviewMatchesCard
      view={view}
      outcome={
        settled
          ? settled.error === "NOT_CONFIRMED"
            ? "edit"
            : { ok: !settled.error, summary: settled.summary ?? "" }
          : null
      }
      confirm={async () => {
        const r = await fetch(
          `${API}/reconciliation/sessions/${encodeURIComponent(sessionId)}/confirm`,
          { method: "POST" },
        );
        const o = (await r.json().catch(() => ({}))) as ReviewOutcome & {
          message?: string;
        };
        return r.ok
          ? o
          : {
              ok: false,
              summary: o.message ?? "The matches could not be confirmed.",
            };
      }}
      onSettle={async (o) => {
        await respond?.(
          JSON.stringify(
            o.ok
              ? {
                  closed: true,
                  summary: o.summary,
                  // What the person saw and confirmed, so the trajectory can redraw the card.
                  component: "ReviewMatchesCard",
                  props: reviewSnapshot(view, o),
                }
              : { error: "VALIDATION_FAILED", message: o.summary },
          ),
        );
      }}
      onEdit={() => {
        void respond?.(
          JSON.stringify({
            error: "NOT_CONFIRMED",
            message:
              "The user chose to edit the matches on the Card close board. Nothing was closed.",
          }),
        );
        onEdit(view.card.id);
      }}
    />
  );
}

/** The status card, following the close while the chat is open (up to five minutes). */
function LiveCloseStatus({ initial }: { initial: CloseStatusView }) {
  const [view, setView] = useState(initial);
  useEffect(() => {
    if (initial.closed) return;
    let alive = true;
    const started = Date.now();
    const tick = async () => {
      const r = await fetch(
        `${API}/reconciliation/status?card=${encodeURIComponent(initial.card.id)}`,
        { cache: "no-store" },
      ).catch(() => null);
      if (!alive || !r?.ok) return;
      const next = (await r.json()) as CloseStatusView;
      if (alive) setView(next);
      if (next.closed) alive = false;
    };
    const timer = setInterval(() => {
      if (!alive || Date.now() - started > 300_000) {
        clearInterval(timer);
        return;
      }
      void tick();
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [initial]);
  return <CloseStatusCard view={view} />;
}

/** The review card as recorded for the trajectory: no receipt images or line items. */
function reviewSnapshot(view: ReviewView, outcome: ReviewOutcome) {
  return {
    kind: view.kind,
    sessionId: view.sessionId,
    card: view.card,
    pairs: view.pairs.map((p) => ({
      transaction: p.transaction,
      exception: p.exception ?? null,
      resolution: p.resolution ?? null,
      receipts: p.receipts.map((r) => ({
        id: r.id,
        merchant: r.merchant,
        date: r.date,
        total: r.total,
        currency: r.currency,
      })),
      adjustment: p.adjustment,
    })),
    outcome: { ok: outcome.ok, summary: outcome.summary },
  };
}
