import type {
  Activity,
  Category,
  CostCenter,
  Employee,
  ExpenseReport,
  LineItem,
  PolicyDoc,
  ReportStatus,
} from "./types";
import { EVENTS_THRESHOLD, HOLD_TEAM_EVENT } from "./types";

/**
 * Ledgerline's seed: a fictitious mid-size software company, 40 expense
 * reports. Dates are relative to "today" so the queue always looks current.
 *
 * The hero is EXP-2291, Priya Raman's Q3 team offsite ($4,860), held by
 * POL-114 because it is a team event over $2,500 still charged to her home
 * cost center. EXP-2317 (Marcus Lee) is the same shape, for the "does it
 * generalize" beat after the skill is published.
 */

export const COMPANY = "Halcyon Labs";

export const CURRENT_USER = {
  id: "u_maya",
  name: "Maya Chen",
  title: "Finance Operations Lead",
};

export const COST_CENTERS: CostCenter[] = [
  {
    id: "CC-100",
    name: "General & Administrative",
    owner: "Ruth Alvarez",
    kind: "department",
    quarterBudget: 18000,
  },
  {
    id: "CC-200",
    name: "Product",
    owner: "Jonah Weiss",
    kind: "department",
    quarterBudget: 24000,
  },
  {
    id: "CC-210",
    name: "Engineering",
    owner: "Hana Sato",
    kind: "department",
    quarterBudget: 32000,
  },
  {
    id: "CC-305",
    name: "Sales",
    owner: "Diego Marín",
    kind: "department",
    quarterBudget: 40000,
  },
  {
    id: "CC-320",
    name: "Marketing",
    owner: "Ama Owusu",
    kind: "department",
    quarterBudget: 28000,
  },
  {
    id: "CC-410",
    name: "Events & Offsites",
    owner: "Ruth Alvarez",
    kind: "events",
    quarterBudget: 30000,
  },
  {
    id: "CC-520",
    name: "Customer Success",
    owner: "Leo Brandt",
    kind: "department",
    quarterBudget: 16000,
  },
  {
    id: "CC-610",
    name: "People Operations",
    owner: "Nadia Haddad",
    kind: "department",
    quarterBudget: 12000,
  },
];

export const EMPLOYEES: Employee[] = [
  {
    id: "e_priya",
    name: "Priya Raman",
    title: "Senior Product Manager",
    department: "Product",
    homeCostCenterId: "CC-200",
  },
  {
    id: "e_marcus",
    name: "Marcus Lee",
    title: "Engineering Manager",
    department: "Engineering",
    homeCostCenterId: "CC-210",
  },
  {
    id: "e_daniel",
    name: "Daniel Okafor",
    title: "Account Executive",
    department: "Sales",
    homeCostCenterId: "CC-305",
  },
  {
    id: "e_sofia",
    name: "Sofia Lindqvist",
    title: "Product Designer",
    department: "Product",
    homeCostCenterId: "CC-200",
  },
  {
    id: "e_tom",
    name: "Tom Becker",
    title: "Solutions Engineer",
    department: "Sales",
    homeCostCenterId: "CC-305",
  },
  {
    id: "e_aisha",
    name: "Aisha Khan",
    title: "Staff Engineer",
    department: "Engineering",
    homeCostCenterId: "CC-210",
  },
  {
    id: "e_ben",
    name: "Ben Carter",
    title: "Customer Success Manager",
    department: "Customer Success",
    homeCostCenterId: "CC-520",
  },
  {
    id: "e_lucia",
    name: "Lucía Romero",
    title: "Field Marketing Manager",
    department: "Marketing",
    homeCostCenterId: "CC-320",
  },
  {
    id: "e_kenji",
    name: "Kenji Mori",
    title: "Backend Engineer",
    department: "Engineering",
    homeCostCenterId: "CC-210",
  },
  {
    id: "e_grace",
    name: "Grace Liu",
    title: "Recruiter",
    department: "People Operations",
    homeCostCenterId: "CC-610",
  },
  {
    id: "e_omar",
    name: "Omar Farouk",
    title: "Regional Sales Director",
    department: "Sales",
    homeCostCenterId: "CC-305",
  },
  {
    id: "e_elena",
    name: "Elena Petrova",
    title: "Data Analyst",
    department: "Product",
    homeCostCenterId: "CC-200",
  },
  {
    id: "e_sam",
    name: "Sam Whitaker",
    title: "IT Administrator",
    department: "General & Administrative",
    homeCostCenterId: "CC-100",
  },
  {
    id: "e_zoe",
    name: "Zoe Adams",
    title: "Content Strategist",
    department: "Marketing",
    homeCostCenterId: "CC-320",
  },
];

export const POLICY_DOCS: PolicyDoc[] = [
  {
    id: "TE-1.1",
    title: "Travel & Expense Policy",
    section: "1.1 Scope",
    updatedAt: "2026-07-01",
    summary:
      "Who the policy covers and what counts as a reimbursable business expense.",
    body: "This policy applies to all employees and contractors with a Ledgerline account. Expenses must be ordinary, necessary and incurred on company business.",
  },
  {
    id: "TE-2.3",
    title: "Travel & Expense Policy",
    section: "2.3 Receipts",
    updatedAt: "2026-07-01",
    summary: "Itemized receipts are required for every line over $75.",
    body: "Attach an itemized receipt to every line over $75. Card statements are not receipts. Missing receipts need a signed missing-receipt declaration.",
  },
  {
    id: "TE-3.2",
    title: "Travel & Expense Policy",
    section: "3.2 Meals and per diem",
    updatedAt: "2026-07-01",
    summary: "Meal limits per person and per diem rates for overnight travel.",
    body: "Business meals are reimbursed up to $85 per person including tip. Overnight travel uses the published per diem for the destination city.",
  },
  {
    id: "TE-3.5",
    title: "Travel & Expense Policy",
    section: "3.5 Client entertainment",
    updatedAt: "2026-07-01",
    summary:
      "Attendee names and business purpose are required for client entertainment.",
    body: "List every attendee and their company, and state the business purpose. Entertainment over $500 needs your manager's pre-approval in the report notes.",
  },
  {
    id: "TE-4.1",
    title: "Travel & Expense Policy",
    section: "4.1 Team activities",
    updatedAt: "2026-07-01",
    summary:
      "Team activities should be planned with your manager and submitted under the Team event category.",
    body: "Plan team activities with your manager in advance and submit them under the Team event category with the attendee count. Alcohol is limited to two drinks per person.",
  },
  {
    id: "AP-2.0",
    title: "Approvals Handbook",
    section: "2.0 Approval chain",
    updatedAt: "2026-05-14",
    summary:
      "Reports route to the submitter's manager, then to Finance Operations above $1,000.",
    body: "Reports are approved by the submitter's manager. Reports over $1,000 are also approved by Finance Operations. Approvers may add notes and return a report to the submitter.",
  },
  {
    id: "AP-3.1",
    title: "Approvals Handbook",
    section: "3.1 Policy holds",
    updatedAt: "2026-05-14",
    summary:
      "The policy engine can place a hold on a report. A held report cannot be approved until the hold is cleared.",
    body: "Holds are raised automatically by the policy engine when a report needs attention. Each hold has a code. Resolve the hold, then approve the report.",
  },
  {
    id: "AP-4.2",
    title: "Approvals Handbook",
    section: "4.2 Reimbursement",
    updatedAt: "2026-05-14",
    summary: "Approved reports are reimbursed by ACH on the next payment run.",
    body: "Finance schedules ACH reimbursement for approved reports on the next weekly payment run, usually the following Friday.",
  },
  {
    id: "FIN-7.0",
    title: "Budget Ownership Guide",
    section: "7.0 Cost centers",
    updatedAt: "2026-03-02",
    summary:
      "Every report is charged to a cost center, which defaults to the submitter's department.",
    body: "Cost centers map spend to the budget that owns it. A report defaults to the submitter's home cost center. Budget owners review monthly variance.",
  },
];

interface ReportSpec {
  n: number;
  emp: string;
  title: string;
  category: Category;
  daysAgo: number;
  status: ReportStatus;
  lines: [string, string, number][];
  costCenterId?: string;
}

// [merchant, description, amount]
const SPECS: ReportSpec[] = [
  {
    n: 2291,
    emp: "e_priya",
    title: "Q3 team offsite",
    category: "Team event",
    daysAgo: 3,
    status: "submitted",
    lines: [
      ["Wildwood Lodge", "Venue hire, two days", 2400],
      ["Harvest Table Catering", "Catering for 18", 1560],
      ["Coastline Coaches", "Group transport", 620],
      ["Paper & Pine", "Workshop supplies", 280],
    ],
  },
  {
    n: 2317,
    emp: "e_marcus",
    title: "Platform team summit dinner",
    category: "Team event",
    daysAgo: 1,
    status: "submitted",
    lines: [
      ["Ember & Oak", "Team dinner for 22", 2310],
      ["Ember & Oak", "Private room fee", 450],
      ["CityRide", "Rideshare home", 180],
    ],
  },
  {
    n: 2288,
    emp: "e_daniel",
    title: "Client dinner, Brightwater pilot",
    category: "Client entertainment",
    daysAgo: 4,
    status: "submitted",
    lines: [
      ["Lumen Bistro", "Dinner, 4 attendees", 312.4],
      ["CityRide", "Rideshare", 38.2],
    ],
  },
  {
    n: 2295,
    emp: "e_sofia",
    title: "Design conference, Lisbon",
    category: "Travel",
    daysAgo: 2,
    status: "submitted",
    lines: [
      ["TAP Air", "Return flight", 684],
      ["Hotel Baixa", "3 nights", 597],
      ["DesignWeek", "Conference pass", 450],
    ],
  },
  {
    n: 2299,
    emp: "e_tom",
    title: "Customer onsite, Denver",
    category: "Travel",
    daysAgo: 2,
    status: "submitted",
    lines: [
      ["United", "Return flight", 412.6],
      ["Larimer Suites", "2 nights", 388],
      ["Per diem", "2 days", 136],
    ],
  },
  {
    n: 2301,
    emp: "e_aisha",
    title: "Mechanical keyboard and dock",
    category: "Equipment",
    daysAgo: 2,
    status: "submitted",
    lines: [
      ["Keyworks", "Keyboard", 189],
      ["DockHub", "USB-C dock", 149.99],
    ],
  },
  {
    n: 2303,
    emp: "e_ben",
    title: "Customer QBR lunch",
    category: "Meals",
    daysAgo: 1,
    status: "submitted",
    lines: [["Greenleaf Cafe", "Lunch, 5 attendees", 214.5]],
  },
  {
    n: 2305,
    emp: "e_lucia",
    title: "Trade show booth supplies",
    category: "Office supplies",
    daysAgo: 1,
    status: "submitted",
    lines: [
      ["PrintRight", "Banners and handouts", 865],
      ["FedEx", "Shipping to venue", 142.3],
    ],
  },
  {
    n: 2307,
    emp: "e_kenji",
    title: "Cloud certification exam",
    category: "Training",
    daysAgo: 1,
    status: "submitted",
    lines: [["CertPro", "Exam fee", 300]],
  },
  {
    n: 2309,
    emp: "e_grace",
    title: "Campus recruiting trip",
    category: "Travel",
    daysAgo: 0,
    status: "submitted",
    lines: [
      ["Amtrak", "Train", 96],
      ["Inn on College", "1 night", 214],
      ["Per diem", "1 day", 68],
    ],
  },
  {
    n: 2311,
    emp: "e_omar",
    title: "Regional kickoff travel",
    category: "Travel",
    daysAgo: 0,
    status: "submitted",
    lines: [
      ["Delta", "Return flight", 538.4],
      ["Marriott Midtown", "2 nights", 612],
    ],
  },
  {
    n: 2313,
    emp: "e_elena",
    title: "Analytics tooling seat",
    category: "Software",
    daysAgo: 0,
    status: "submitted",
    lines: [["QueryLab", "Annual seat", 420]],
  },
  {
    n: 2315,
    emp: "e_zoe",
    title: "Team birthday lunch",
    category: "Team event",
    daysAgo: 0,
    status: "submitted",
    lines: [["Noodle Bar", "Lunch for 9", 286.5]],
  },
  {
    n: 2252,
    emp: "e_daniel",
    title: "Prospect breakfast",
    category: "Client entertainment",
    daysAgo: 12,
    status: "approved",
    lines: [["Morning Glory", "Breakfast, 3 attendees", 96.4]],
  },
  {
    n: 2255,
    emp: "e_sofia",
    title: "User research incentives",
    category: "Office supplies",
    daysAgo: 11,
    status: "approved",
    lines: [["GiftHub", "Gift cards, 8 participants", 400]],
  },
  {
    n: 2258,
    emp: "e_aisha",
    title: "Conference travel, Austin",
    category: "Travel",
    daysAgo: 11,
    status: "approved",
    lines: [
      ["Southwest", "Return flight", 318],
      ["Hotel Van Zandt", "2 nights", 548],
    ],
  },
  {
    n: 2261,
    emp: "e_ben",
    title: "Customer workshop catering",
    category: "Meals",
    daysAgo: 10,
    status: "approved",
    lines: [["Harvest Table Catering", "Lunch for 14", 612]],
  },
  {
    n: 2264,
    emp: "e_tom",
    title: "Demo hardware",
    category: "Equipment",
    daysAgo: 9,
    status: "approved",
    lines: [["TechDepot", "Portable monitor", 279]],
  },
  {
    n: 2266,
    emp: "e_lucia",
    title: "Webinar platform add-on",
    category: "Software",
    daysAgo: 9,
    status: "approved",
    lines: [["StreamCast", "Monthly add-on", 149]],
  },
  {
    n: 2270,
    emp: "e_kenji",
    title: "On-call dinner",
    category: "Meals",
    daysAgo: 8,
    status: "approved",
    lines: [["Pho 88", "Dinner", 34.8]],
  },
  {
    n: 2273,
    emp: "e_omar",
    title: "Partner dinner, Chicago",
    category: "Client entertainment",
    daysAgo: 8,
    status: "approved",
    lines: [["Gibsons", "Dinner, 6 attendees", 688.2]],
  },
  {
    n: 2276,
    emp: "e_grace",
    title: "Interview panel lunch",
    category: "Meals",
    daysAgo: 7,
    status: "approved",
    lines: [["Greenleaf Cafe", "Lunch for 6", 132]],
  },
  {
    n: 2279,
    emp: "e_marcus",
    title: "Engineering book club",
    category: "Training",
    daysAgo: 7,
    status: "approved",
    lines: [["Bookshop", "Books, 10 copies", 289.9]],
  },
  {
    n: 2281,
    emp: "e_elena",
    title: "Data summit pass",
    category: "Training",
    daysAgo: 6,
    status: "approved",
    lines: [["DataSummit", "Conference pass", 795]],
  },
  {
    n: 2284,
    emp: "e_sam",
    title: "Replacement laptop charger",
    category: "Equipment",
    daysAgo: 5,
    status: "approved",
    lines: [["TechDepot", "USB-C charger", 79]],
  },
  {
    n: 2201,
    emp: "e_priya",
    title: "Customer visits, Seattle",
    category: "Travel",
    daysAgo: 30,
    status: "reimbursed",
    lines: [
      ["Alaska Air", "Return flight", 344],
      ["Hotel Ballard", "2 nights", 476],
    ],
  },
  {
    n: 2205,
    emp: "e_zoe",
    title: "Stock photography",
    category: "Software",
    daysAgo: 29,
    status: "reimbursed",
    lines: [["StockFrame", "Image pack", 199]],
  },
  {
    n: 2209,
    emp: "e_marcus",
    title: "Hack week snacks",
    category: "Team event",
    daysAgo: 27,
    status: "reimbursed",
    lines: [["Costco", "Snacks and drinks", 412.75]],
  },
  {
    n: 2212,
    emp: "e_daniel",
    title: "Client lunch, renewal",
    category: "Client entertainment",
    daysAgo: 25,
    status: "reimbursed",
    lines: [["Lumen Bistro", "Lunch, 3 attendees", 168.9]],
  },
  {
    n: 2216,
    emp: "e_tom",
    title: "Customer onsite, Phoenix",
    category: "Travel",
    daysAgo: 24,
    status: "reimbursed",
    lines: [
      ["American", "Return flight", 386],
      ["Camelback Inn", "1 night", 289],
    ],
  },
  {
    n: 2219,
    emp: "e_lucia",
    title: "Event sponsorship swag",
    category: "Office supplies",
    daysAgo: 22,
    status: "reimbursed",
    lines: [["SwagCo", "T-shirts and stickers", 940]],
  },
  {
    n: 2223,
    emp: "e_ben",
    title: "Customer dinner, Boston",
    category: "Client entertainment",
    daysAgo: 21,
    status: "reimbursed",
    lines: [["Row 34", "Dinner, 4 attendees", 402.6]],
  },
  {
    n: 2227,
    emp: "e_aisha",
    title: "Mentorship lunch",
    category: "Meals",
    daysAgo: 20,
    status: "reimbursed",
    lines: [["Sweetgreen", "Lunch for 2", 41.3]],
  },
  {
    n: 2231,
    emp: "e_omar",
    title: "Sales offsite, Napa",
    category: "Team event",
    daysAgo: 19,
    status: "reimbursed",
    costCenterId: "CC-410",
    lines: [
      ["Vineyard Inn", "Venue and lodging", 2850],
      ["Harvest Table Catering", "Catering", 1180],
      ["Coastline Coaches", "Group transport", 540],
    ],
  },
  {
    n: 2235,
    emp: "e_kenji",
    title: "Home office chair",
    category: "Equipment",
    daysAgo: 18,
    status: "reimbursed",
    lines: [["ErgoWorks", "Chair", 389]],
  },
  {
    n: 2239,
    emp: "e_grace",
    title: "Job fair registration",
    category: "Training",
    daysAgo: 16,
    status: "reimbursed",
    lines: [["TechCareers", "Booth registration", 650]],
  },
  {
    n: 2243,
    emp: "e_sofia",
    title: "Prototype testing devices",
    category: "Equipment",
    daysAgo: 15,
    status: "reimbursed",
    lines: [["Refurb Hub", "Two test phones", 612]],
  },
  {
    n: 2246,
    emp: "e_elena",
    title: "Team lunch, launch",
    category: "Team event",
    daysAgo: 14,
    status: "reimbursed",
    lines: [["Noodle Bar", "Lunch for 11", 352.4]],
  },
  {
    n: 2249,
    emp: "e_sam",
    title: "Wi-Fi extenders",
    category: "Equipment",
    daysAgo: 13,
    status: "rejected",
    lines: [["NetGear Store", "Two extenders", 238]],
  },
  {
    n: 2297,
    emp: "e_zoe",
    title: "Writing workshop",
    category: "Training",
    daysAgo: 2,
    status: "draft",
    lines: [["WriteLab", "Workshop seat", 260]],
  },
];

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + days);
  return isoDate(dt);
}

const round = (n: number) => Math.round(n * 100) / 100;

export function needsTeamEventHold(r: {
  category: Category;
  total: number;
  costCenterId: string;
}): boolean {
  const cc = COST_CENTERS.find((c) => c.id === r.costCenterId);
  return (
    r.category === "Team event" &&
    r.total > EVENTS_THRESHOLD &&
    cc?.kind !== "events"
  );
}

export function buildSeed(today: string): ExpenseReport[] {
  return SPECS.map((s) => {
    const emp = EMPLOYEES.find((e) => e.id === s.emp)!;
    const submittedAt = addDays(today, -s.daysAgo);
    const lines: LineItem[] = s.lines.map(
      ([merchant, description, amount], i) => ({
        id: `L${s.n}-${i + 1}`,
        date: addDays(submittedAt, -2 - i),
        merchant,
        description,
        amount,
        receipt: true,
      }),
    );
    const total = round(lines.reduce((a, l) => a + l.amount, 0));
    const costCenterId = s.costCenterId ?? emp.homeCostCenterId;
    const report: ExpenseReport = {
      id: `EXP-${s.n}`,
      title: s.title,
      employeeId: emp.id,
      employeeName: emp.name,
      department: emp.department,
      category: s.category,
      submittedAt,
      total,
      status: s.status,
      costCenterId,
      lines,
      notes: [],
      holds: [],
    };
    if (s.status === "submitted" && needsTeamEventHold(report)) {
      report.holds.push({
        code: HOLD_TEAM_EVENT,
        status: "open",
        raisedAt: submittedAt,
      });
    }
    if (s.status === "approved" || s.status === "reimbursed") {
      report.approvedAt = addDays(submittedAt, 1);
      report.approvedBy = CURRENT_USER.name;
    }
    if (s.status === "reimbursed") {
      report.reimbursement = {
        scheduledFor: addDays(submittedAt, 5),
        method: "ACH",
        reference: `ACH-${s.n + 60000}`,
      };
    }
    return report;
  });
}

/** The activity feed implied by the seed: who did what to which report, newest first. */
export function buildActivity(reports: ExpenseReport[]): Activity[] {
  const out: Activity[] = [];
  for (const r of reports) {
    if (r.status === "draft") continue;
    out.push({
      id: `A-${r.id}-s`,
      at: `${r.submittedAt}T09:12:00`,
      actor: r.employeeName,
      kind: "submitted",
      reportId: r.id,
      text: `submitted ${r.title}`,
    });
    for (const h of r.holds) {
      out.push({
        id: `A-${r.id}-h`,
        at: `${h.raisedAt}T09:12:30`,
        actor: "Policy engine",
        kind: "hold",
        reportId: r.id,
        text: `placed hold ${h.code} on ${r.title}`,
      });
    }
    if (r.approvedAt)
      out.push({
        id: `A-${r.id}-a`,
        at: `${r.approvedAt}T14:05:00`,
        actor: r.approvedBy ?? CURRENT_USER.name,
        kind: "approved",
        reportId: r.id,
        text: `approved ${r.title}`,
      });
    if (r.reimbursement)
      out.push({
        id: `A-${r.id}-r`,
        at: `${r.reimbursement.scheduledFor}T08:00:00`,
        actor: "Ledgerline Payments",
        kind: "reimbursed",
        reportId: r.id,
        text: `reimbursed ${r.employeeName} by ACH`,
      });
    if (r.status === "rejected")
      out.push({
        id: `A-${r.id}-x`,
        at: `${addDays(r.submittedAt, 1)}T10:30:00`,
        actor: CURRENT_USER.name,
        kind: "rejected",
        reportId: r.id,
        text: `returned ${r.title} to the submitter`,
      });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
