import type {
  Account,
  Contact,
  Deal,
  Activity,
  Product,
  Salesperson,
  Report,
} from "./types.js";

/**
 * Static enterprise-hardware seed for "Northstar AI CRM", a fictional company
 * that sells enterprise computers (laptops, workstations, servers, displays,
 * accessories) to other businesses.
 *
 * Determinism: every timestamp/date is STATIC (no Date.now()); the in-fiction
 * "today" is 2026-06-04. Account ids (a1–a6) and contact ids are kept stable;
 * CopilotKit stays a6 as a hero prospect. Each deal's `amount` is the
 * authoritative total and equals Σ(lineItem.qty × lineItem.unitPrice).
 */
export function seed(): {
  accounts: Account[];
  contacts: Contact[];
  deals: Deal[];
  activities: Activity[];
  products: Product[];
  salespeople: Salesperson[];
  reports: Report[];
} {
  const accounts: Account[] = [
    {
      id: "a1",
      name: "Acme Corp",
      domain: "acme.com",
      industry: "Manufacturing",
      sizeEmployees: 1200,
      location: "Columbus, OH",
    },
    {
      id: "a2",
      name: "Globex",
      domain: "globex.com",
      industry: "Logistics",
      sizeEmployees: 540,
      location: "Austin, TX",
    },
    {
      id: "a3",
      name: "Initech",
      domain: "initech.com",
      industry: "Software",
      sizeEmployees: 80,
      location: "Palo Alto, CA",
    },
    {
      id: "a4",
      name: "Umbrella Health",
      domain: "umbrellahealth.com",
      industry: "Healthcare",
      sizeEmployees: 3100,
      location: "Boston, MA",
    },
    {
      id: "a5",
      name: "Soylent Foods",
      domain: "soylentfoods.com",
      industry: "CPG",
      sizeEmployees: 260,
      location: "Denver, CO",
    },
    {
      id: "a6",
      name: "CopilotKit",
      domain: "copilotkit.ai",
      industry: "Developer Tools",
      sizeEmployees: 30,
      location: "Remote",
    },
  ];

  const contacts: Contact[] = [
    {
      id: "c1",
      accountId: "a1",
      name: "Dana Reyes",
      title: "VP Operations",
      email: "dana@acme.com",
    },
    {
      id: "c2",
      accountId: "a2",
      name: "Sam Patel",
      title: "Head of Logistics",
      email: "sam@globex.com",
    },
    {
      id: "c3",
      accountId: "a3",
      name: "Lee Carter",
      title: "CTO",
      email: "lee@initech.com",
    },
    {
      id: "c4",
      accountId: "a4",
      name: "Morgan Hsu",
      title: "Director of IT",
      email: "morgan@umbrellahealth.com",
    },
    {
      id: "c5",
      accountId: "a5",
      name: "Ravi Shah",
      title: "COO",
      email: "ravi@soylentfoods.com",
    },
    {
      id: "c6",
      accountId: "a6",
      name: "Atai Barkai",
      title: "CEO & Co-founder",
      email: "atai@copilotkit.ai",
    },
    {
      id: "c7",
      accountId: "a6",
      name: "Jerel Velarde",
      title: "Developer Relations",
      email: "jerel@copilotkit.ai",
    },
    {
      id: "c8",
      accountId: "a1",
      name: "Marcus Lin",
      title: "CFO",
      email: "marcus@acme.com",
    },
    {
      id: "c9",
      accountId: "a1",
      name: "Priya Nair",
      title: "IT Manager",
      email: "priya@acme.com",
    },
    {
      id: "c10",
      accountId: "a2",
      name: "Elena Cruz",
      title: "VP Finance",
      email: "elena@globex.com",
    },
    {
      id: "c11",
      accountId: "a3",
      name: "Tom Becker",
      title: "Eng Lead",
      email: "tom@initech.com",
    },
    {
      id: "c12",
      accountId: "a4",
      name: "Sofia Marin",
      title: "Compliance Officer",
      email: "sofia@umbrellahealth.com",
    },
    {
      id: "c13",
      accountId: "a4",
      name: "Derek Olsen",
      title: "CISO",
      email: "derek@umbrellahealth.com",
    },
    {
      id: "c14",
      accountId: "a5",
      name: "Hana Kim",
      title: "Head of Supply",
      email: "hana@soylentfoods.com",
    },
  ];

  // -------------------------------------------------------------------------
  // Product catalog — 12 SKUs across all 5 categories. Prices are chosen so
  // deal line items sum cleanly to each deal's authoritative `amount`.
  // Photos are stable Unsplash CDN urls (plain <img> in the UI, w=640&q=80).
  // -------------------------------------------------------------------------
  const products: Product[] = [
    {
      id: "p1",
      name: "Northstar Pro 14",
      category: "Laptop",
      sku: "NS-PRO-14",
      unitPrice: 1800,
      photoUrl:
        "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=640&q=80",
      specs: '14" · 32GB · 1TB SSD · i7',
      blurb:
        "Featherweight pro laptop for everyday sales and engineering work.",
    },
    {
      id: "p2",
      name: "Northstar Pro 16",
      category: "Laptop",
      sku: "NS-PRO-16",
      unitPrice: 2400,
      photoUrl:
        "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=640&q=80",
      specs: '16" · 64GB · 2TB SSD · i9',
      blurb: "Big-screen powerhouse for power users who travel.",
    },
    {
      id: "p3",
      name: "Northstar Air 13",
      category: "Laptop",
      sku: "NS-AIR-13",
      unitPrice: 1200,
      photoUrl:
        "https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=640&q=80",
      specs: '13" · 16GB · 512GB SSD · i5',
      blurb: "Ultraportable for fleets and field teams.",
    },
    {
      id: "p4",
      name: "Apex Tower WS",
      category: "Workstation",
      sku: "AX-TWR-WS",
      unitPrice: 4500,
      photoUrl:
        "https://images.unsplash.com/photo-1587202372775-e229f172b9d7?w=640&q=80",
      specs: "Xeon · 128GB · RTX A5000 · 4TB",
      blurb: "Deskside workstation for CAD, simulation, and ML.",
    },
    {
      id: "p5",
      name: "Apex Mini WS",
      category: "Workstation",
      sku: "AX-MIN-WS",
      unitPrice: 3000,
      photoUrl:
        "https://images.unsplash.com/photo-1593640408182-31c70c8268f5?w=640&q=80",
      specs: "Ryzen 9 · 64GB · RTX A2000 · 2TB",
      blurb: "Compact workstation that fits any desk.",
    },
    {
      id: "p6",
      name: "EdgeRack R1 Server",
      category: "Server",
      sku: "ER-R1-SRV",
      unitPrice: 9000,
      photoUrl:
        "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=640&q=80",
      specs: "1U · dual Xeon · 256GB · 8TB NVMe",
      blurb: "Dense 1U rack server for edge and core workloads.",
    },
    {
      id: "p7",
      name: "EdgeRack R2 Server",
      category: "Server",
      sku: "ER-R2-SRV",
      unitPrice: 13000,
      photoUrl:
        "https://images.unsplash.com/photo-1606857521015-7f9fcf423740?w=640&q=80",
      specs: "2U · quad Xeon · 512GB · 16TB NVMe",
      blurb: "High-density 2U server for virtualization at scale.",
    },
    {
      id: "p8",
      name: "Vivid 27 4K Display",
      category: "Display",
      sku: "VV-27-4K",
      unitPrice: 600,
      photoUrl:
        "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=640&q=80",
      specs: '27" · 4K · IPS · USB-C 90W',
      blurb: "Color-accurate 4K panel with single-cable docking.",
    },
    {
      id: "p9",
      name: "Vivid 32 5K Display",
      category: "Display",
      sku: "VV-32-5K",
      unitPrice: 1000,
      photoUrl:
        "https://images.unsplash.com/photo-1547119957-637f8679db1e?w=640&q=80",
      specs: '32" · 5K · IPS · 99% DCI-P3',
      blurb: "Reference-grade 5K display for creative pros.",
    },
    {
      id: "p10",
      name: "Northstar Dock Pro",
      category: "Accessory",
      sku: "NS-DOCK-PRO",
      unitPrice: 300,
      photoUrl:
        "https://images.unsplash.com/photo-1625842268584-8f3296236761?w=640&q=80",
      specs: "Thunderbolt 4 · 11 ports · 96W PD",
      blurb: "One-cable desk dock for the whole fleet.",
    },
    {
      id: "p11",
      name: "Northstar Wireless Combo",
      category: "Accessory",
      sku: "NS-KB-COMBO",
      unitPrice: 150,
      photoUrl:
        "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=640&q=80",
      specs: "Backlit keyboard + precision mouse",
      blurb: "Quiet, durable keyboard-and-mouse set for every desk.",
    },
    {
      id: "p12",
      name: "Northstar 4K Webcam",
      category: "Accessory",
      sku: "NS-CAM-4K",
      unitPrice: 200,
      photoUrl:
        "https://images.unsplash.com/photo-1622957461168-202e611c8765?w=640&q=80",
      specs: "4K30 · auto-framing · dual mics",
      blurb: "Boardroom-quality webcam for hybrid teams.",
    },
  ];

  // Fast price lookup so line-item unitPrice always matches catalog price.
  const price = (id: string): number => {
    const p = products.find((x) => x.id === id);
    if (!p) throw new Error(`seed: unknown product ${id}`);
    return p.unitPrice;
  };
  const li = (productId: string, qty: number) => ({
    productId,
    qty,
    unitPrice: price(productId),
  });

  // -------------------------------------------------------------------------
  // Sales team — 5 reps incl. Nathan Brooks (the signed-in AE) and a Manager.
  // Static Unsplash portrait avatars; quarterly quotas in USD.
  // -------------------------------------------------------------------------
  const salespeople: Salesperson[] = [
    {
      id: "s1",
      name: "Nathan Brooks",
      email: "nathan@northstar.example",
      role: "AE",
      region: "West",
      quota: 300000,
      avatarUrl:
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=160&q=80",
    },
    {
      id: "s2",
      name: "Maya Chen",
      email: "maya@northstar.example",
      role: "AE",
      region: "East",
      quota: 320000,
      avatarUrl:
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=160&q=80",
    },
    {
      id: "s3",
      name: "Diego Alvarez",
      email: "diego@northstar.example",
      role: "AE",
      region: "Central",
      quota: 280000,
      avatarUrl:
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=160&q=80",
    },
    {
      id: "s4",
      name: "Priya Okafor",
      email: "priya.o@northstar.example",
      role: "SDR",
      region: "West",
      quota: 120000,
      avatarUrl:
        "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=160&q=80",
    },
    {
      id: "s5",
      name: "Sandra Whitfield",
      email: "sandra@northstar.example",
      role: "Manager",
      region: "West",
      quota: 0,
      avatarUrl:
        "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=160&q=80",
    },
  ];
  const repName = (id: string): string => {
    const s = salespeople.find((x) => x.id === id);
    if (!s) throw new Error(`seed: unknown salesperson ${id}`);
    return s.name;
  };

  // -------------------------------------------------------------------------
  // Deals — reframed as enterprise-hardware orders. d1–d7 keep their original
  // amount/stage/probability/closeDate (so the prioritize/brief tests stay
  // valid); d8–d11 add more Closed-Won across reps and months so the
  // leaderboard / win-rate / sales-over-time look populated.
  //
  // Every deal's `amount` === Σ(qty × unitPrice) of its lineItems (asserted in
  // seed tests). Owners are spread across s1–s4 (Nathan keeps the hero deals).
  // -------------------------------------------------------------------------
  const rawDeals: Array<
    Omit<Deal, "ownerName" | "amount"> & { amount: number }
  > = [
    // d1 Acme — 42000 = 20×p1(1800) + 5×p4(4500) - ... -> use 20×1800=36000 + 2×p5(3000)=6000 => 42000
    {
      id: "d1",
      accountId: "a1",
      name: "Acme — 20× Pro 14 + workstation refresh",
      amount: 42000,
      stage: "Qualified",
      probability: 40,
      closeDate: "2026-07-15",
      ownerId: "s1",
      lineItems: [li("p1", 20), li("p5", 2)],
    },
    // d2 Globex — 88000 = 6×p7(13000)=78000 + 10×p3? no -> 78000 + 10×1000(p9)=88000
    {
      id: "d2",
      accountId: "a2",
      name: "Globex — 6× EdgeRack R2 + display wall",
      amount: 88000,
      stage: "Proposal",
      probability: 60,
      closeDate: "2026-06-30",
      ownerId: "s2",
      lineItems: [li("p7", 6), li("p9", 10)],
    },
    // d3 Initech — 15000 = 10×p3(1200)=12000 + 20×p8? no -> 12000 + 10×p10(300)=3000 =15000
    {
      id: "d3",
      accountId: "a3",
      name: "Initech — 10× Air 13 dev fleet",
      amount: 15000,
      stage: "Lead",
      probability: 20,
      closeDate: "2026-08-20",
      ownerId: "s3",
      lineItems: [li("p3", 10), li("p10", 10)],
    },
    // d4 Umbrella — 130000 = 50×p2(2400)=120000 + 10×p9(1000)=10000 =130000
    {
      id: "d4",
      accountId: "a4",
      name: "Umbrella — 50× Pro 16 clinical rollout",
      amount: 130000,
      stage: "Negotiation",
      probability: 75,
      closeDate: "2026-06-18",
      ownerId: "s1",
      lineItems: [li("p2", 50), li("p9", 10)],
    },
    // d5 Soylent — 54000 = 30×p1(1800)=54000
    {
      id: "d5",
      accountId: "a5",
      name: "Soylent — 30× Pro 14 ops fleet",
      amount: 54000,
      stage: "Lead",
      probability: 15,
      closeDate: "2026-09-01",
      ownerId: "s2",
      lineItems: [li("p1", 30)],
    },
    // d6 Globex — 36000 = 4×p6(9000)=36000 (Closed Won, May)
    {
      id: "d6",
      accountId: "a2",
      name: "Globex — 4× EdgeRack R1 expansion",
      amount: 36000,
      stage: "Closed Won",
      probability: 100,
      closeDate: "2026-05-10",
      ownerId: "s2",
      lineItems: [li("p6", 4)],
    },
    // d7 CopilotKit — 60000 = 30×p2(2400)=72000? no -> 25×p1(1800)=45000 + 5×p4? no
    //   -> 30×p1(1800)=54000 + 20×p10(300)=6000 = 60000
    {
      id: "d7",
      accountId: "a6",
      name: "CopilotKit — 30× Pro 14 studio fleet",
      amount: 60000,
      stage: "Qualified",
      probability: 40,
      closeDate: "2026-08-15",
      ownerId: "s1",
      lineItems: [li("p1", 30), li("p10", 20)],
    },
    // ---- Added deals (d8–d11): several Closed Won across reps and months ----
    // d8 Acme — Closed Won March = 25×p1(1800)=45000 + 5×p4(4500)=22500 ... pick 20×1800=36000 + 8×p8(600)=4800 -> 40800
    //   keep round: 20×p1(1800)=36000 + 10×p9(1000)=10000 = 46000 (Mar)
    {
      id: "d8",
      accountId: "a1",
      name: "Acme — 20× Pro 14 Q1 refresh",
      amount: 46000,
      stage: "Closed Won",
      probability: 100,
      closeDate: "2026-03-12",
      ownerId: "s1",
      lineItems: [li("p1", 20), li("p9", 10)],
    },
    // d9 Initech — Closed Won April = 5×p4(4500)=22500 + 5×p8(600)=3000 = 25500
    {
      id: "d9",
      accountId: "a3",
      name: "Initech — 5× Apex Tower build-out",
      amount: 25500,
      stage: "Closed Won",
      probability: 100,
      closeDate: "2026-04-22",
      ownerId: "s3",
      lineItems: [li("p4", 5), li("p8", 5)],
    },
    // d10 Umbrella — Closed Won May = 6×p7(13000)=78000 + 20×p8(600)=12000 = 90000
    {
      id: "d10",
      accountId: "a4",
      name: "Umbrella — 6× EdgeRack R2 data center",
      amount: 90000,
      stage: "Closed Won",
      probability: 100,
      closeDate: "2026-05-28",
      ownerId: "s2",
      lineItems: [li("p7", 6), li("p8", 20)],
    },
    // d11 Soylent — Closed Lost (for win-rate) = 10×p1(1800)=18000
    {
      id: "d11",
      accountId: "a5",
      name: "Soylent — 10× Pro 14 pilot",
      amount: 18000,
      stage: "Closed Lost",
      probability: 0,
      closeDate: "2026-04-15",
      ownerId: "s3",
      lineItems: [li("p1", 10)],
    },
  ];

  const deals: Deal[] = rawDeals.map((d) => ({
    ...d,
    ownerName: repName(d.ownerId),
  }));

  const activities: Activity[] = [
    {
      id: "ac1",
      dealId: "d2",
      type: "call",
      body: "Discovery call — pain is aging logistics laptops and no docking.",
      createdAt: "2026-05-28T15:00:00.000Z",
    },
    {
      id: "ac2",
      dealId: "d4",
      type: "meeting",
      body: "Security review with IT for the clinical laptop rollout. Need SOC2 details.",
      createdAt: "2026-05-30T17:30:00.000Z",
    },
    {
      id: "ac3",
      dealId: "d1",
      type: "note",
      body: "Champion: Dana. Budget owner is CFO. Standardizing on Pro 14.",
      createdAt: "2026-05-29T12:00:00.000Z",
    },
    {
      id: "ac4",
      dealId: "d7",
      type: "note",
      body: "Inbound from the AG-UI community — outfitting a new studio fleet.",
      createdAt: "2026-06-04T09:00:00.000Z",
    },
    {
      id: "ac5",
      dealId: "d1",
      type: "email",
      body: "Sent hardware ROI one-pager to Dana; she'll loop in the CFO.",
      createdAt: "2026-05-31T16:10:00.000Z",
    },
    {
      id: "ac6",
      dealId: "d1",
      type: "meeting",
      body: "Demo with ops team — strong interest in the Pro 14 + dock combo.",
      createdAt: "2026-06-02T18:00:00.000Z",
    },
    {
      id: "ac7",
      dealId: "d2",
      type: "email",
      body: "Proposal v2 sent with EdgeRack R2 + display-wall pricing tiers.",
      createdAt: "2026-06-01T14:20:00.000Z",
    },
    {
      id: "ac8",
      dealId: "d2",
      type: "note",
      body: "Procurement wants a 3-year term; flagged to deal desk.",
      createdAt: "2026-06-03T13:05:00.000Z",
    },
    {
      id: "ac9",
      dealId: "d3",
      type: "call",
      body: "Intro call — small team, evaluating 10 Air 13 dev laptops.",
      createdAt: "2026-05-27T19:30:00.000Z",
    },
    {
      id: "ac10",
      dealId: "d4",
      type: "email",
      body: "Shared SOC2 Type II report and DPA with Sofia.",
      createdAt: "2026-06-01T15:45:00.000Z",
    },
    {
      id: "ac11",
      dealId: "d4",
      type: "call",
      body: "Pricing negotiation — pushing for annual prepay discount.",
      createdAt: "2026-06-03T17:00:00.000Z",
    },
    {
      id: "ac12",
      dealId: "d4",
      type: "meeting",
      body: "Exec sync; CISO Derek joined, security questions resolved.",
      createdAt: "2026-06-04T16:00:00.000Z",
    },
    {
      id: "ac13",
      dealId: "d5",
      type: "note",
      body: "Champion left; need to re-qualify the ops fleet with new COO.",
      createdAt: "2026-05-26T11:00:00.000Z",
    },
    {
      id: "ac14",
      dealId: "d6",
      type: "note",
      body: "EdgeRack R1 expansion closed-won; install scheduled next month.",
      createdAt: "2026-05-10T20:00:00.000Z",
    },
    {
      id: "ac15",
      dealId: "d7",
      type: "call",
      body: "Fleet scoping with Atai — focus on lightweight Pro 14 for the team.",
      createdAt: "2026-06-02T22:00:00.000Z",
    },
    {
      id: "ac16",
      dealId: "d7",
      type: "email",
      body: "Sent quote draft to Jerel for review.",
      createdAt: "2026-06-03T18:30:00.000Z",
    },
  ];

  // -------------------------------------------------------------------------
  // One prior completed weekly report so /reports is never empty. Metrics are
  // a static snapshot for the May 25–31 period (not recomputed from the seed).
  // -------------------------------------------------------------------------
  const reports: Report[] = [
    {
      id: "r1",
      title: "Weekly Sales Report — May 25–31, 2026",
      periodStart: "2026-05-25",
      periodEnd: "2026-05-31",
      generatedAt: "2026-06-01T13:00:00.000Z",
      summary:
        "Bookings landed at $36k for the week on the Globex EdgeRack R1 expansion. Pipeline stayed healthy with the Umbrella clinical-laptop and Globex display-wall deals advancing.",
      highlights: [
        "Globex closed the 4× EdgeRack R1 expansion ($36k).",
        "Umbrella 50× Pro 16 rollout moved to Negotiation at 75%.",
        "Maya Chen led the team on weekly bookings.",
      ],
      metrics: {
        bookings: 36000,
        weightedForecast: 168700,
        winRate: 1,
        dealsWon: 1,
        dealsOpen: 6,
        byStage: [
          { stage: "Lead", count: 2, value: 69000 },
          { stage: "Qualified", count: 2, value: 102000 },
          { stage: "Proposal", count: 1, value: 88000 },
          { stage: "Negotiation", count: 1, value: 130000 },
          { stage: "Closed Won", count: 1, value: 36000 },
          { stage: "Closed Lost", count: 0, value: 0 },
        ],
        byCategory: [
          { category: "Laptop", value: 171000 },
          { category: "Workstation", value: 6000 },
          { category: "Server", value: 78000 },
          { category: "Display", value: 20000 },
          { category: "Accessory", value: 9000 },
        ],
        leaderboard: [
          {
            salespersonId: "s2",
            name: "Maya Chen",
            bookings: 36000,
            attainment: 0.1125,
          },
          {
            salespersonId: "s1",
            name: "Nathan Brooks",
            bookings: 0,
            attainment: 0,
          },
          {
            salespersonId: "s3",
            name: "Diego Alvarez",
            bookings: 0,
            attainment: 0,
          },
        ],
      },
    },
  ];

  return {
    accounts,
    contacts,
    deals,
    activities,
    products,
    salespeople,
    reports,
  };
}
