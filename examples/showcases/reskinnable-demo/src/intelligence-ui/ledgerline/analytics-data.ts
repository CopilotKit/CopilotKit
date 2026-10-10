/**
 * Product Analytics and Product Insights for Ledgerline: a seeded,
 * deterministic week of runtime activity, tool usage and reliability across
 * the Ledgerline agent in the app and in ChatGPT over MCP. The month-end close
 * figures are NOT here: the Analytics screen reads them live from
 * /api/ledgerline/v1/reconciliation/status, the same source as the Card close
 * board, so they move with the demo.
 *
 * Days are the seven days ending today, like the seeded trajectory history.
 */

export const ANALYTICS_RANGE = "Last 7 days";

export interface DayActivity {
  /** ISO date, e.g. "2026-10-03". */
  readonly day: string;
  /** Short axis label, e.g. "Oct 3". */
  readonly label: string;
  readonly inApp: number;
  readonly chatgpt: number;
  readonly activeUsers: number;
}

/**
 * In-app events, ChatGPT events and active users, oldest day first. Finance
 * work is a weekday rhythm, so a weekend day carries a fraction of the volume.
 */
const WEEK: readonly (readonly [number, number, number])[] = [
  [9_420, 1_310, 712],
  [10_180, 1_460, 768],
  [11_050, 1_590, 802],
  [11_870, 1_720, 841],
  [12_640, 1_905, 893],
  [13_220, 2_010, 921],
  [14_310, 2_240, 958],
];
const WEEKEND = 0.27;

function weekDays(today = new Date()): DayActivity[] {
  return WEEK.map(([inApp, chatgpt, activeUsers], i) => {
    const d = new Date(today);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (WEEK.length - 1 - i));
    const f = d.getDay() === 0 || d.getDay() === 6 ? WEEKEND : 1;
    return {
      day: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      inApp: Math.round(inApp * f),
      chatgpt: Math.round(chatgpt * f),
      activeUsers: Math.round(activeUsers * f),
    };
  });
}

export const ACTIVITY: readonly DayActivity[] = weekDays();

export const ACTIVITY_TOTALS = {
  runtimeEvents: ACTIVITY.reduce((n, d) => n + d.inApp + d.chatgpt, 0),
  /** Distinct finance users across the week (a person active on several days counts once). */
  activeUsers: 1_486,
  agentRuns: 6_934,
  threads: 2_217,
  /** Change against the week before. */
  trend: {
    runtimeEvents: "+18.4%",
    activeUsers: "+6.1%",
    agentRuns: "+22.7%",
    threads: "+12.9%",
  },
};

export type ToolSource = "In-app agent" | "Ledgerline MCP app (ChatGPT)";

export interface ToolUsage {
  readonly name: string;
  readonly source: ToolSource;
  readonly calls: number;
  readonly p50Ms: number;
  /** 0 to 1. */
  readonly errorRate: number;
}

/** Tool calls this week, by the Ledgerline agent's real tool names. */
export const TOOL_USAGE: readonly ToolUsage[] = [
  {
    name: "ledgerlineApi",
    source: "In-app agent",
    calls: 4_812,
    p50Ms: 96,
    errorRate: 0.094,
  },
  {
    name: "listReports",
    source: "In-app agent",
    calls: 2_436,
    p50Ms: 54,
    errorRate: 0.002,
  },
  {
    name: "getReport",
    source: "In-app agent",
    calls: 2_118,
    p50Ms: 47,
    errorRate: 0.004,
  },
  {
    name: "showCloseStatus",
    source: "In-app agent",
    calls: 1_384,
    p50Ms: 61,
    errorRate: 0.003,
  },
  {
    name: "ledgerlineApi",
    source: "Ledgerline MCP app (ChatGPT)",
    calls: 1_206,
    p50Ms: 118,
    errorRate: 0.112,
  },
  {
    name: "searchPolicies",
    source: "In-app agent",
    calls: 1_042,
    p50Ms: 72,
    errorRate: 0.001,
  },
  {
    name: "getReport",
    source: "Ledgerline MCP app (ChatGPT)",
    calls: 968,
    p50Ms: 63,
    errorRate: 0.006,
  },
  {
    name: "listReports",
    source: "Ledgerline MCP app (ChatGPT)",
    calls: 904,
    p50Ms: 69,
    errorRate: 0.003,
  },
  {
    name: "reviewMatches",
    source: "In-app agent",
    calls: 612,
    p50Ms: 38_400,
    errorRate: 0.021,
  },
  {
    name: "openReport",
    source: "In-app agent",
    calls: 588,
    p50Ms: 22,
    errorRate: 0.002,
  },
  {
    name: "openCardClose",
    source: "In-app agent",
    calls: 431,
    p50Ms: 19,
    errorRate: 0,
  },
  {
    name: "loadLearnedSkill",
    source: "In-app agent",
    calls: 402,
    p50Ms: 33,
    errorRate: 0,
  },
  {
    name: "reviewMatches",
    source: "Ledgerline MCP app (ChatGPT)",
    calls: 214,
    p50Ms: 88,
    errorRate: 0.037,
  },
  {
    name: "confirmMatches",
    source: "Ledgerline MCP app (ChatGPT)",
    calls: 176,
    p50Ms: 141,
    errorRate: 0.011,
  },
  {
    name: "loadLearnedSkill",
    source: "Ledgerline MCP app (ChatGPT)",
    calls: 133,
    p50Ms: 29,
    errorRate: 0,
  },
  {
    name: "addNote",
    source: "Ledgerline MCP app (ChatGPT)",
    calls: 97,
    p50Ms: 58,
    errorRate: 0.004,
  },
  {
    name: "searchPolicies",
    source: "Ledgerline MCP app (ChatGPT)",
    calls: 81,
    p50Ms: 77,
    errorRate: 0,
  },
];

export const TOOL_CALLS_TOTAL = TOOL_USAGE.reduce((n, t) => n + t.calls, 0);

export const RELIABILITY = {
  runSuccessRate: 0.917,
  toolErrorRate:
    TOOL_USAGE.reduce((n, t) => n + t.calls * t.errorRate, 0) /
    TOOL_CALLS_TOTAL,
  p95RunLatencyMs: 7_400,
  refusals: [
    {
      code: "PERIOD_SOFT_LOCKED",
      count: 212,
      meaning:
        "A charge coded to the wrong account; coding is locked for the preliminary close",
    },
    {
      code: "ALLOCATION_REQUIRED",
      count: 168,
      meaning:
        "A charge shared across departments is an allocation, not a field on the charge",
    },
    {
      code: "RECEIPT_REQUIRED",
      count: 131,
      meaning:
        "A charge with no receipt on file needs a missing-receipt affidavit",
    },
    {
      code: "NOT_EDITABLE",
      count: 97,
      meaning: "Whether a charge is personal is not a field on the charge",
    },
    {
      code: "HUMAN_CONFIRMATION_REQUIRED",
      count: 64,
      meaning:
        "Closing a period or paying a report needs the cardholder's confirmation",
    },
  ],
};

/** Month-end close across Ledgerline customers, before the live cards. */
export const CLOSE_BASELINE = {
  medianDaysToClose: "2.4 days",
  medianTrend: "-0.3 days vs August",
};

export type InsightKind = "friction" | "opportunity" | "win";

/** Which of today's captured trajectories an insight cites, read live. */
export type LiveCitation = "failed-close" | "replayed-close";

export interface ProductInsight {
  readonly id: string;
  readonly kind: InsightKind;
  readonly title: string;
  readonly finding: string;
  readonly metric: {
    readonly label: string;
    readonly value: string;
    readonly trend: string;
    readonly direction: "up" | "down" | "flat";
    readonly tone: "positive" | "negative" | "neutral";
  };
  readonly affectedUsers: number;
  readonly trajectories: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly live?: readonly LiveCitation[];
  readonly skill?: {
    readonly name: string;
    readonly status: "Published" | "Proposed";
    /** Read live from Automatic Learning: shown only once it exists there. */
    readonly live?: boolean;
  };
  readonly detectedAt: string;
}

export const PRODUCT_INSIGHTS: readonly ProductInsight[] = [
  {
    id: "pin_01",
    kind: "friction",
    title: "Card-close exceptions need a person today",
    finding:
      "When a cardholder asks the agent to close out a month, Ledgerline has already auto-matched the receipts, so what is left are the exceptions: a dinner shared across departments, a charge coded to the wrong account, a personal charge and a charge with no receipt. The agent tried to edit each charge and was refused (ALLOCATION_REQUIRED, PERIOD_SOFT_LOCKED, NOT_EDITABLE, RECEIPT_REQUIRED). The cardholder then cleared all four on the Card close board: an allocation split by attendees, a reclass entry, a payroll repayment and a signed affidavit. That path is the recipe the agent was missing.",
    metric: {
      label: "Exceptions cleared by hand",
      value: "608",
      trend: "+12% vs August",
      direction: "up",
      tone: "negative",
    },
    affectedUsers: 214,
    trajectories: [],
    live: ["failed-close", "replayed-close"],
    skill: { name: "close-card-exceptions", status: "Proposed", live: true },
    detectedAt: "Today",
  },
  {
    id: "pin_02",
    kind: "win",
    title: "Closes the agent prepares are confirmed in one click",
    finding:
      "When the agent clears the exceptions and hands over the review card, cardholders confirm and close the month without opening the Card close board 93% of the time. Only the person's Confirm closes a period, so the agent never closes anything on its own.",
    metric: {
      label: "Review cards confirmed",
      value: "93.4%",
      trend: "+4.8 pts vs August",
      direction: "up",
      tone: "positive",
    },
    affectedUsers: 176,
    trajectories: [],
    live: ["replayed-close"],
    detectedAt: "Today",
  },
  {
    id: "pin_03",
    kind: "friction",
    title: "Approval delegates are set by hand in Approval settings",
    finding:
      "Approvers going on leave ask the agent to have a colleague approve for them. The agent tried to write a delegate onto the person record (FIELD_NOT_WRITABLE); people then add a dated delegate in Settings, which ends on its own.",
    metric: {
      label: "Delegations set by hand",
      value: "23",
      trend: "-9 vs last week",
      direction: "down",
      tone: "positive",
    },
    affectedUsers: 23,
    trajectories: [
      { id: "trj_s9k2m4", label: "Maya Chen, delegate while on leave" },
    ],
    skill: { name: "set-approval-delegate", status: "Published" },
    detectedAt: "13 days ago",
  },
  {
    id: "pin_04",
    kind: "opportunity",
    title: "Event per diems are raised on the Policies page",
    finding:
      "Before an offsite or a kickoff, admins ask the agent to raise the per diem. The policy tools are read-only for the agent, so people add a dated event override for the team. A proposed skill files the override instead of touching the default policy.",
    metric: {
      label: "Overrides added by hand",
      value: "11",
      trend: "+4 vs last week",
      direction: "up",
      tone: "negative",
    },
    affectedUsers: 9,
    trajectories: [
      { id: "trj_s3p6n8", label: "Maya Chen, Austin kickoff per diem" },
    ],
    skill: { name: "per-diem-event-override", status: "Proposed" },
    detectedAt: "4 days ago",
  },
  {
    id: "pin_05",
    kind: "win",
    title: "Report questions in ChatGPT answer with Ledgerline's own card",
    finding:
      "Approvers who ask about a report in ChatGPT get the same report card as the in-app chat, drawn by Ledgerline's MCP app: the employee, the total, each line's cost center and the policy status. No one has to switch to the web app to read it.",
    metric: {
      label: "Report cards shown in ChatGPT",
      value: "968",
      trend: "+31% vs last week",
      direction: "up",
      tone: "positive",
    },
    affectedUsers: 302,
    trajectories: [
      { id: "trj_s5h4c9", label: "Maya Chen, reports waiting for approval" },
    ],
    detectedAt: "8 days ago",
  },
  {
    id: "pin_06",
    kind: "opportunity",
    title: "New hires' card limits are set on Card controls",
    finding:
      "Onboarding a new hire through the agent creates the person, then fails to set a card limit, because a limit is a card control and not a field on the person. Admins finish on the person's Card controls panel.",
    metric: {
      label: "Limits set by hand after onboarding",
      value: "17",
      trend: "flat vs last week",
      direction: "flat",
      tone: "neutral",
    },
    affectedUsers: 12,
    trajectories: [
      { id: "trj_s7m3x2", label: "Jordan Patel, Nina Alvarez's $2,000 limit" },
    ],
    skill: { name: "set-card-limit", status: "Published" },
    detectedAt: "11 days ago",
  },
];
