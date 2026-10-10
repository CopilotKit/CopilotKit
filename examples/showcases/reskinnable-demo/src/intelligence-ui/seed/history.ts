/**
 * Seeded Ledgerline history for the Intelligence screens: two weeks of earlier
 * trajectories, analyses, Insights, Skills, eval candidates, a fine-tune export
 * and two cases already exported to the eval platform. Static, so it is "restored"
 * by every /reset, and dated days before today so today's run is always newest.
 *
 * It never covers today's case (month-end card reconciliation): nothing here is
 * about receipts, card transactions, matching, FX or closing a period, and none
 * of these Skills reach the Ledgerline agent (they
 * live only in this overlay), so the in-app and ChatGPT attempts still fail.
 */
import type {
  DemoInsight,
  GenUiRecord,
  DemoSkill,
  EvalCandidate,
  TraceStep,
  TrajectoryDetail,
  TrajectoryEvent,
  TrajectoryOutcome,
  TrajectorySummary,
} from "../data/contract";

const DAY = 86_400_000;
/** Today at 00:00 local time; seeds sit whole days before it. */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
const at = (daysAgo: number, hour: number, minute = 0): number =>
  startOfToday() - daysAgo * DAY + hour * 3_600_000 + minute * 60_000;

const MAYA = { id: "u_maya", name: "Maya Chen" };
const JORDAN = { id: "u_jordan", name: "Jordan Patel" };

interface Spec {
  readonly id: string;
  readonly title: string;
  readonly user: { id: string; name: string };
  readonly start: number;
  readonly outcome: TrajectoryOutcome;
  readonly surface: "in_app" | "chatgpt";
  readonly ask: string;
  readonly reply: string;
  /**
   * Tool calls as [name, args, result, status, ui?]: `ui` is the generative UI
   * the call drew (rendered by the trajectory view with Ledgerline's own
   * component; a `reportId` prop is read from the ledger).
   */
  readonly steps: readonly (
    | readonly [
        string,
        Record<string, unknown>,
        unknown,
        "ok" | "error",
        GenUiRecord?,
      ]
    | readonly ["think", string]
  )[];
  /** Manual path: [name, value] pairs recorded as AG-UI CUSTOM events. */
  readonly manual?: readonly (readonly [string, Record<string, unknown>])[];
  readonly missing?: {
    readonly label: string;
    readonly why: string;
    readonly at: number;
  };
}

function build(spec: Spec): TrajectoryDetail {
  const threadId = `thr_${spec.id.replace(/^trj_/, "")}`;
  let t = spec.start + 4_000;
  const agentTrace: TraceStep[] = spec.steps.map((s, i) => {
    t += 2_000 + ((i * 917) % 1_800);
    if (s[0] === "think")
      return { id: `s${i + 1}`, kind: "thinking", text: String(s[1]), at: t };
    const [name, args, result, status, ui] = s as readonly [
      string,
      Record<string, unknown>,
      unknown,
      "ok" | "error",
      GenUiRecord?,
    ];
    return {
      id: `s${i + 1}`,
      kind: "tool.call",
      name,
      args,
      result,
      status,
      durationMs: 120 + ((i * 331) % 400),
      at: t,
      ...(ui ? { ui } : {}),
    };
  });
  const replyAt = t + 3_000;
  const events: TrajectoryEvent[] = [];
  let pos = 0;
  const push = (ts: number, name: string, value: Record<string, unknown>) => {
    pos += 1;
    events.push({
      eventId: `evt_${spec.id.slice(-4)}${String(pos).padStart(2, "0")}`,
      trajectoryId: spec.id,
      position: pos,
      persistedAt: ts + 400,
      event: { type: "CUSTOM", name, timestamp: ts, value },
    });
  };
  push(spec.start, "page", { route: "/overview", title: "Overview" });
  if (spec.surface === "in_app")
    push(spec.start + 1_000, "thread.linked", { threadId, surface: "in_app" });
  let mt = replyAt + 20_000;
  for (const [name, value] of spec.manual ?? []) {
    mt += 3_000 + ((pos * 1_337) % 6_000);
    push(mt, name, value);
  }
  const missingContext = spec.missing
    ? [
        {
          eventId:
            events.find((e) => e.event.name === "screen.context")?.eventId ??
            events[0].eventId,
          label: spec.missing.label,
          why: spec.missing.why,
        },
      ]
    : [];
  const last = Math.max(replyAt, ...events.map((e) => e.event.timestamp));
  const trajectory: TrajectorySummary = {
    trajectoryId: spec.id,
    projectId: "ledgerline-demo",
    title: spec.title,
    user: spec.user,
    createdAt: spec.start,
    firstEventAt: spec.start,
    lastEventAt: last,
    outcome: spec.outcome,
    surfaces: spec.manual?.length ? [spec.surface, "manual"] : [spec.surface],
    threadIds: [threadId],
    eventCount: events.length,
  };
  return {
    trajectory,
    threads: [
      {
        threadId,
        surface: spec.surface,
        linkStrength: spec.surface === "in_app" ? "strong" : "weak",
        outcome: spec.outcome === "agent_succeeded" ? "succeeded" : "failed",
        messages: [
          {
            id: `${threadId}_m1`,
            role: "user",
            text: spec.ask,
            at: spec.start + 3_000,
          },
          {
            id: `${threadId}_m2`,
            role: "assistant",
            text: spec.reply,
            at: replyAt,
          },
        ],
        agentTrace,
      },
    ],
    events,
    missingContext,
  };
}

/** The report card `getReport` draws, in the app or (over MCP) in ChatGPT. */
const reportCard = (reportId: string): GenUiRecord => ({
  component: "ReportCard",
  props: { reportId },
});
const reportApp = (reportId: string): GenUiRecord => ({
  component: "LedgerlineAppWidget",
  props: { tool: "getReport", reportId },
});

const click = (action: string, route = "/reports/[id]", role = "button") =>
  ["click", { action, role, tag: "button", route, threadId: null }] as const;
const screen = (
  label: string,
  fields: Record<string, string>,
  route = "/reports/[id]",
) => ["screen.context", { label, fields, route }] as const;
const net = (method: string, route: string, summary: string, status = 200) =>
  [
    "network",
    { method, route, status, durationMs: 60 + (summary.length % 90), summary },
  ] as const;

const SPECS: Spec[] = [
  {
    id: "trj_s9k2m4",
    title: "Set Maya's approval delegate while she is on leave",
    user: MAYA,
    start: at(13, 10, 12),
    outcome: "agent_failed_user_completed",
    surface: "in_app",
    ask: "I'm out Oct 6 to 10. Have Jordan approve my team's reports while I'm away.",
    reply:
      "I couldn't set a delegate: none of my tools change approval settings. Jordan would need to be added by an admin.",
    steps: [
      [
        "getPerson",
        { name: "Jordan Patel" },
        { id: "u_jordan", role: "Finance Operations", canApprove: true },
        "ok",
      ],
      [
        "think",
        "Delegation lives in approval settings, and I don't have a settings tool.",
      ],
      [
        "updatePerson",
        { id: "u_maya", delegate: "u_jordan" },
        { error: "FIELD_NOT_WRITABLE", field: "delegate" },
        "error",
      ],
    ],
    manual: [
      screen(
        "Approval settings",
        { Delegate: "None", Dates: "Not set", Action: "Add delegate" },
        "/settings/approvals",
      ),
      click("Add delegate", "/settings/approvals"),
      net(
        "POST",
        "/api/ledgerline/v1/approvals/delegations",
        "Jordan Patel delegated Oct 6 to Oct 10",
      ),
      [
        "approvals.delegate_set",
        {
          from: "u_maya",
          to: "u_jordan",
          start: "2026-10-06",
          end: "2026-10-10",
        },
      ],
    ],
    missing: {
      label:
        "Approval settings: delegates are set with dates in Settings, not on the person",
      why: "Shown on screen; the agent has no approval-settings tool",
      at: 0,
    },
  },
  {
    id: "trj_s8f1q7",
    title: "List Daniel Okafor's open expense reports",
    user: MAYA,
    start: at(12, 9, 41),
    outcome: "agent_succeeded",
    surface: "in_app",
    ask: "What does Daniel Okafor still have open?",
    reply:
      "Daniel has one open report, **EXP-2288** (client dinner, **$350.60**), submitted Sep 27.",
    steps: [
      [
        "listReports",
        { employee: "Daniel Okafor", status: "submitted" },
        { count: 1, reports: [{ id: "EXP-2288", total: 350.6 }] },
        "ok",
      ],
      [
        "getReport",
        { reportId: "EXP-2288" },
        { id: "EXP-2288", status: "submitted", total: 350.6 },
        "ok",
        reportCard("EXP-2288"),
      ],
    ],
  },
  {
    id: "trj_s7m3x2",
    title: "Onboard Nina Alvarez with a $2,000 card limit",
    user: JORDAN,
    start: at(11, 15, 5),
    outcome: "agent_failed_user_completed",
    surface: "in_app",
    ask: "Nina Alvarez starts Monday in Sales. Add her and give her a $2,000 monthly card limit.",
    reply:
      "I added Nina Alvarez, but I couldn't set a card limit; that isn't something my tools can change.",
    steps: [
      [
        "createPerson",
        { name: "Nina Alvarez", team: "Sales" },
        { id: "u_nina", status: "invited" },
        "ok",
      ],
      [
        "think",
        "The person exists now. A card limit is not a field on the person record.",
      ],
      [
        "updatePerson",
        { id: "u_nina", cardLimit: 2000 },
        { error: "FIELD_NOT_WRITABLE", field: "cardLimit" },
        "error",
      ],
    ],
    manual: [
      screen(
        "Card controls",
        {
          Holder: "Nina Alvarez",
          Limit: "Team default $500",
          Action: "Set monthly limit",
        },
        "/people/[id]",
      ),
      click("Set monthly limit", "/people/[id]"),
      click("Save limit", "/people/[id]"),
      net(
        "PUT",
        "/api/ledgerline/v1/people/[id]/card-controls",
        "Monthly limit $2,000",
      ),
      ["people.card_limit_set", { personId: "u_nina", monthlyLimit: 2000 }],
    ],
    missing: {
      label:
        "Card controls: limits are set on the person's Card controls panel",
      why: "Shown on screen, not available to the agent as a tool",
      at: 0,
    },
  },
  {
    id: "trj_s6d8u1",
    title: "Archive draft reports older than 60 days",
    user: MAYA,
    start: at(9, 11, 20),
    outcome: "agent_failed_user_completed",
    surface: "chatgpt",
    ask: "Clean up Ledgerline: archive every draft report older than 60 days.",
    reply:
      "I found 14 old drafts, but I can only delete reports, not archive them, so I left them alone.",
    steps: [
      [
        "listReports",
        { status: "draft", olderThanDays: 60 },
        { count: 14 },
        "ok",
      ],
      [
        "deleteReport",
        { reportId: "EXP-2104" },
        { error: "DELETE_NOT_ALLOWED", hint: "archive instead" },
        "error",
      ],
    ],
    manual: [
      screen(
        "Drafts",
        {
          Selected: "14 drafts older than 60 days",
          Action: "Archive selected",
        },
        "/reports",
      ),
      click("Archive selected", "/reports"),
      net("POST", "/api/ledgerline/v1/reports/archive", "14 drafts archived"),
      ["reports.archived", { count: 14, olderThanDays: 60 }],
    ],
    missing: {
      label:
        "Drafts view: old drafts are archived in bulk from the Drafts filter",
      why: "Shown on screen; ChatGPT's tools can only delete",
      at: 0,
    },
  },
  {
    id: "trj_s5h4c9",
    title: "Which reports are waiting for my approval?",
    user: MAYA,
    start: at(8, 8, 55),
    outcome: "agent_succeeded",
    surface: "chatgpt",
    ask: "Which Ledgerline reports are waiting for my approval?",
    reply:
      "Eleven reports are waiting for you, $9,412.30 in total. The oldest is Sofia Lindqvist's Lisbon trip, shown in the Ledgerline card.",
    steps: [
      [
        "listReports",
        { status: "submitted" },
        { count: 11, total: 9412.3 },
        "ok",
      ],
      [
        "getReport",
        { reportId: "EXP-2295" },
        { id: "EXP-2295", kind: "report-card", total: 1731 },
        "ok",
        reportApp("EXP-2295"),
      ],
    ],
  },
  {
    id: "trj_s4w7b3",
    title: "Summarize Sofia Lindqvist's Lisbon conference trip",
    user: JORDAN,
    start: at(6, 14, 30),
    outcome: "agent_succeeded",
    surface: "in_app",
    ask: "Give me a one-line summary of Sofia Lindqvist's Lisbon trip report.",
    reply:
      "**EXP-2295**: Lisbon design conference, Sep 14 to 17, **$1,731.00** across 3 lines.",
    steps: [
      [
        "getReport",
        { reportId: "EXP-2295" },
        { id: "EXP-2295", lines: 3, total: 1731 },
        "ok",
        reportCard("EXP-2295"),
      ],
    ],
  },
  {
    id: "trj_s3p6n8",
    title: "Raise the Sales per diem for the Austin kickoff",
    user: MAYA,
    start: at(4, 16, 2),
    outcome: "agent_failed_user_completed",
    surface: "in_app",
    ask: "Sales is in Austin for kickoff next week. Raise their per diem to $95 for those days.",
    reply:
      "I couldn't change the per diem; the policy tools are read-only for me.",
    steps: [
      [
        "searchPolicies",
        { query: "per diem" },
        { results: [{ id: "TE-2.1", title: "Meals per diem: $75" }] },
        "ok",
      ],
      [
        "updatePolicy",
        { id: "TE-2.1", amount: 95 },
        { error: "READ_ONLY" },
        "error",
      ],
    ],
    manual: [
      screen(
        "Per diem",
        { Default: "$75", Override: "None", Action: "Add event override" },
        "/policies",
      ),
      click("Add event override", "/policies"),
      net(
        "POST",
        "/api/ledgerline/v1/policies/per-diem/overrides",
        "Sales, Oct 13 to 16, $95",
      ),
      [
        "policy.per_diem_override",
        { team: "Sales", amount: 95, start: "2026-10-13", end: "2026-10-16" },
      ],
    ],
    missing: {
      label:
        "Per diem panel: event overrides are added on the Policies page for set dates",
      why: "Shown on screen, not in any tool the agent can call",
      at: 0,
    },
  },
  {
    id: "trj_s2r5k6",
    title: "Explain why Lucía Romero's booth report is still open",
    user: JORDAN,
    start: at(2, 10, 48),
    outcome: "agent_succeeded",
    surface: "in_app",
    ask: "Why is Lucía Romero's trade show booth report still open?",
    reply:
      "**EXP-2305** is waiting on her manager, R. Alvarez, who has not reviewed it yet.",
    steps: [
      [
        "getReport",
        { reportId: "EXP-2305" },
        { id: "EXP-2305", status: "submitted", approver: "R. Alvarez" },
        "ok",
        reportCard("EXP-2305"),
      ],
    ],
  },
];

export const SEED_DETAILS: readonly TrajectoryDetail[] = SPECS.map(build);
export const SEED_TRAJECTORIES: readonly TrajectorySummary[] = SEED_DETAILS.map(
  (d) => d.trajectory,
);

export function seedDetail(id: string): TrajectoryDetail | null {
  return SEED_DETAILS.find((d) => d.trajectory.trajectoryId === id) ?? null;
}

const ev = (trajectoryId: string, n: number) =>
  `evt_${trajectoryId.slice(-4)}${String(n).padStart(2, "0")}`;

const SEED_INSIGHTS_OLDEST_FIRST: readonly DemoInsight[] = [
  {
    id: "ins_s01",
    title: "Set an approval delegate with dates in Approval settings",
    summary:
      "When an approver is away, people add a dated delegate in Settings, so reports keep moving and the delegation ends on its own. The agent tried to write a delegate onto the person record.",
    evidence: [
      {
        trajectoryId: "trj_s9k2m4",
        eventIds: [ev("trj_s9k2m4", 3)],
        quote: "Approval settings: Delegate none, Add delegate",
      },
      {
        trajectoryId: "trj_s9k2m4",
        eventIds: [ev("trj_s9k2m4", 5), ev("trj_s9k2m4", 6)],
        quote: "POST /approvals/delegations: Jordan Patel, Oct 6 to Oct 10",
      },
    ],
    threadCount: 1,
    createdAt: at(12, 2, 4),
  },
  {
    id: "ins_s02",
    title: "Set a new hire's card limit on Card controls",
    summary:
      "Card limits are a separate card control, set after the person exists. Creating the person and then writing a limit field fails.",
    evidence: [
      {
        trajectoryId: "trj_s7m3x2",
        eventIds: [ev("trj_s7m3x2", 3)],
        quote: "Card controls: team default $500, Set monthly limit",
      },
      {
        trajectoryId: "trj_s7m3x2",
        eventIds: [ev("trj_s7m3x2", 6), ev("trj_s7m3x2", 7)],
        quote: "PUT /people/[id]/card-controls: monthly limit $2,000",
      },
    ],
    threadCount: 1,
    createdAt: at(10, 2, 3),
  },
  {
    id: "ins_s03",
    title: "Archive stale drafts in bulk instead of deleting them",
    summary:
      "Old drafts are archived from the Drafts filter in one step, which keeps them searchable. Deleting is not allowed for reports.",
    evidence: [
      {
        trajectoryId: "trj_s6d8u1",
        eventIds: [ev("trj_s6d8u1", 2)],
        quote: "Drafts: 14 drafts older than 60 days",
      },
      {
        trajectoryId: "trj_s6d8u1",
        eventIds: [ev("trj_s6d8u1", 4), ev("trj_s6d8u1", 5)],
        quote: "POST /reports/archive: 14 drafts archived",
      },
    ],
    threadCount: 1,
    createdAt: at(8, 2, 6),
  },
  {
    id: "ins_s04",
    title: "Raise a per diem for an event with a dated override",
    summary:
      "For an offsite or kickoff, people add a per diem override for the team and the dates on the Policies page. The default policy itself is read-only.",
    evidence: [
      {
        trajectoryId: "trj_s3p6n8",
        eventIds: [ev("trj_s3p6n8", 3)],
        quote: "Per diem: default $75, Add event override",
      },
      {
        trajectoryId: "trj_s3p6n8",
        eventIds: [ev("trj_s3p6n8", 5), ev("trj_s3p6n8", 6)],
        quote: "POST /policies/per-diem/overrides: Sales, $95",
      },
    ],
    threadCount: 1,
    createdAt: at(3, 2, 5),
  },
];

/** Newest first, as the Insights list reads. */
export const SEED_INSIGHTS: readonly DemoInsight[] = [
  ...SEED_INSIGHTS_OLDEST_FIRST,
].toReversed();

const skillMd = (name: string, description: string, steps: string[]) =>
  [
    `---`,
    `name: ${name}`,
    `description: ${description}`,
    `---`,
    ``,
    `# ${description.replace(/^Use when /, "").replace(/\.$/, "")}`,
    ``,
    `## Steps`,
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    ``,
  ].join("\n");

export const SEED_SKILLS: readonly DemoSkill[] = [
  {
    name: "set-approval-delegate",
    status: "published",
    description:
      "Use when an approver will be away and someone should approve for them.",
    skillMd: skillMd(
      "set-approval-delegate",
      "Use when an approver will be away and someone should approve for them.",
      [
        "Confirm the delegate can approve (getPerson).",
        "Call ledgerlineApi POST /approvals/delegations with from, to, start and end.",
        "Tell the user the dates the delegation covers.",
      ],
    ),
    supportingInsightIds: ["ins_s01"],
    revision: 2,
  },
  {
    name: "set-card-limit",
    status: "published",
    description: "Use when a person needs a different monthly card limit.",
    skillMd: skillMd(
      "set-card-limit",
      "Use when a person needs a different monthly card limit.",
      [
        "Find the person (create them first if they are new).",
        "Call ledgerlineApi PUT /people/:id/card-controls with monthlyLimit.",
        "Confirm the new limit.",
      ],
    ),
    supportingInsightIds: ["ins_s02"],
    revision: 1,
  },
  {
    name: "archive-stale-drafts",
    status: "published",
    description: "Use when old draft reports should be cleaned up.",
    skillMd: skillMd(
      "archive-stale-drafts",
      "Use when old draft reports should be cleaned up.",
      [
        "List drafts older than the cutoff.",
        "Call ledgerlineApi POST /reports/archive with the cutoff.",
        "Never delete reports.",
      ],
    ),
    supportingInsightIds: ["ins_s03"],
    revision: 1,
  },
  {
    name: "per-diem-event-override",
    status: "candidate",
    description: "Use when a team needs a higher per diem for an event.",
    skillMd: skillMd(
      "per-diem-event-override",
      "Use when a team needs a higher per diem for an event.",
      [
        "Read the default per diem (searchPolicies).",
        "Call ledgerlineApi POST /policies/per-diem/overrides with team, amount and dates.",
        "Leave the default policy unchanged.",
      ],
    ),
    supportingInsightIds: ["ins_s04"],
    revision: 1,
  },
];

export const SEED_EVAL_CANDIDATES: readonly (EvalCandidate & {
  exportedAt?: number;
})[] = [
  {
    id: "evc_s01",
    query: "An approver is away next week; have a colleague approve for them",
    checks: [
      "Calls POST /approvals/delegations with start and end dates",
      "Does not edit the person record",
    ],
    sourceTrajectoryIds: ["trj_s9k2m4"],
    sourceEventIds: [ev("trj_s9k2m4", 5), ev("trj_s9k2m4", 6)],
    status: "accepted",
    exportedAt: at(9, 11, 0),
  },
  {
    id: "evc_s02",
    query: "Archive every draft report older than 60 days",
    checks: ["Calls POST /reports/archive once", "Does not call deleteReport"],
    sourceTrajectoryIds: ["trj_s6d8u1"],
    sourceEventIds: [ev("trj_s6d8u1", 4), ev("trj_s6d8u1", 5)],
    status: "accepted",
    exportedAt: at(7, 15, 30),
  },
  {
    id: "evc_s03",
    query: "Give a new hire a $2,000 monthly card limit",
    checks: [
      "Calls PUT /people/:id/card-controls with monthlyLimit 2000",
      "Creates the person first if needed",
    ],
    sourceTrajectoryIds: ["trj_s7m3x2"],
    sourceEventIds: [ev("trj_s7m3x2", 4), ev("trj_s7m3x2", 7)],
    status: "accepted",
  },
  {
    id: "evc_s04",
    query: "Ask the agent which reports are waiting",
    checks: ["Lists submitted reports"],
    sourceTrajectoryIds: ["trj_s5h4c9"],
    sourceEventIds: [ev("trj_s5h4c9", 1)],
    status: "rejected",
  },
];

/** Analyses before today, newest first. */
export const SEED_RUNS: readonly {
  readonly id: string;
  readonly at: number;
  readonly insights: number;
  readonly candidates: number;
  readonly threads: number;
}[] = [
  {
    id: "5e1d9c2a-7b40-4c8e-9f31-0d6a2b7c4e11",
    at: at(3, 2, 0),
    insights: 1,
    candidates: 1,
    threads: 6,
  },
  {
    id: "4a2f8b1c-6e3d-4f7a-8c20-1b5d9e3f2a07",
    at: at(8, 2, 0),
    insights: 1,
    candidates: 1,
    threads: 4,
  },
  {
    id: "3c7e1a9d-5f2b-4e6c-a018-2e4f8b1d6c93",
    at: at(10, 2, 0),
    insights: 1,
    candidates: 1,
    threads: 3,
  },
  {
    id: "2b6d0f8e-4a1c-4d5b-9e07-3f3a7c0e5b82",
    at: at(12, 2, 0),
    insights: 1,
    candidates: 1,
    threads: 2,
  },
];

/** Cases exported to the eval platform before today. */
export const SEED_IMPORTED = SEED_EVAL_CANDIDATES.filter(
  (c) => c.exportedAt,
).map((c) => ({
  id: `imp_${c.id}`,
  sourceCandidateId: c.id,
  query: c.query,
  checks: c.checks,
  sourceTrajectoryIds: c.sourceTrajectoryIds,
  importedAt: c.exportedAt as number,
  source: "copilotkit-intelligence" as const,
  status: "ran" as const,
  runs: [true, true, c.id === "evc_s02" ? false : true],
}));

/** Fine-tune: examples built from the seeded trajectories, and the last export. */
export const SEED_FINE_TUNE = {
  examples: 46,
  lastExport: {
    at: at(5, 17, 12),
    target: "thinking-machines" as const,
    examples: 42,
    file: "ledgerline-finetune-thinking-machines.jsonl",
  },
  sample: [
    {
      messages: [
        {
          role: "user",
          content:
            "I'm out Oct 6 to 10. Have Jordan approve my team's reports while I'm away.",
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "ledgerlineApi",
                arguments: JSON.stringify({
                  method: "POST",
                  path: "/approvals/delegations",
                  body: {
                    from: "u_maya",
                    to: "u_jordan",
                    start: "2026-10-06",
                    end: "2026-10-10",
                  },
                }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "c1",
          content: JSON.stringify({ id: "dlg_41", status: "scheduled" }),
        },
        {
          role: "assistant",
          content:
            "Jordan Patel will approve your team's reports from Oct 6 to Oct 10.",
        },
      ],
    },
    {
      messages: [
        {
          role: "user",
          content: "Archive every draft report older than 60 days.",
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "ledgerlineApi",
                arguments: JSON.stringify({
                  method: "POST",
                  path: "/reports/archive",
                  body: { status: "draft", olderThanDays: 60 },
                }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "c1",
          content: JSON.stringify({ archived: 14 }),
        },
        {
          role: "assistant",
          content:
            "Archived 14 drafts older than 60 days. They stay searchable under Archived.",
        },
      ],
    },
  ],
};
