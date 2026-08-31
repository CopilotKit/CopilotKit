import { describe, it, expect } from "vitest";
import {
  groupDealsByStage,
  formatCurrency,
  STAGES,
  dealRisk,
  computeKpis,
  applyStageOverlay,
  pruneOverlay,
  relativeTime,
  salesOverTime,
  revenueByCategory,
  teamLeaderboard,
  teamStats,
  repStats,
} from "./crm.js";
import type { Deal, CrmState, Product, Salesperson } from "./crm.js";

const d = (id: string, stage: Deal["stage"]): Deal => ({
  id,
  accountId: "a",
  name: id,
  amount: 1000,
  stage,
  probability: 50,
  closeDate: "2026-01-01",
  ownerName: "You",
  ownerId: "s1",
  lineItems: [],
});

describe("crm lib", () => {
  it("groupDealsByStage buckets by stage in canonical order", () => {
    const g = groupDealsByStage([d("x", "Proposal"), d("y", "Lead")]);
    expect(Object.keys(g)).toEqual(STAGES);
    expect(g["Lead"].map((x) => x.id)).toEqual(["y"]);
    expect(g["Proposal"].map((x) => x.id)).toEqual(["x"]);
  });

  it("formatCurrency renders whole-dollar USD", () => {
    expect(formatCurrency(42000)).toBe("$42,000");
  });
});

const NOW = new Date("2026-06-03T00:00:00Z").getTime();
const mk = (over: Partial<Deal>): Deal => ({
  id: "d",
  accountId: "a",
  name: "d",
  amount: 10000,
  stage: "Qualified",
  probability: 50,
  closeDate: "2026-09-01",
  ownerName: "You",
  ownerId: "s1",
  lineItems: [],
  ...over,
});

describe("dealRisk", () => {
  it("is low for closed deals regardless of dates", () => {
    expect(
      dealRisk(
        mk({ stage: "Closed Won", probability: 0, closeDate: "2020-01-01" }),
        NOW,
      ),
    ).toBe("low");
    expect(dealRisk(mk({ stage: "Closed Lost" }), NOW)).toBe("low");
  });
  it("is high for low probability or past close on open deals", () => {
    expect(dealRisk(mk({ probability: 20 }), NOW)).toBe("high");
    expect(dealRisk(mk({ closeDate: "2026-05-01" }), NOW)).toBe("high");
  });
  it("is medium for mid probability or near close", () => {
    expect(
      dealRisk(mk({ probability: 50, closeDate: "2026-09-01" }), NOW),
    ).toBe("medium");
    expect(
      dealRisk(mk({ probability: 80, closeDate: "2026-06-10" }), NOW),
    ).toBe("medium");
  });
  it("is low for strong, far-out open deals", () => {
    expect(
      dealRisk(mk({ probability: 80, closeDate: "2026-12-01" }), NOW),
    ).toBe("low");
  });
});

describe("computeKpis", () => {
  const crm: CrmState = {
    accounts: [],
    contacts: [],
    activities: [],
    products: [],
    salespeople: [],
    reports: [],
    quotes: [],
    deals: [
      mk({
        id: "1",
        amount: 40000,
        probability: 50,
        stage: "Qualified",
        closeDate: "2026-12-01",
      }),
      mk({
        id: "2",
        amount: 20000,
        probability: 20,
        stage: "Lead",
        closeDate: "2026-12-01",
      }),
      mk({ id: "3", amount: 30000, stage: "Closed Won" }),
      mk({ id: "4", amount: 10000, stage: "Closed Lost" }),
    ],
  };
  it("sums open pipeline (excludes closed)", () => {
    expect(computeKpis(crm, NOW).openPipeline).toBe(60000);
  });
  it("computes weighted forecast over open deals", () => {
    expect(computeKpis(crm, NOW).weightedForecast).toBe(24000);
  });
  it("computes win rate from closed deals", () => {
    expect(computeKpis(crm, NOW).winRate).toBeCloseTo(0.5);
  });
  it("counts at-risk open deals", () => {
    expect(computeKpis(crm, NOW).atRisk).toBe(2);
  });
  it("win rate is null with no closed deals", () => {
    expect(
      computeKpis({ ...crm, deals: [crm.deals[0]] }, NOW).winRate,
    ).toBeNull();
  });
});

function baseState(): CrmState {
  return {
    deals: [
      {
        id: "d1",
        accountId: "a1",
        name: "D1",
        amount: 1000,
        stage: "Proposal",
        probability: 60,
        closeDate: "2026-07-01",
        ownerName: "You",
        ownerId: "s1",
        lineItems: [],
      },
      {
        id: "d2",
        accountId: "a1",
        name: "D2",
        amount: 2000,
        stage: "Lead",
        probability: 20,
        closeDate: "2026-07-01",
        ownerName: "You",
        ownerId: "s1",
        lineItems: [],
      },
    ],
    accounts: [],
    contacts: [],
    activities: [],
    products: [],
    salespeople: [],
    reports: [],
    quotes: [],
  };
}

describe("applyStageOverlay", () => {
  it("returns the same object when overlay is empty", () => {
    const s = baseState();
    expect(applyStageOverlay(s, {})).toBe(s);
  });
  it("overrides a deal's stage", () => {
    const out = applyStageOverlay(baseState(), { d1: "Negotiation" });
    expect(out.deals.find((d) => d.id === "d1")!.stage).toBe("Negotiation");
    expect(out.deals.find((d) => d.id === "d2")!.stage).toBe("Lead");
  });
  it("sets probability 100/0 for Closed Won/Lost", () => {
    expect(
      applyStageOverlay(baseState(), { d1: "Closed Won" }).deals[0].probability,
    ).toBe(100);
    expect(
      applyStageOverlay(baseState(), { d1: "Closed Lost" }).deals[0]
        .probability,
    ).toBe(0);
  });
});

describe("pruneOverlay", () => {
  it("drops entries the base already reflects", () => {
    expect(pruneOverlay(baseState(), { d1: "Proposal" })).toEqual({});
  });
  it("keeps entries not yet reflected", () => {
    expect(pruneOverlay(baseState(), { d1: "Negotiation" })).toEqual({
      d1: "Negotiation",
    });
  });
  it("drops entries for deals that no longer exist", () => {
    expect(pruneOverlay(baseState(), { gone: "Lead" })).toEqual({});
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-04T12:00:00.000Z").getTime();
  it("formats minutes", () => {
    expect(relativeTime("2026-06-04T11:30:00.000Z", now)).toBe("30m ago");
  });
  it("formats hours", () => {
    expect(relativeTime("2026-06-04T09:00:00.000Z", now)).toBe("3h ago");
  });
  it("formats days", () => {
    expect(relativeTime("2026-06-01T12:00:00.000Z", now)).toBe("3d ago");
  });
});

// --- analytics fixtures ----------------------------------------------------
const PRODUCTS: Product[] = [
  {
    id: "p1",
    name: "Laptop",
    category: "Laptop",
    sku: "L",
    unitPrice: 1000,
    photoUrl: "",
    specs: "",
    blurb: "",
  },
  {
    id: "p2",
    name: "Server",
    category: "Server",
    sku: "S",
    unitPrice: 5000,
    photoUrl: "",
    specs: "",
    blurb: "",
  },
  {
    id: "p3",
    name: "Mouse",
    category: "Accessory",
    sku: "M",
    unitPrice: 50,
    photoUrl: "",
    specs: "",
    blurb: "",
  },
];
const REPS: Salesperson[] = [
  {
    id: "s1",
    name: "Ann",
    email: "a@x.com",
    avatarUrl: "",
    role: "AE",
    region: "West",
    quota: 100000,
  },
  {
    id: "s2",
    name: "Bob",
    email: "b@x.com",
    avatarUrl: "",
    role: "AE",
    region: "East",
    quota: 50000,
  },
  {
    id: "s3",
    name: "Cleo",
    email: "c@x.com",
    avatarUrl: "",
    role: "Manager",
    region: "Central",
    quota: 0,
  },
];
// NOW = 2026-06-03 → 8-month window keys: 2025-11 .. 2026-06
function analyticsState(): CrmState {
  return {
    accounts: [],
    contacts: [],
    activities: [],
    reports: [],
    quotes: [],
    products: PRODUCTS,
    salespeople: REPS,
    deals: [
      // s1: two won (Apr + Jun 2026) = 70000 bookings, one open (lineItems 2×Laptop + 1×Server = 7000)
      mk({
        id: "w1",
        ownerId: "s1",
        amount: 30000,
        stage: "Closed Won",
        closeDate: "2026-04-15",
      }),
      mk({
        id: "w2",
        ownerId: "s1",
        amount: 40000,
        stage: "Closed Won",
        closeDate: "2026-06-02",
      }),
      mk({
        id: "o1",
        ownerId: "s1",
        amount: 7000,
        stage: "Proposal",
        closeDate: "2026-09-01",
        lineItems: [
          { productId: "p1", qty: 2, unitPrice: 1000 },
          { productId: "p2", qty: 1, unitPrice: 5000 },
        ],
      }),
      // s2: one won (Jan 2026) = 12000, one lost, one open (1×Server = 5000)
      mk({
        id: "w3",
        ownerId: "s2",
        amount: 12000,
        stage: "Closed Won",
        closeDate: "2026-01-20",
      }),
      mk({
        id: "l1",
        ownerId: "s2",
        amount: 9000,
        stage: "Closed Lost",
        closeDate: "2026-02-01",
      }),
      mk({
        id: "o2",
        ownerId: "s2",
        amount: 5000,
        stage: "Qualified",
        closeDate: "2026-08-01",
        lineItems: [{ productId: "p2", qty: 1, unitPrice: 5000 }],
      }),
      // out-of-window won (should NOT appear in salesOverTime/trend): Jan 2025
      mk({
        id: "old",
        ownerId: "s1",
        amount: 99000,
        stage: "Closed Won",
        closeDate: "2025-01-10",
      }),
    ],
  };
}

describe("salesOverTime", () => {
  it("returns 8 ascending months including zero months", () => {
    const series = salesOverTime(analyticsState(), NOW);
    expect(series.map((p) => p.month)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(series.map((p) => p.label)).toEqual([
      "Nov",
      "Dec",
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
    ]);
  });
  it("sums Closed-Won amount by close month, ignoring open/lost and out-of-window", () => {
    const series = salesOverTime(analyticsState(), NOW);
    const byMonth = Object.fromEntries(
      series.map((p) => [p.month, p.bookings]),
    );
    expect(byMonth["2026-01"]).toBe(12000); // s2 w3
    expect(byMonth["2026-04"]).toBe(30000); // s1 w1
    expect(byMonth["2026-06"]).toBe(40000); // s1 w2
    expect(byMonth["2026-02"]).toBe(0); // lost deal excluded
    expect(byMonth["2025-12"]).toBe(0); // empty month
  });
});

describe("revenueByCategory", () => {
  it("sums OPEN deals' line items by category and skips zero", () => {
    const out = revenueByCategory(analyticsState());
    const byCat = Object.fromEntries(out.map((c) => [c.category, c.value]));
    // open line items: o1 = 2×1000 Laptop + 1×5000 Server; o2 = 1×5000 Server
    expect(byCat["Laptop"]).toBe(2000);
    expect(byCat["Server"]).toBe(10000);
    expect(byCat["Accessory"]).toBeUndefined(); // no open accessory line items
    expect(out.every((c) => c.value > 0)).toBe(true);
  });
});

describe("teamLeaderboard", () => {
  it("aggregates per rep and sorts by bookings desc", () => {
    const rows = teamLeaderboard(analyticsState(), NOW);
    expect(rows.map((r) => r.salespersonId)).toEqual(["s1", "s2", "s3"]);
    const s1 = rows.find((r) => r.salespersonId === "s1")!;
    expect(s1.bookings).toBe(30000 + 40000 + 99000); // all s1 won (incl out-of-window; leaderboard is all-time)
    expect(s1.openPipeline).toBe(7000);
    expect(s1.attainment).toBeCloseTo((30000 + 40000 + 99000) / 100000);
    expect(s1.dealCount).toBe(4);
    const s2 = rows.find((r) => r.salespersonId === "s2")!;
    expect(s2.bookings).toBe(12000);
    expect(s2.openPipeline).toBe(5000);
  });
  it("uses attainment 0 when quota is 0", () => {
    const s3 = teamLeaderboard(analyticsState(), NOW).find(
      (r) => r.salespersonId === "s3",
    )!;
    expect(s3.attainment).toBe(0);
    expect(s3.quota).toBe(0);
    expect(s3.dealCount).toBe(0);
  });
});

describe("repStats", () => {
  it("returns null for an unknown rep", () => {
    expect(repStats(analyticsState(), "nope", NOW)).toBeNull();
  });
  it("computes bookings, pipeline, attainment, winRate, dealCount and an 8-point trend", () => {
    const r = repStats(analyticsState(), "s1", NOW)!;
    expect(r.rep.name).toBe("Ann");
    expect(r.bookings).toBe(30000 + 40000 + 99000);
    expect(r.openPipeline).toBe(7000);
    expect(r.attainment).toBeCloseTo((30000 + 40000 + 99000) / 100000);
    expect(r.winRate).toBe(1); // 2 won, 0 lost (out-of-window won counts; no lost for s1)
    expect(r.dealCount).toBe(4);
    expect(r.trend).toHaveLength(8);
    // trend mirrors salesOverTime months: Apr=30000, Jun=40000, rest 0 (out-of-window excluded)
    expect(r.trend).toEqual([0, 0, 0, 0, 0, 30000, 0, 40000]);
    expect(r.deals.map((d) => d.id).sort()).toEqual(["o1", "old", "w1", "w2"]);
  });
  it("computes winRate from won and lost for a rep with both", () => {
    const r = repStats(analyticsState(), "s2", NOW)!;
    expect(r.winRate).toBeCloseTo(0.5); // 1 won, 1 lost
    expect(r.bookings).toBe(12000);
  });
});

describe("teamStats", () => {
  it("aggregates whole-team bookings, forecast, win rate, leaderboard, and category mix", () => {
    const ts = teamStats(analyticsState(), NOW);
    expect(ts.totalBookings).toBe(30000 + 40000 + 12000 + 99000); // all Closed-Won, all-time = 181000
    expect(ts.weightedForecast).toBe(6000); // open: o1 7000×0.5 + o2 5000×0.5
    expect(ts.winRate).toBeCloseTo(0.8); // 4 won / (4 won + 1 lost)
    expect(ts.leaderboard.map((r) => r.salespersonId)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
    expect(ts.leaderboard[0].bookings).toBe(30000 + 40000 + 99000); // s1 = 169000
    const byCat = Object.fromEntries(
      ts.byCategory.map((c) => [c.category, c.value]),
    );
    expect(byCat["Laptop"]).toBe(2000);
    expect(byCat["Server"]).toBe(10000);
  });

  it("win rate is null when there are no closed deals", () => {
    const open = teamStats(
      { ...analyticsState(), deals: [mk({ stage: "Qualified" })] },
      NOW,
    );
    expect(open.winRate).toBeNull();
  });
});
