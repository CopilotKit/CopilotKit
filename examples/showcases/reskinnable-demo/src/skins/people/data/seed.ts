/**
 * Rowan's seeded scenario. Server-safe.
 *
 * Dates are stored as RELATIVE OFFSETS and materialized against `now` in
 * `store.ts`, not written as absolute ISO strings. That is deliberate: request
 * aging drives beat 3c ("show me the oldest pending requests") and tenure
 * drives the roster, so a seed with hard-coded 2026 dates would read as a
 * two-year-old queue the first time this demo is given in 2028. It also means a
 * presenter Reset genuinely re-freshens the queue rather than restoring stale
 * timestamps.
 *
 * ── Rows that are load-bearing for a demo beat ──────────────────────────────
 *   emp-priya   BEAT 3a  mid-band, 14 months since her last raise → the merit
 *                        increase the agent files while the FIGURE is typed by
 *                        the user into the chat card and never reaches the LLM.
 *   emp-tobias  BEAT 1/4 sits ABOVE his L4 band today → the ladder has a flag
 *                        on first paint and "out of band first" has content.
 *   emp-june    BEAT 1/4 sits BELOW her L5 band → the ladder flags both edges.
 *   emp-dana    BEAT 5   starts in four days with NO buddy and NO checklist →
 *               BEAT 3d  the stored procedure has visible work to do, and her
 *                        offer letter is the uploaded document.
 *   cmp-marcus  BEAT 6   requested salary is ABOVE the L6 ceiling → 422
 *                        OUT_OF_BAND. This is the one taught on stage.
 *   cmp-naomi   BEAT 6   a SECOND out-of-band request. The teaching consumes
 *                        Marcus's, so the proof of learning is Naomi's being
 *                        handled unaided. Never remove this row.
 *   cmp-rhea    BEAT 6   an IN-BAND control. Without it, a presenter can't show
 *                        that approve works normally and the 422 reads as a
 *                        broken endpoint rather than as a policy.
 */

import type {
  Band,
  EmployeeStatus,
  Level,
  Operator,
  RequestKind,
  RequestStatus,
  Team,
} from "./types";

export interface EmployeeSeed {
  id: string;
  name: string;
  title: string;
  level: Level;
  team: Team;
  email: string;
  location: string;
  managerId: string | null;
  startedMonthsAgo: number;
  status: EmployeeStatus;
  baseSalary: number;
  lastRaiseMonthsAgo: number | null;
  buddyId: string | null;
}

export interface RequestSeed {
  id: string;
  employeeId: string;
  kind: RequestKind;
  summary: string;
  detail: string;
  submittedDaysAgo: number;
  status: RequestStatus;
  days?: number;
  amount?: number;
}

export interface CompRequestSeed {
  id: string;
  employeeId: string;
  reason: string;
  currentSalary: number;
  requestedSalary: number;
  proposedLevel: Level;
  submittedBy: string;
  submittedDaysAgo: number;
  status: RequestStatus;
}

export interface OnboardingTaskSeed {
  id: string;
  employeeId: string;
  label: string;
  owner: string;
  dueOffsetDays: number;
  done: boolean;
}

export interface PacketSeed {
  id: string;
  employeeId: string;
  employeeName: string;
  role: string;
  startedMonthsAgo: number;
  summary: string;
  highlights: string[];
  schedule: { day: string; item: string }[];
  filedDaysAgo: number;
  filedBy: string;
}

/**
 * The band table. The gate in `store.canApproveCompRequest` is enforced against
 * `min`/`max`; `mid` is the target the ladder ticks. Bands deliberately OVERLAP
 * at the edges (L4 max 154k, L5 min 152k) the way real ladders do, so "above
 * your band" is never the same statement as "paid more than the next level".
 */
export const SEED_BANDS: readonly Band[] = [
  { level: "L3", label: "Associate", min: 92_000, mid: 105_000, max: 118_000 },
  { level: "L4", label: "Engineer", min: 118_000, mid: 136_000, max: 154_000 },
  { level: "L5", label: "Senior", min: 152_000, mid: 176_000, max: 200_000 },
  { level: "L6", label: "Staff", min: 196_000, mid: 226_000, max: 256_000 },
  { level: "L7", label: "Principal", min: 250_000, mid: 288_000, max: 326_000 },
];

export const SEED_EMPLOYEES: readonly EmployeeSeed[] = [
  {
    id: "emp-maya",
    name: "Maya Lindqvist",
    title: "Head of People Ops",
    level: "L6",
    team: "People Ops",
    email: "maya@rowan.example",
    location: "Stockholm",
    managerId: null,
    startedMonthsAgo: 52,
    status: "active",
    baseSalary: 214_000,
    lastRaiseMonthsAgo: 8,
    buddyId: null,
  },
  {
    id: "emp-clara",
    name: "Clara Mendes",
    title: "Engineering Manager",
    level: "L6",
    team: "Engineering",
    email: "clara@rowan.example",
    location: "Lisbon",
    managerId: null,
    startedMonthsAgo: 41,
    status: "active",
    baseSalary: 232_000,
    lastRaiseMonthsAgo: 6,
    buddyId: null,
  },
  {
    id: "emp-arun",
    name: "Arun Sethi",
    title: "Principal Engineer",
    level: "L7",
    team: "Engineering",
    email: "arun@rowan.example",
    location: "Bengaluru",
    managerId: "emp-clara",
    startedMonthsAgo: 63,
    status: "active",
    baseSalary: 291_000,
    lastRaiseMonthsAgo: 5,
    buddyId: null,
  },
  {
    // BEAT 3a — mid-band with real headroom, and overdue for a review, so a
    // merit increase is the obvious next action a presenter would take.
    id: "emp-priya",
    name: "Priya Raman",
    title: "Senior Robotics Engineer",
    level: "L5",
    team: "Engineering",
    email: "priya@rowan.example",
    location: "Toronto",
    managerId: "emp-clara",
    startedMonthsAgo: 29,
    status: "active",
    baseSalary: 163_000,
    lastRaiseMonthsAgo: 14,
    buddyId: null,
  },
  {
    // BEAT 6 (#1) — the subject of the out-of-band promotion taught on stage.
    id: "emp-marcus",
    name: "Marcus Bell",
    title: "Senior Controls Engineer",
    level: "L5",
    team: "Engineering",
    email: "marcus@rowan.example",
    location: "Detroit",
    managerId: "emp-clara",
    startedMonthsAgo: 34,
    status: "active",
    baseSalary: 194_000,
    lastRaiseMonthsAgo: 11,
    buddyId: null,
  },
  {
    // BEAT 1/4 — ABOVE his L4 ceiling (154k) today. The ladder flags him on
    // first paint, before any tool has run.
    id: "emp-tobias",
    name: "Tobias Renn",
    title: "Firmware Engineer",
    level: "L4",
    team: "Engineering",
    email: "tobias@rowan.example",
    location: "Berlin",
    managerId: "emp-clara",
    startedMonthsAgo: 38,
    status: "active",
    baseSalary: 161_000,
    lastRaiseMonthsAgo: 4,
    buddyId: null,
  },
  {
    // BEAT 1/4 — BELOW her L5 floor (152k). The other edge of the flag.
    id: "emp-june",
    name: "June Castellanos",
    title: "Senior Data Engineer",
    level: "L5",
    team: "Engineering",
    email: "june@rowan.example",
    location: "Austin",
    managerId: "emp-clara",
    startedMonthsAgo: 19,
    status: "active",
    baseSalary: 147_000,
    lastRaiseMonthsAgo: 16,
    buddyId: null,
  },
  {
    // BEAT 5 + 3d — starts in four days. No buddy, no checklist, no packet: the
    // stored procedure and the offer-letter upload both have visible work.
    id: "emp-dana",
    name: "Dana Whitfield",
    title: "Robotics Engineer",
    level: "L4",
    team: "Engineering",
    email: "dana@rowan.example",
    location: "Toronto",
    managerId: "emp-clara",
    startedMonthsAgo: -0.13,
    status: "onboarding",
    baseSalary: 138_000,
    lastRaiseMonthsAgo: null,
    buddyId: null,
  },
  {
    // Started three weeks ago with a part-finished checklist — gives the
    // Onboarding page content on load and a contrast for Dana's empty state.
    id: "emp-yusuf",
    name: "Yusuf Demir",
    title: "Associate Engineer",
    level: "L3",
    team: "Engineering",
    email: "yusuf@rowan.example",
    location: "Istanbul",
    managerId: "emp-clara",
    startedMonthsAgo: 0.7,
    status: "active",
    baseSalary: 104_000,
    lastRaiseMonthsAgo: null,
    buddyId: "emp-tobias",
  },
  {
    id: "emp-holt",
    name: "Holt Nakamura",
    title: "Design Lead",
    level: "L6",
    team: "Design",
    email: "holt@rowan.example",
    location: "Osaka",
    managerId: null,
    startedMonthsAgo: 47,
    status: "on-leave",
    baseSalary: 219_000,
    lastRaiseMonthsAgo: 9,
    buddyId: null,
  },
  {
    // BEAT 6 (#2) — the SECOND out-of-band case, handled unaided after learning.
    id: "emp-naomi",
    name: "Naomi Okafor",
    title: "Senior Product Designer",
    level: "L5",
    team: "Design",
    email: "naomi@rowan.example",
    location: "Lagos",
    managerId: "emp-holt",
    startedMonthsAgo: 26,
    status: "active",
    baseSalary: 171_000,
    lastRaiseMonthsAgo: 12,
    buddyId: null,
  },
  {
    id: "emp-ines",
    name: "Inés Vidal",
    title: "Product Designer",
    level: "L4",
    team: "Design",
    email: "ines@rowan.example",
    location: "Barcelona",
    managerId: "emp-holt",
    startedMonthsAgo: 15,
    status: "active",
    baseSalary: 131_000,
    lastRaiseMonthsAgo: 7,
    buddyId: null,
  },
  {
    id: "emp-devon",
    name: "Devon Achebe",
    title: "Head of Revenue",
    level: "L6",
    team: "Go-to-Market",
    email: "devon@rowan.example",
    location: "Chicago",
    managerId: null,
    startedMonthsAgo: 33,
    status: "active",
    baseSalary: 241_000,
    lastRaiseMonthsAgo: 6,
    buddyId: null,
  },
  {
    id: "emp-rhea",
    name: "Rhea Kapoor",
    title: "Solutions Engineer",
    level: "L5",
    team: "Go-to-Market",
    email: "rhea@rowan.example",
    location: "London",
    managerId: "emp-devon",
    startedMonthsAgo: 22,
    status: "active",
    baseSalary: 168_000,
    lastRaiseMonthsAgo: 10,
    buddyId: null,
  },
  {
    id: "emp-sasha",
    name: "Sasha Bergström",
    title: "Account Executive",
    level: "L4",
    team: "Go-to-Market",
    email: "sasha@rowan.example",
    location: "Copenhagen",
    managerId: "emp-devon",
    startedMonthsAgo: 11,
    status: "active",
    baseSalary: 128_000,
    lastRaiseMonthsAgo: null,
    buddyId: null,
  },
  {
    id: "emp-oskar",
    name: "Oskar Lindgren",
    title: "Controller",
    level: "L5",
    team: "Finance",
    email: "oskar@rowan.example",
    location: "Stockholm",
    managerId: null,
    startedMonthsAgo: 44,
    status: "active",
    baseSalary: 175_000,
    lastRaiseMonthsAgo: 8,
    buddyId: null,
  },
  {
    id: "emp-bea",
    name: "Bea Toussaint",
    title: "People Ops Partner",
    level: "L4",
    team: "People Ops",
    email: "bea@rowan.example",
    location: "Montréal",
    managerId: "emp-maya",
    startedMonthsAgo: 17,
    status: "active",
    baseSalary: 134_000,
    lastRaiseMonthsAgo: 9,
    buddyId: null,
  },
];

/**
 * The queue. Eleven PENDING rows with a wide aging spread, so beat 3c's
 * `top=10` genuinely truncates (a top-N that shows everything proves nothing)
 * and "oldest pending" has an unambiguous winner in Tobias's desk request.
 */
export const SEED_REQUESTS: readonly RequestSeed[] = [
  {
    id: "req-desk-tobias",
    employeeId: "emp-tobias",
    kind: "equipment",
    summary: "Standing desk and monitor arm",
    detail: "Occupational health signed off after a back injury in March.",
    submittedDaysAgo: 31,
    status: "pending",
    amount: 940,
  },
  {
    id: "req-kinematics-arun",
    employeeId: "emp-arun",
    kind: "training",
    summary: "Advanced kinematics workshop",
    detail: "Three-day intensive; Arun would bring the material back in-house.",
    submittedDaysAgo: 28,
    status: "pending",
    amount: 1_900,
  },
  {
    id: "req-october-sasha",
    employeeId: "emp-sasha",
    kind: "time-off",
    summary: "Two weeks in October",
    detail: "Booked around a wedding; coverage arranged with Rhea.",
    submittedDaysAgo: 26,
    status: "pending",
    days: 10,
  },
  {
    id: "req-rust-yusuf",
    employeeId: "emp-yusuf",
    kind: "training",
    summary: "Embedded Rust certification",
    detail: "Part of the associate ramp plan agreed at his offer stage.",
    submittedDaysAgo: 22,
    status: "pending",
    amount: 1_450,
  },
  {
    id: "req-family-rhea",
    employeeId: "emp-rhea",
    kind: "time-off",
    summary: "Family leave, three days",
    detail: "Short-notice caregiving.",
    submittedDaysAgo: 17,
    status: "pending",
    days: 3,
  },
  {
    id: "req-chair-holt",
    employeeId: "emp-holt",
    kind: "equipment",
    summary: "Ergonomic chair",
    detail: "To be delivered before Holt returns from leave.",
    submittedDaysAgo: 14,
    status: "pending",
    amount: 620,
  },
  {
    id: "req-display-ines",
    employeeId: "emp-ines",
    kind: "equipment",
    summary: "Colour-calibrated display",
    detail: "Needed for the operator-console contrast audit.",
    submittedDaysAgo: 12,
    status: "pending",
    amount: 1_290,
  },
  {
    id: "req-move-june",
    employeeId: "emp-june",
    kind: "role-change",
    summary: "Move to the Perception team",
    detail: "Clara and the Perception lead have both agreed in principle.",
    submittedDaysAgo: 9,
    status: "pending",
  },
  {
    id: "req-referral-bea",
    employeeId: "emp-bea",
    kind: "referral-bonus",
    summary: "Referral payout for D. Whitfield",
    detail: "Standard engineering referral, payable on the start date.",
    submittedDaysAgo: 6,
    status: "pending",
    amount: 3_000,
  },
  {
    id: "req-weekend-oskar",
    employeeId: "emp-oskar",
    kind: "time-off",
    summary: "Long weekend",
    detail: "Two days either side of the quarter close.",
    submittedDaysAgo: 4,
    status: "pending",
    days: 2,
  },
  {
    id: "req-laptop-devon",
    employeeId: "emp-devon",
    kind: "equipment",
    summary: "Laptop refresh",
    detail: "Four years old; battery no longer holds a customer demo.",
    submittedDaysAgo: 2,
    status: "pending",
    amount: 2_400,
  },
  {
    id: "req-summit-priya",
    employeeId: "emp-priya",
    kind: "training",
    summary: "Robotics summit, Montréal",
    detail: "Speaking on the actuation stack.",
    submittedDaysAgo: 41,
    status: "approved",
    amount: 2_200,
  },
  {
    id: "req-offsite-clara",
    employeeId: "emp-clara",
    kind: "equipment",
    summary: "Team offsite kit",
    detail: "Whiteboards and travel adapters for the Lisbon week.",
    submittedDaysAgo: 35,
    status: "approved",
    amount: 780,
  },
  {
    id: "req-sabbatical-naomi",
    employeeId: "emp-naomi",
    kind: "time-off",
    summary: "Sabbatical scoping, four weeks",
    detail: "Deferred to next year; revisit after the promotion decision.",
    submittedDaysAgo: 19,
    status: "declined",
    days: 20,
  },
];

/**
 * BEAT 6. Two out-of-band requests and one in-band control — see the header
 * note. Do not collapse these to one: the teaching consumes the first, so the
 * proof of learning depends on a second, untouched, out-of-band case.
 */
export const SEED_COMP_REQUESTS: readonly CompRequestSeed[] = [
  {
    id: "cmp-marcus",
    employeeId: "emp-marcus",
    reason: "Promotion to Staff — owns the actuation stack end to end",
    currentSalary: 194_000,
    requestedSalary: 272_000,
    proposedLevel: "L6",
    submittedBy: "Clara Mendes",
    submittedDaysAgo: 9,
    status: "pending",
  },
  {
    id: "cmp-naomi",
    employeeId: "emp-naomi",
    reason: "Promotion to Staff — owns the operator console end to end",
    currentSalary: 171_000,
    requestedSalary: 268_000,
    proposedLevel: "L6",
    submittedBy: "Holt Nakamura",
    submittedDaysAgo: 5,
    status: "pending",
  },
  {
    id: "cmp-rhea",
    employeeId: "emp-rhea",
    reason: "Market adjustment for solutions engineering",
    currentSalary: 168_000,
    requestedSalary: 186_000,
    proposedLevel: "L5",
    submittedBy: "Devon Achebe",
    submittedDaysAgo: 3,
    status: "pending",
  },
];

/** Yusuf's part-finished ramp. Dana deliberately has none — beat 5 creates hers. */
export const SEED_ONBOARDING_TASKS: readonly OnboardingTaskSeed[] = [
  {
    id: "task-yusuf-1",
    employeeId: "emp-yusuf",
    label: "Laptop and badge issued",
    owner: "IT",
    dueOffsetDays: -2,
    done: true,
  },
  {
    id: "task-yusuf-2",
    employeeId: "emp-yusuf",
    label: "Payroll and benefits enrolment",
    owner: "People Ops",
    dueOffsetDays: 1,
    done: true,
  },
  {
    id: "task-yusuf-3",
    employeeId: "emp-yusuf",
    label: "Repo access and on-call shadowing",
    owner: "Engineering",
    dueOffsetDays: 3,
    done: true,
  },
  {
    id: "task-yusuf-4",
    employeeId: "emp-yusuf",
    label: "30-day check-in with Clara",
    owner: "Clara Mendes",
    dueOffsetDays: 30,
    done: false,
  },
  {
    id: "task-yusuf-5",
    employeeId: "emp-yusuf",
    label: "Safety certification for the robot cell",
    owner: "Facilities",
    dueOffsetDays: 14,
    done: false,
  },
];

/** One filed packet so the Packets tab is never empty; beat 3d adds Dana's. */
export const SEED_PACKETS: readonly PacketSeed[] = [
  {
    id: "pkt-yusuf",
    employeeId: "emp-yusuf",
    employeeName: "Yusuf Demir",
    role: "Associate Engineer, L3 · Engineering",
    startedMonthsAgo: 0.7,
    summary:
      "Associate engineer joining the firmware group under Clara Mendes, ramping through the embedded toolchain before taking on-call.",
    highlights: [
      "Buddy: Tobias Renn (firmware)",
      "Safety certification required before robot-cell access",
      "Embedded Rust certification approved at offer stage",
    ],
    schedule: [
      { day: "Day 1", item: "Laptop, badge, and the office tour" },
      { day: "Day 2", item: "Payroll, benefits, and equity paperwork" },
      { day: "Day 3", item: "Toolchain setup with Tobias" },
      { day: "Week 2", item: "First firmware ticket, paired" },
    ],
    filedDaysAgo: 24,
    filedBy: "Maya Lindqvist",
  },
];

/**
 * Who can be signed in. Rowan scopes durable memory by operator id, so the
 * seeded beat-4 preference belongs to Maya — switching to Clara deliberately
 * shows a colleague who has NOT taught Rowan anything yet.
 */
export const SEED_OPERATORS: readonly Operator[] = [
  {
    id: "op-maya",
    name: "Maya Lindqvist",
    role: "people-ops-lead",
    team: "People Ops",
  },
  {
    id: "op-clara",
    name: "Clara Mendes",
    role: "manager",
    team: "Engineering",
  },
];

export const DEFAULT_OPERATOR_ID = "op-maya";
