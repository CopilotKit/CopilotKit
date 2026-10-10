/**
 * Which of Ledgerline's generative UI a recorded tool call drew, read from the
 * call itself (`TraceStep.ui` when the step carries it, else its name, surface
 * and result), so the trajectory view can render the app's own component.
 *
 * In the app (`src/skins/ledgerline/tools.tsx`):
 *  - `showCloseStatus` draws `CloseStatusCard` (the result carries
 *    `{ component, props }`);
 *  - a confirmed `reviewMatches` draws `ReviewMatchesCard` (same shape);
 *  - `getReport` draws `ReportCard`, `listReports` with more than one row draws
 *    `ReportTable`, and a loaded learned skill draws `LearnedSkillCard`.
 *
 * In ChatGPT, `getReport` and `reviewMatches` are bound to Ledgerline's MCP App
 * (`ui://ledgerline/ledgerline-app.html`), so they draw `LedgerlineAppWidget`
 * from the tool's structuredContent. A refused call draws nothing.
 */
import type {
  GenUiRecord,
  TraceStep,
  TrajectoryDetail,
} from "../data/contract";

const LOADED = "LOADED learned skill ";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The report table's title, as `listReports`' render titles it. */
function listTitle(args: Obj | undefined): string {
  const employee = typeof args?.employee === "string" ? args.employee : "";
  if (args?.status === "submitted")
    return employee
      ? `${employee}: awaiting approval`
      : "Awaiting your approval";
  return employee ? `Reports for ${employee}` : "Expense reports";
}

/**
 * The person's Confirm in ChatGPT's review card arrives as a later
 * `confirmMatches` call from the card; the card then shows the month closed.
 */
function confirmedLater(
  step: TraceStep,
  trace: readonly TraceStep[],
): { ok: boolean; summary: string } | null {
  const sessionId = step.args?.sessionId;
  const confirm = trace.find(
    (x) =>
      x.name === "confirmMatches" &&
      x.at >= step.at &&
      x.status !== "error" &&
      x.args?.sessionId === sessionId &&
      isObj(x.result) &&
      x.result.closed === true,
  );
  return confirm && isObj(confirm.result)
    ? { ok: true, summary: String(confirm.result.summary ?? "") }
    : null;
}

export function genUiOf(
  step: TraceStep,
  surface: "in_app" | "chatgpt",
  trace: readonly TraceStep[] = [],
): GenUiRecord | null {
  if (step.kind !== "tool.call" || step.status === "error") return null;
  if (step.ui) return step.ui;
  const r = step.result;
  if (surface === "chatgpt") {
    if (
      (step.name === "getReport" || step.name === "reviewMatches") &&
      isObj(r) &&
      (r.kind === "report-card" || r.kind === "review-card")
    ) {
      const { note: _note, ...view } = r;
      void _note;
      const outcome =
        r.kind === "review-card" ? confirmedLater(step, trace) : null;
      return {
        component: "LedgerlineAppWidget",
        props: {
          tool: step.name,
          structuredContent: outcome ? { ...view, outcome } : view,
        },
      };
    }
    return null;
  }
  if (isObj(r) && typeof r.component === "string" && isObj(r.props))
    return { component: r.component, props: r.props };
  if (step.name === "getReport" && isObj(r) && Array.isArray(r.lines))
    return { component: "ReportCard", props: { report: r } };
  if (
    step.name === "listReports" &&
    isObj(r) &&
    Array.isArray(r.reports) &&
    r.reports.length > 1
  )
    return {
      component: "ReportTable",
      props: { title: listTitle(step.args), rows: r.reports },
    };
  if (
    step.name === "loadLearnedSkill" &&
    typeof r === "string" &&
    r.startsWith(LOADED)
  )
    return {
      component: "LearnedSkillCard",
      props: {
        name: typeof step.args?.name === "string" ? step.args.name : null,
        result: r,
      },
    };
  return null;
}

/** The trajectory with every step that drew UI marked with it (`TraceStep.ui`). */
export function withGenUi(detail: TrajectoryDetail): TrajectoryDetail {
  return {
    ...detail,
    threads: detail.threads.map((th) => ({
      ...th,
      agentTrace: th.agentTrace.map((step) => {
        const ui = genUiOf(step, th.surface, th.agentTrace);
        return ui ? { ...step, ui } : step;
      }),
    })),
  };
}

/** One step of a trajectory by its `<threadId>:<stepId>` reference. */
export function findStep(
  detail: TrajectoryDetail,
  ref: string,
): {
  step: TraceStep;
  surface: "in_app" | "chatgpt";
  trace: readonly TraceStep[];
} | null {
  for (const th of detail.threads)
    for (const step of th.agentTrace)
      if (`${th.threadId}:${step.id}` === ref)
        return { step, surface: th.surface, trace: th.agentTrace };
  return null;
}
