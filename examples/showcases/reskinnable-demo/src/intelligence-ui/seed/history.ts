/**
 * Seeded Ledgerline history for the Intelligence screens: two weeks of earlier
 * trajectories, analyses, Insights, Skills, eval candidates, a fine-tune export
 * and two cases already exported to the eval platform. Static, so it is "restored"
 * by every /reset, and dated days before today so today's run is always newest.
 *
 * It never covers today's case: nothing here mentions POL-114, team events, or
 * cost center CC-410, and none of these Skills reach the Ledgerline agent (they
 * live only in this overlay), so the in-app and ChatGPT attempts still fail.
 */
import type {
  DemoInsight,
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
  readonly steps: readonly (
    | readonly [string, Record<string, unknown>, unknown, "ok" | "error"]
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
    const [name, args, result, status] = s as readonly [
      string,
      Record<string, unknown>,
      unknown,
      "ok" | "error",
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
    title: "Chase Tom Becker's missing hotel receipt",
    user: MAYA,
    start: at(13, 10, 12),
    outcome: "agent_failed_user_completed",
    surface: "in_app",
    ask: "Tom Becker's Denver trip is missing the hotel receipt. Ask him for it and hold the report.",
    reply:
      "I couldn't request the receipt: there is no tool for contacting the submitter. I left a note on EXP-2299 instead.",
    steps: [
      [
        "getReport",
        { reportId: "EXP-2299" },
        {
          id: "EXP-2299",
          employee: "Tom Becker",
          lines: 4,
          receiptsMissing: ["Hotel, 2 nights"],
        },
        "ok",
      ],
      [
        "think",
        "The hotel line has no receipt. I should ask Tom for it, but I don't see a request tool.",
      ],
      [
        "addNote",
        { reportId: "EXP-2299", note: "Please upload the hotel receipt." },
        { noteAdded: true },
        "ok",
      ],
      [
        "requestReceipt",
        { reportId: "EXP-2299", line: 3 },
        { error: "UNKNOWN_TOOL" },
        "error",
      ],
    ],
    manual: [
      screen("Receipts", {
        Missing: "Hotel, 2 nights · $612.40",
        Action: "Request receipt",
      }),
      click("Request receipt"),
      net(
        "POST",
        "/api/ledgerline/v1/reports/[id]/receipt-requests",
        "Receipt requested from Tom Becker",
      ),
      ["expense.receipt_requested", { reportId: "EXP-2299", line: 3 }],
    ],
    missing: {
      label:
        "Receipts panel: missing receipts are requested from the Receipts panel, not with a note",
      why: "Shown on screen; the agent has no receipt-request tool",
      at: 0,
    },
  },
  {
    id: "trj_s8f1q7",
    title: "Approve Daniel Okafor's client dinner",
    user: MAYA,
    start: at(12, 9, 41),
    outcome: "agent_succeeded",
    surface: "in_app",
    ask: "Approve Daniel Okafor's client dinner.",
    reply:
      "Approved **EXP-2288**, Daniel Okafor's client dinner (**$350.60**).",
    steps: [
      [
        "listReports",
        { employee: "Daniel Okafor", status: "submitted" },
        { count: 1, reports: [{ id: "EXP-2288" }] },
        "ok",
      ],
      [
        "approveReport",
        { reportId: "EXP-2288" },
        { id: "EXP-2288", status: "approved" },
        "ok",
      ],
    ],
  },
  {
    id: "trj_s7m3x2",
    title: "Split Aisha Khan's mileage across two projects",
    user: JORDAN,
    start: at(11, 15, 5),
    outcome: "agent_failed_user_completed",
    surface: "in_app",
    ask: "Split Aisha Khan's September mileage 60/40 between Northwind and Contoso.",
    reply:
      "I can't split a mileage line; the expense tools only update a whole report. You may need to do this in Ledgerline.",
    steps: [
      [
        "getReport",
        { reportId: "EXP-2301" },
        {
          id: "EXP-2301",
          employee: "Aisha Khan",
          category: "Mileage",
          total: 338.99,
        },
        "ok",
      ],
      [
        "think",
        "There is no line-split tool. Updating the whole report would move all of it.",
      ],
      [
        "updateReport",
        { reportId: "EXP-2301", project: "Northwind" },
        { error: "PARTIAL_SPLIT_UNSUPPORTED" },
        "error",
      ],
    ],
    manual: [
      screen("Mileage line", {
        Distance: "412 mi",
        Projects: "Northwind, Contoso",
        Action: "Split line",
      }),
      click("Split line"),
      click("Save split"),
      net(
        "PATCH",
        "/api/ledgerline/v1/reports/[id]/lines/[line]",
        "Line split 60/40",
      ),
      [
        "expense.line_split",
        { reportId: "EXP-2301", split: { Northwind: 0.6, Contoso: 0.4 } },
      ],
    ],
    missing: {
      label:
        "Line menu: mileage can be split by project from the line's own menu",
      why: "Shown on screen, not available to the agent as a tool",
      at: 0,
    },
  },
  {
    id: "trj_s6d8u1",
    title: "Flag the duplicate rideshare charge on EXP-2270",
    user: MAYA,
    start: at(9, 11, 20),
    outcome: "agent_failed_user_completed",
    surface: "chatgpt",
    ask: "Two identical rideshare charges on EXP-2270. Flag the duplicate.",
    reply:
      "I see two $42.10 rideshare lines on EXP-2270, but I can only reject the whole report, so I stopped.",
    steps: [
      [
        "getReport",
        { reportId: "EXP-2270" },
        {
          id: "EXP-2270",
          lines: [
            { n: 2, amount: 42.1 },
            { n: 3, amount: 42.1 },
          ],
        },
        "ok",
      ],
      [
        "rejectReport",
        { reportId: "EXP-2270", reason: "duplicate" },
        { error: "WOULD_REJECT_ALL_LINES" },
        "error",
      ],
    ],
    manual: [
      screen("Duplicate check", {
        Match: "Lines 2 and 3 · $42.10 · same merchant and time",
        Action: "Mark line as duplicate",
      }),
      click("Mark line as duplicate"),
      net(
        "POST",
        "/api/ledgerline/v1/reports/[id]/lines/[line]/duplicate",
        "Line 3 marked duplicate",
      ),
      ["expense.duplicate_flagged", { reportId: "EXP-2270", line: 3 }],
    ],
    missing: {
      label:
        "Duplicate check: duplicates are flagged per line, which keeps the rest of the report",
      why: "Shown on screen; ChatGPT's tools only reject whole reports",
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
      "Eleven reports are waiting for you, $9,412.30 in total. The oldest is Sofia Lindqvist's Lisbon trip.",
    steps: [
      [
        "listReports",
        { status: "submitted" },
        { count: 11, total: 9412.3 },
        "ok",
      ],
    ],
  },
  {
    id: "trj_s4w7b3",
    title: "Reimburse Sofia Lindqvist's Lisbon conference trip",
    user: JORDAN,
    start: at(6, 14, 30),
    outcome: "agent_succeeded",
    surface: "in_app",
    ask: "Reimburse Sofia Lindqvist's Lisbon conference trip.",
    reply:
      "Reimbursed **EXP-2295** ($1,731.00) to Sofia Lindqvist on the next ACH run.",
    steps: [
      [
        "getReport",
        { reportId: "EXP-2295" },
        { id: "EXP-2295", status: "approved", total: 1731 },
        "ok",
      ],
      [
        "reimburseReport",
        { reportId: "EXP-2295" },
        { id: "EXP-2295", status: "reimbursed" },
        "ok",
      ],
    ],
  },
  {
    id: "trj_s3p6n8",
    title: "Convert Omar Farouk's euro taxi receipts",
    user: MAYA,
    start: at(4, 16, 2),
    outcome: "agent_failed_user_completed",
    surface: "in_app",
    ask: "Omar's kickoff taxis are in euros. Convert them and resubmit.",
    reply:
      "I couldn't find the exchange rate Ledgerline expects, so I didn't change the amounts.",
    steps: [
      [
        "getReport",
        { reportId: "EXP-2311" },
        { id: "EXP-2311", currency: "EUR", lines: 3 },
        "ok",
      ],
      [
        "searchPolicies",
        { query: "currency conversion" },
        { results: [{ id: "TE-4.1", title: "Foreign currency" }] },
        "ok",
      ],
      [
        "updateReport",
        { reportId: "EXP-2311", currency: "USD" },
        { error: "RATE_DATE_REQUIRED" },
        "error",
      ],
    ],
    manual: [
      screen("Currency", {
        Rate: "Card statement rate, Sep 22",
        Action: "Use statement rate",
      }),
      click("Use statement rate"),
      net(
        "PATCH",
        "/api/ledgerline/v1/reports/[id]/currency",
        "Converted at statement rate 1.0874",
      ),
      ["expense.currency_converted", { reportId: "EXP-2311", rate: 1.0874 }],
    ],
    missing: {
      label:
        "Currency panel: use the card statement rate on the transaction date",
      why: "Shown on screen, not in any policy the agent can search",
      at: 0,
    },
  },
  {
    id: "trj_s2r5k6",
    title: "Explain why Lucía Romero's booth supplies aren't paid",
    user: JORDAN,
    start: at(2, 10, 48),
    outcome: "agent_succeeded",
    surface: "in_app",
    ask: "Why hasn't Lucía Romero's trade show booth report been reimbursed?",
    reply:
      "**EXP-2305** is still awaiting approval from her manager, so it can't be reimbursed yet.",
    steps: [
      [
        "getReport",
        { reportId: "EXP-2305" },
        { id: "EXP-2305", status: "submitted", approver: "R. Alvarez" },
        "ok",
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
    title:
      "Request a missing receipt from the Receipts panel instead of leaving a note",
    summary:
      "When a line has no receipt, people use Request receipt on the Receipts panel, which notifies the submitter and holds the line. The agent left notes, which nobody acts on.",
    evidence: [
      {
        trajectoryId: "trj_s9k2m4",
        eventIds: [ev("trj_s9k2m4", 3)],
        quote: "Receipts panel: Hotel, 2 nights · $612.40 missing",
      },
      {
        trajectoryId: "trj_s9k2m4",
        eventIds: [ev("trj_s9k2m4", 4), ev("trj_s9k2m4", 6)],
        quote: "Clicked Request receipt; receipt requested from Tom Becker",
      },
    ],
    threadCount: 1,
    createdAt: at(12, 2, 4),
  },
  {
    id: "ins_s02",
    title: "Split a mileage line by project from the line menu",
    summary:
      "Shared mileage is split on the line itself, 60/40 or by distance, so both projects are charged. Updating the whole report moves all of it to one project.",
    evidence: [
      {
        trajectoryId: "trj_s7m3x2",
        eventIds: [ev("trj_s7m3x2", 3)],
        quote: "Mileage line: Split line",
      },
      {
        trajectoryId: "trj_s7m3x2",
        eventIds: [ev("trj_s7m3x2", 7)],
        quote: "Line split 60/40 between Northwind and Contoso",
      },
    ],
    threadCount: 1,
    createdAt: at(10, 2, 3),
  },
  {
    id: "ins_s03",
    title: "Flag a duplicate charge on its line, not by rejecting the report",
    summary:
      "Duplicates are marked per line, which keeps the rest of the report moving. Rejecting the report sends every line back to the submitter.",
    evidence: [
      {
        trajectoryId: "trj_s6d8u1",
        eventIds: [ev("trj_s6d8u1", 2)],
        quote: "Duplicate check: lines 2 and 3, same merchant and time",
      },
      {
        trajectoryId: "trj_s6d8u1",
        eventIds: [ev("trj_s6d8u1", 5)],
        quote: "Line 3 marked duplicate",
      },
    ],
    threadCount: 1,
    createdAt: at(8, 2, 6),
  },
  {
    id: "ins_s04",
    title: "Convert foreign-currency receipts at the card statement rate",
    summary:
      "Foreign receipts are converted at the card statement rate on the transaction date, from the Currency panel. The policy library does not say this.",
    evidence: [
      {
        trajectoryId: "trj_s3p6n8",
        eventIds: [ev("trj_s3p6n8", 3)],
        quote: "Currency panel: card statement rate, Sep 22",
      },
      {
        trajectoryId: "trj_s3p6n8",
        eventIds: [ev("trj_s3p6n8", 6)],
        quote: "Converted at statement rate 1.0874",
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
    name: "request-missing-receipt",
    status: "published",
    description: "Use when a report line has no receipt.",
    skillMd: skillMd(
      "request-missing-receipt",
      "Use when a report line has no receipt.",
      [
        "Call getReport and find lines without receipts.",
        "Call requestReceipt for each missing line.",
        "Tell the user the line is held until the receipt arrives.",
      ],
    ),
    supportingInsightIds: ["ins_s01"],
    revision: 2,
  },
  {
    name: "split-mileage-by-project",
    status: "published",
    description: "Use when one mileage line is shared between projects.",
    skillMd: skillMd(
      "split-mileage-by-project",
      "Use when one mileage line is shared between projects.",
      [
        "Call getReport and find the mileage line.",
        "Call splitLine with the project shares the user gave.",
        "Confirm both projects and amounts.",
      ],
    ),
    supportingInsightIds: ["ins_s02"],
    revision: 1,
  },
  {
    name: "flag-duplicate-charge",
    status: "published",
    description: "Use when two lines on a report look like the same charge.",
    skillMd: skillMd(
      "flag-duplicate-charge",
      "Use when two lines on a report look like the same charge.",
      [
        "Compare amount, merchant and time of the two lines.",
        "Call markDuplicate on the later line.",
        "Leave the rest of the report as it is.",
      ],
    ),
    supportingInsightIds: ["ins_s03"],
    revision: 1,
  },
  {
    name: "convert-foreign-currency",
    status: "candidate",
    description: "Use when a receipt is in a foreign currency.",
    skillMd: skillMd(
      "convert-foreign-currency",
      "Use when a receipt is in a foreign currency.",
      [
        "Read the transaction date from the line.",
        "Call convertCurrency with the card statement rate for that date.",
        "Show the converted amount before resubmitting.",
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
    query: "A report line has no receipt; get it from the submitter",
    checks: [
      "Calls requestReceipt for the missing line",
      "Does not only add a note",
    ],
    sourceTrajectoryIds: ["trj_s9k2m4"],
    sourceEventIds: [ev("trj_s9k2m4", 4), ev("trj_s9k2m4", 6)],
    status: "accepted",
    exportedAt: at(9, 11, 0),
  },
  {
    id: "evc_s02",
    query: "Two identical rideshare lines on one report",
    checks: [
      "Calls markDuplicate on one line",
      "Does not reject the whole report",
    ],
    sourceTrajectoryIds: ["trj_s6d8u1"],
    sourceEventIds: [ev("trj_s6d8u1", 2), ev("trj_s6d8u1", 5)],
    status: "accepted",
    exportedAt: at(7, 15, 30),
  },
  {
    id: "evc_s03",
    query: "Split a shared mileage line 60/40 between two projects",
    checks: [
      "Calls splitLine with both projects",
      "Totals still match the original line",
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
            "Tom Becker's Denver trip is missing the hotel receipt. Ask him for it.",
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "requestReceipt",
                arguments: JSON.stringify({ reportId: "EXP-2299", line: 3 }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "c1",
          content: JSON.stringify({ requested: true, from: "Tom Becker" }),
        },
        {
          role: "assistant",
          content:
            "I asked Tom Becker for the hotel receipt and held that line until it arrives.",
        },
      ],
    },
    {
      messages: [
        {
          role: "user",
          content:
            "Two identical rideshare charges on EXP-2270. Flag the duplicate.",
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "markDuplicate",
                arguments: JSON.stringify({ reportId: "EXP-2270", line: 3 }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "c1",
          content: JSON.stringify({ line: 3, status: "duplicate" }),
        },
        {
          role: "assistant",
          content:
            "Marked line 3 as a duplicate. The rest of EXP-2270 is unchanged.",
        },
      ],
    },
  ],
};
