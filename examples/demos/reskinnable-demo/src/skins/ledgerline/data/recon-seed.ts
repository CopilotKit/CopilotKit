/**
 * Month-end card close: each cardholder's September charges, their receipts
 * inbox, and the exceptions a person still has to clear. Client-safe (the Card
 * close board renders all of it); which receipt settles which charge is NOT
 * here, it lives server-side in `recon-store.ts`.
 *
 * Receipts match themselves, the way modern spend platforms do it: a tip
 * written on the slip, a hotel billed in euros and one airline charge covered
 * by two receipts all auto-match. What is left are the four exceptions every
 * month-end close still puts in front of a person, each its own workflow in
 * the product:
 *
 * - SPLIT: a team offsite charge allocated across the departments that came.
 * - RECLASS: a software charge auto-coded to the wrong GL account, in a period
 *   that is soft-locked for coding edits.
 * - PERSONAL: a personal charge the cardholder flagged, repaid by payroll.
 * - MISSING RECEIPT: a ride with no receipt, cleared by the cardholder's
 *   missing-receipt affidavit.
 */

export type ReceiptCurrency = "USD" | "EUR";

export interface CardAccount {
  id: string;
  holder: string;
  employeeId: string;
  last4: string;
  network: "Visa";
  period: string; // YYYY-MM
  periodLabel: string; // "September"
}

export interface Department {
  id: string;
  name: string;
}

export interface GlAccount {
  code: string;
  name: string;
}

export const DEPARTMENTS: Department[] = [
  { id: "dept_eng", name: "Engineering" },
  { id: "dept_design", name: "Design" },
  { id: "dept_product", name: "Product" },
  { id: "dept_sales", name: "Sales" },
  { id: "dept_cs", name: "Customer Success" },
  { id: "dept_marketing", name: "Marketing" },
  { id: "dept_finance", name: "Finance" },
];

export const GL_ACCOUNTS: GlAccount[] = [
  { code: "6100", name: "Meals & entertainment" },
  { code: "6200", name: "Travel" },
  { code: "6250", name: "Lodging" },
  { code: "6300", name: "Rideshare & parking" },
  { code: "6420", name: "Software subscriptions" },
  { code: "6500", name: "Office supplies" },
  { code: "6610", name: "Events & offsites" },
  { code: "6700", name: "Coworking" },
];

export const glName = (code: string) =>
  GL_ACCOUNTS.find((a) => a.code === code)?.name ?? code;
export const deptName = (id: string) =>
  DEPARTMENTS.find((d) => d.id === id)?.name ?? id;

/** An event a charge paid for, as the product knows it (the Events calendar). */
export interface CompanyEvent {
  id: string;
  name: string;
  date: string;
  location: string;
  attendees: { departmentId: string; count: number }[];
}

export const EVENTS: CompanyEvent[] = [
  {
    id: "evt_prod_offsite_0919",
    name: "Product offsite",
    date: "2026-09-19",
    location: "Terrain, Mill Valley",
    attendees: [
      { departmentId: "dept_eng", count: 6 },
      { departmentId: "dept_design", count: 3 },
      { departmentId: "dept_product", count: 3 },
    ],
  },
  {
    id: "evt_sales_kickoff_0918",
    name: "Q4 sales kickoff lunch",
    date: "2026-09-18",
    location: "Market St office",
    attendees: [
      { departmentId: "dept_sales", count: 7 },
      { departmentId: "dept_cs", count: 4 },
    ],
  },
  {
    id: "evt_brand_summit_0917",
    name: "Brand summit lunch",
    date: "2026-09-17",
    location: "Oakland studio",
    attendees: [
      { departmentId: "dept_design", count: 5 },
      { departmentId: "dept_marketing", count: 6 },
    ],
  },
];

/** The split a person gets from "Split by attendees": headcount share, to the cent. */
export function attendeeSplit(
  amount: number,
  event: CompanyEvent,
): { departmentId: string; amount: number }[] {
  const total = event.attendees.reduce((n, a) => n + a.count, 0);
  const cents = Math.round(amount * 100);
  let left = cents;
  return event.attendees.map((a, i) => {
    const share =
      i === event.attendees.length - 1
        ? left
        : Math.round((cents * a.count) / total);
    left -= share;
    return { departmentId: a.departmentId, amount: share / 100 };
  });
}

/** What still needs a person on a charge. Receipt charges have none. */
export type ChargeException =
  | { kind: "split"; eventId: string }
  | { kind: "reclass"; suggestedAccount: string; why: string }
  | {
      kind: "personal";
      note: { author: string; text: string; at: string };
    }
  | { kind: "missing_receipt"; memoHint: string };

export interface CardTransaction {
  id: string;
  cardId: string;
  postedAt: string; // YYYY-MM-DD, the card network's posting date
  descriptor: string; // as the card network shows it
  amount: number; // USD, what the card was charged
  mcc: string;
  /** The GL account the charge is coded to today. */
  glAccount: string;
  exception?: ChargeException;
}

export interface ReceiptLine {
  label: string;
  amount: number;
}

export interface Receipt {
  id: string;
  cardId: string;
  merchant: string;
  /** How the receipt looks: drives the thumbnail's header. */
  kind: "cafe" | "restaurant" | "order" | "hotel" | "airline" | "workspace";
  address?: string;
  date: string; // YYYY-MM-DD, the purchase date printed on it
  time?: string;
  reference?: string; // order or folio number
  currency: ReceiptCurrency;
  lines: ReceiptLine[];
  tax?: number;
  /** The printed total. A tip written on the slip is NOT part of it. */
  total: number;
  /** A tip written by hand on the slip (restaurants, cafes). */
  handwrittenTip?: number;
  payment: string; // "VISA •• 4417"
  uploadedAt: string;
}

export const CARDS: CardAccount[] = [
  {
    id: "card_4417",
    holder: "Priya Raman",
    employeeId: "e_priya",
    last4: "4417",
    network: "Visa",
    period: "2026-09",
    periodLabel: "September",
  },
  {
    id: "card_8820",
    holder: "Marcus Lee",
    employeeId: "e_marcus",
    last4: "8820",
    network: "Visa",
    period: "2026-09",
    periodLabel: "September",
  },
  {
    id: "card_3391",
    holder: "Sofia Lindqvist",
    employeeId: "e_sofia",
    last4: "3391",
    network: "Visa",
    period: "2026-09",
    periodLabel: "September",
  },
];

export const TRANSACTIONS: CardTransaction[] = [
  // Priya Raman, Visa 4417: six receipt charges, all auto-matched.
  {
    id: "txn_4417_0908",
    cardId: "card_4417",
    postedAt: "2026-09-08",
    descriptor: "SQ *BLUEBOTTLE COFFEE SF",
    amount: 11.25,
    mcc: "5814",
    glAccount: "6100",
  },
  {
    id: "txn_4417_0912",
    cardId: "card_4417",
    postedAt: "2026-09-12",
    descriptor: "TST* NOPA RESTAURANT",
    amount: 148.8,
    mcc: "5812",
    glAccount: "6100",
  },
  {
    id: "txn_4417_0915",
    cardId: "card_4417",
    postedAt: "2026-09-15",
    descriptor: "AMZN MKTP US*2K4LM81Q2",
    amount: 89.97,
    mcc: "5942",
    glAccount: "6500",
  },
  {
    id: "txn_4417_0918",
    cardId: "card_4417",
    postedAt: "2026-09-18",
    descriptor: "HOTEL LE MARAIS PARIS FR",
    amount: 412.4,
    mcc: "7011",
    glAccount: "6250",
  },
  {
    id: "txn_4417_0922",
    cardId: "card_4417",
    postedAt: "2026-09-22",
    descriptor: "UNITED 0162345678901",
    amount: 686.2,
    mcc: "3000",
    glAccount: "6200",
  },
  {
    id: "txn_4417_0925",
    cardId: "card_4417",
    postedAt: "2026-09-25",
    descriptor: "PAYPAL *WEWORK 4029357733",
    amount: 45,
    mcc: "6513",
    glAccount: "6700",
  },
  // Priya's exceptions: what a person clears on the Card close board.
  {
    id: "txn_4417_0910",
    cardId: "card_4417",
    postedAt: "2026-09-10",
    descriptor: "FIGMA* MONTHLY 415-890-5404",
    amount: 540,
    mcc: "5734",
    glAccount: "6100",
    exception: {
      kind: "reclass",
      suggestedAccount: "6420",
      why: "Figma is design software. Its merchant category fell through to the default account.",
    },
  },
  {
    id: "txn_4417_0919",
    cardId: "card_4417",
    postedAt: "2026-09-19",
    descriptor: "TERRAIN EVENTS 0919",
    amount: 2400,
    mcc: "7399",
    glAccount: "6610",
    exception: { kind: "split", eventId: "evt_prod_offsite_0919" },
  },
  {
    id: "txn_4417_0923",
    cardId: "card_4417",
    postedAt: "2026-09-23",
    descriptor: "LYFT *RIDE TUE 5PM",
    amount: 27.15,
    mcc: "4121",
    glAccount: "6300",
    exception: {
      kind: "missing_receipt",
      memoHint:
        "Ride from the Chicago client office to O'Hare after the onsite. The Lyft receipt email never arrived.",
    },
  },
  {
    id: "txn_4417_0927",
    cardId: "card_4417",
    postedAt: "2026-09-27",
    descriptor: "UBER *EATS",
    amount: 38.4,
    mcc: "5812",
    glAccount: "6100",
    exception: {
      kind: "personal",
      note: {
        author: "Priya Raman",
        text: "Wrong card, sorry. That was my Saturday dinner, it's personal.",
        at: "2026-09-27T19:42:00",
      },
    },
  },
  // Marcus Lee, Visa 8820 (the learned skill's second card).
  {
    id: "txn_8820_0904",
    cardId: "card_8820",
    postedAt: "2026-09-04",
    descriptor: "SQ *SIGHTGLASS COFFEE",
    amount: 8.75,
    mcc: "5814",
    glAccount: "6100",
  },
  {
    id: "txn_8820_0910",
    cardId: "card_8820",
    postedAt: "2026-09-10",
    descriptor: "TST* ZUNI CAFE SAN FRAN",
    amount: 96,
    mcc: "5812",
    glAccount: "6100",
  },
  {
    id: "txn_8820_0916",
    cardId: "card_8820",
    postedAt: "2026-09-16",
    descriptor: "AMZN MKTP US*7Q1PZ09T3",
    amount: 54.98,
    mcc: "5942",
    glAccount: "6500",
  },
  {
    id: "txn_8820_0921",
    cardId: "card_8820",
    postedAt: "2026-09-21",
    descriptor: "IBERIA 0752394871022",
    amount: 318.6,
    mcc: "3075",
    glAccount: "6200",
  },
  {
    id: "txn_8820_0927",
    cardId: "card_8820",
    postedAt: "2026-09-27",
    descriptor: "WWW COSTCO COM 800-955-2292",
    amount: 230.45,
    mcc: "5300",
    glAccount: "6500",
  },
  {
    id: "txn_8820_0908",
    cardId: "card_8820",
    postedAt: "2026-09-08",
    descriptor: "NOTION LABS INC",
    amount: 96,
    mcc: "5734",
    glAccount: "6100",
    exception: {
      kind: "reclass",
      suggestedAccount: "6420",
      why: "Notion is a software subscription. Its merchant category fell through to the default account.",
    },
  },
  {
    id: "txn_8820_0918",
    cardId: "card_8820",
    postedAt: "2026-09-18",
    descriptor: "OFF THE GRID CATERING SF",
    amount: 1650,
    mcc: "5811",
    glAccount: "6610",
    exception: { kind: "split", eventId: "evt_sales_kickoff_0918" },
  },
  {
    id: "txn_8820_0924",
    cardId: "card_8820",
    postedAt: "2026-09-24",
    descriptor: "SFMTA PARKING METER",
    amount: 18,
    mcc: "7523",
    glAccount: "6300",
    exception: {
      kind: "missing_receipt",
      memoHint:
        "Meter parking on Market St for the client lunch at Zuni. Meters do not print receipts.",
    },
  },
  {
    id: "txn_8820_0926",
    cardId: "card_8820",
    postedAt: "2026-09-26",
    descriptor: "NETFLIX.COM",
    amount: 15.49,
    mcc: "4899",
    glAccount: "6420",
    exception: {
      kind: "personal",
      note: {
        author: "Marcus Lee",
        text: "My personal Netflix landed on the corporate card. Please take it back out of my pay.",
        at: "2026-09-26T08:15:00",
      },
    },
  },
  // Sofia Lindqvist, Visa 3391 (the card ChatGPT closes with the learned skill).
  {
    id: "txn_3391_0905",
    cardId: "card_3391",
    postedAt: "2026-09-05",
    descriptor: "SQ *RITUAL COFFEE ROASTERS",
    amount: 7.5,
    mcc: "5814",
    glAccount: "6100",
  },
  {
    id: "txn_3391_0911",
    cardId: "card_3391",
    postedAt: "2026-09-11",
    descriptor: "TST* FLOUR + WATER",
    amount: 132,
    mcc: "5812",
    glAccount: "6100",
  },
  {
    id: "txn_3391_0914",
    cardId: "card_3391",
    postedAt: "2026-09-14",
    descriptor: "AMZN MKTP US*3H8RT20Q1",
    amount: 64.97,
    mcc: "5942",
    glAccount: "6500",
  },
  {
    id: "txn_3391_0920",
    cardId: "card_3391",
    postedAt: "2026-09-20",
    descriptor: "TAP AIR PORTUGAL 0472318845",
    amount: 487.74,
    mcc: "3000",
    glAccount: "6200",
  },
  {
    id: "txn_3391_0925",
    cardId: "card_3391",
    postedAt: "2026-09-25",
    descriptor: "WWW.STAPLES.COM",
    amount: 106.05,
    mcc: "5943",
    glAccount: "6500",
  },
  {
    id: "txn_3391_0909",
    cardId: "card_3391",
    postedAt: "2026-09-09",
    descriptor: "CANVA* 04459-22310",
    amount: 119.99,
    mcc: "5734",
    glAccount: "6100",
    exception: {
      kind: "reclass",
      suggestedAccount: "6420",
      why: "Canva is design software. Its merchant category fell through to the default account.",
    },
  },
  {
    id: "txn_3391_0917",
    cardId: "card_3391",
    postedAt: "2026-09-17",
    descriptor: "SMOKEHOUSE CATERING OAK",
    amount: 1320,
    mcc: "5811",
    glAccount: "6610",
    exception: { kind: "split", eventId: "evt_brand_summit_0917" },
  },
  {
    id: "txn_3391_0922",
    cardId: "card_3391",
    postedAt: "2026-09-22",
    descriptor: "WAYMO *RIDE",
    amount: 31.2,
    mcc: "4121",
    glAccount: "6300",
    exception: {
      kind: "missing_receipt",
      memoHint:
        "Ride from SFO to the office after the Lisbon design conference. The receipt went to an old email address.",
    },
  },
  {
    id: "txn_3391_0928",
    cardId: "card_3391",
    postedAt: "2026-09-28",
    descriptor: "SPOTIFY USA",
    amount: 11.99,
    mcc: "5815",
    glAccount: "6420",
    exception: {
      kind: "personal",
      note: {
        author: "Sofia Lindqvist",
        text: "That's my personal Spotify, the corporate card got saved by mistake. Please take it out of my pay.",
        at: "2026-09-28T10:05:00",
      },
    },
  },
];

const PRIYA = "VISA •• 4417";
const MARCUS = "VISA •• 8820";
const SOFIA = "VISA •• 3391";

export const RECEIPTS: Receipt[] = [
  // Priya's inbox: seven that belong to her charges, two that do not.
  {
    id: "rcpt_bb_0907",
    cardId: "card_4417",
    merchant: "Blue Bottle Coffee",
    kind: "cafe",
    address: "66 Mint St, San Francisco",
    date: "2026-09-07",
    time: "8:42 AM",
    currency: "USD",
    lines: [
      { label: "New Orleans iced, 16oz", amount: 6.25 },
      { label: "Liège waffle", amount: 4.0 },
    ],
    tax: 1.0,
    total: 11.25,
    payment: PRIYA,
    uploadedAt: "2026-09-07",
  },
  {
    id: "rcpt_nopa_0912",
    cardId: "card_4417",
    merchant: "Nopa",
    kind: "restaurant",
    address: "560 Divisadero St, San Francisco",
    date: "2026-09-12",
    time: "8:16 PM",
    reference: "Check 4471 · Table 12",
    currency: "USD",
    lines: [
      { label: "Dinner for 3", amount: 112.0 },
      { label: "Sparkling water", amount: 2.0 },
    ],
    tax: 10.0,
    total: 124.0,
    handwrittenTip: 24.8,
    payment: PRIYA,
    uploadedAt: "2026-09-13",
  },
  {
    id: "rcpt_amzn_0914",
    cardId: "card_4417",
    merchant: "Amazon.com",
    kind: "order",
    date: "2026-09-14",
    reference: "Order #113-4471029-5521873",
    currency: "USD",
    lines: [
      { label: "USB-C hub, 7-in-1", amount: 39.99 },
      { label: "HDMI cable, 2-pack", amount: 14.99 },
      { label: "Laptop stand, aluminum", amount: 34.99 },
    ],
    total: 89.97,
    payment: PRIYA,
    uploadedAt: "2026-09-14",
  },
  {
    id: "rcpt_marais_0917",
    cardId: "card_4417",
    merchant: "Hôtel Le Marais",
    kind: "hotel",
    address: "12 Rue de Turenne, 75004 Paris",
    date: "2026-09-17",
    reference: "Folio 20917-0442",
    currency: "EUR",
    lines: [
      { label: "Chambre, 2 nuits", amount: 340.0 },
      { label: "Taxe de séjour", amount: 8.0 },
      { label: "Petit-déjeuner", amount: 24.0 },
    ],
    total: 372.0,
    payment: PRIYA,
    uploadedAt: "2026-09-18",
  },
  {
    id: "rcpt_ua_tkt_0920",
    cardId: "card_4417",
    merchant: "United Airlines",
    kind: "airline",
    date: "2026-09-20",
    reference: "E-ticket 0162345678901",
    currency: "USD",
    lines: [
      { label: "SFO → ORD → SFO, economy", amount: 548.6 },
      { label: "Taxes and carrier fees", amount: 49.6 },
    ],
    total: 598.2,
    payment: PRIYA,
    uploadedAt: "2026-09-20",
  },
  {
    id: "rcpt_ua_plus_0920",
    cardId: "card_4417",
    merchant: "United Airlines",
    kind: "airline",
    date: "2026-09-20",
    reference: "Economy Plus · EMD 0162345678901",
    currency: "USD",
    lines: [{ label: "Economy Plus seat, 2 segments", amount: 88.0 }],
    total: 88.0,
    payment: PRIYA,
    uploadedAt: "2026-09-21",
  },
  {
    id: "rcpt_wework_0925",
    cardId: "card_4417",
    merchant: "WeWork",
    kind: "workspace",
    address: "600 California St, San Francisco",
    date: "2026-09-25",
    reference: "Day pass · Invoice WW-88213",
    currency: "USD",
    lines: [{ label: "On Demand day pass", amount: 45.0 }],
    total: 45.0,
    payment: PRIYA,
    uploadedAt: "2026-09-25",
  },
  // Decoys: right merchant, wrong charge.
  {
    id: "rcpt_bb_0903",
    cardId: "card_4417",
    merchant: "Blue Bottle Coffee",
    kind: "cafe",
    address: "1 Ferry Building, San Francisco",
    date: "2026-09-03",
    time: "7:55 AM",
    currency: "USD",
    lines: [{ label: "Drip coffee, 12oz", amount: 4.5 }],
    tax: 0.4,
    total: 4.9,
    payment: PRIYA,
    uploadedAt: "2026-09-03",
  },
  {
    id: "rcpt_amzn_0830",
    cardId: "card_4417",
    merchant: "Amazon.com",
    kind: "order",
    date: "2026-08-30",
    reference: "Order #113-0098812-2209174",
    currency: "USD",
    lines: [
      { label: "Desk lamp, LED", amount: 49.99 },
      { label: "Monitor riser", amount: 39.98 },
    ],
    total: 89.97,
    payment: PRIYA,
    uploadedAt: "2026-08-30",
  },
  // Marcus's inbox.
  {
    id: "rcpt_sight_0903",
    cardId: "card_8820",
    merchant: "Sightglass Coffee",
    kind: "cafe",
    address: "270 7th St, San Francisco",
    date: "2026-09-03",
    time: "9:10 AM",
    currency: "USD",
    lines: [
      { label: "Cortado", amount: 5.0 },
      { label: "Morning bun", amount: 3.0 },
    ],
    tax: 0.75,
    total: 8.75,
    payment: MARCUS,
    uploadedAt: "2026-09-03",
  },
  {
    id: "rcpt_zuni_0910",
    cardId: "card_8820",
    merchant: "Zuni Café",
    kind: "restaurant",
    address: "1658 Market St, San Francisco",
    date: "2026-09-10",
    time: "1:05 PM",
    reference: "Check 2208 · Table 4",
    currency: "USD",
    lines: [{ label: "Lunch for 2", amount: 73.5 }],
    tax: 6.5,
    total: 80.0,
    handwrittenTip: 16.0,
    payment: MARCUS,
    uploadedAt: "2026-09-10",
  },
  {
    id: "rcpt_amzn_0915",
    cardId: "card_8820",
    merchant: "Amazon.com",
    kind: "order",
    date: "2026-09-15",
    reference: "Order #114-2290031-7718420",
    currency: "USD",
    lines: [
      { label: "Mechanical keyboard switches", amount: 32.99 },
      { label: "Cable organizer kit", amount: 21.99 },
    ],
    total: 54.98,
    payment: MARCUS,
    uploadedAt: "2026-09-15",
  },
  {
    id: "rcpt_iberia_0920",
    cardId: "card_8820",
    merchant: "Iberia",
    kind: "airline",
    date: "2026-09-20",
    reference: "Billete 0752394871022",
    currency: "EUR",
    lines: [
      { label: "MAD → BCN, Turista", amount: 241.0 },
      { label: "Tasas", amount: 46.0 },
    ],
    total: 287.0,
    payment: MARCUS,
    uploadedAt: "2026-09-20",
  },
  {
    id: "rcpt_costco_0926a",
    cardId: "card_8820",
    merchant: "Costco Wholesale",
    kind: "order",
    date: "2026-09-26",
    reference: "Order 1083392011 · shipment 1 of 2",
    currency: "USD",
    lines: [{ label: "Office snacks and supplies", amount: 180.47 }],
    total: 180.47,
    payment: MARCUS,
    uploadedAt: "2026-09-26",
  },
  {
    id: "rcpt_costco_0926b",
    cardId: "card_8820",
    merchant: "Costco Wholesale",
    kind: "order",
    date: "2026-09-26",
    reference: "Order 1083392011 · shipment 2 of 2",
    currency: "USD",
    lines: [{ label: "Paper goods", amount: 49.98 }],
    total: 49.98,
    payment: MARCUS,
    uploadedAt: "2026-09-27",
  },
  {
    id: "rcpt_sight_0922",
    cardId: "card_8820",
    merchant: "Sightglass Coffee",
    kind: "cafe",
    address: "3014 20th St, San Francisco",
    date: "2026-09-22",
    time: "3:40 PM",
    currency: "USD",
    lines: [{ label: "Pour over", amount: 6.0 }],
    tax: 0.53,
    total: 6.53,
    payment: MARCUS,
    uploadedAt: "2026-09-22",
  },
  // Sofia's inbox.
  {
    id: "rcpt_ritual_0904",
    cardId: "card_3391",
    merchant: "Ritual Coffee Roasters",
    kind: "cafe",
    address: "1026 Valencia St, San Francisco",
    date: "2026-09-04",
    time: "8:25 AM",
    currency: "USD",
    lines: [
      { label: "Oat latte", amount: 6.0 },
      { label: "Shortbread", amount: 0.85 },
    ],
    tax: 0.65,
    total: 7.5,
    payment: SOFIA,
    uploadedAt: "2026-09-04",
  },
  {
    id: "rcpt_flour_0911",
    cardId: "card_3391",
    merchant: "Flour + Water",
    kind: "restaurant",
    address: "2401 Harrison St, San Francisco",
    date: "2026-09-11",
    time: "7:45 PM",
    reference: "Check 4410 · Table 9",
    currency: "USD",
    lines: [{ label: "Dinner for 3", amount: 100.95 }],
    tax: 9.05,
    total: 110.0,
    handwrittenTip: 22.0,
    payment: SOFIA,
    uploadedAt: "2026-09-12",
  },
  {
    id: "rcpt_amzn_0913",
    cardId: "card_3391",
    merchant: "Amazon.com",
    kind: "order",
    date: "2026-09-13",
    reference: "Order #112-7731095-4420917",
    currency: "USD",
    lines: [
      { label: "Pantone swatch book", amount: 44.99 },
      { label: "Sketch markers, 24 pack", amount: 19.98 },
    ],
    total: 64.97,
    payment: SOFIA,
    uploadedAt: "2026-09-13",
  },
  {
    id: "rcpt_tap_0919",
    cardId: "card_3391",
    merchant: "TAP Air Portugal",
    kind: "airline",
    date: "2026-09-19",
    reference: "Bilhete 0472318845",
    currency: "EUR",
    lines: [
      { label: "LIS → SFO, Economy", amount: 386.0 },
      { label: "Taxas", amount: 54.0 },
    ],
    total: 440.0,
    payment: SOFIA,
    uploadedAt: "2026-09-19",
  },
  {
    id: "rcpt_staples_0924a",
    cardId: "card_3391",
    merchant: "Staples",
    kind: "order",
    date: "2026-09-24",
    reference: "Order 9927731 · shipment 1 of 2",
    currency: "USD",
    lines: [{ label: "Foam board and mounting tape", amount: 74.2 }],
    total: 74.2,
    payment: SOFIA,
    uploadedAt: "2026-09-24",
  },
  {
    id: "rcpt_staples_0924b",
    cardId: "card_3391",
    merchant: "Staples",
    kind: "order",
    date: "2026-09-24",
    reference: "Order 9927731 · shipment 2 of 2",
    currency: "USD",
    lines: [{ label: "Presentation easel pads", amount: 31.85 }],
    total: 31.85,
    payment: SOFIA,
    uploadedAt: "2026-09-25",
  },
];

/** Days between two ISO dates (b - a). */
export function dayGap(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
