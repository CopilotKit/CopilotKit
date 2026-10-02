/**
 * Month-end card close: the corporate-card transactions still waiting for a
 * receipt, and each cardholder's receipts inbox. Client-safe (the Reconcile
 * board renders all of it); which receipt belongs to which charge is NOT here,
 * it lives server-side in `recon-truth.ts`.
 *
 * The matches are easy for a person looking at the receipts and hard from the
 * API alone: card-network descriptors ("SQ *BLUEBOTTLE") that do not read like
 * the merchant's name, a tip written on the slip that the printed total
 * leaves out, a hotel billed in euros, one airline charge covered by two
 * receipts, an Amazon order whose total repeats an older order, and posting
 * dates a day or two after the purchase.
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

export interface CardTransaction {
  id: string;
  cardId: string;
  postedAt: string; // YYYY-MM-DD, the card network's posting date
  descriptor: string; // as the card network shows it
  amount: number; // USD, what the card was charged
  mcc: string;
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
];

export const TRANSACTIONS: CardTransaction[] = [
  // Priya Raman, Visa 4417: six unmatched.
  {
    id: "txn_4417_0908",
    cardId: "card_4417",
    postedAt: "2026-09-08",
    descriptor: "SQ *BLUEBOTTLE COFFEE SF",
    amount: 11.25,
    mcc: "5814",
  },
  {
    id: "txn_4417_0912",
    cardId: "card_4417",
    postedAt: "2026-09-12",
    descriptor: "TST* NOPA RESTAURANT",
    amount: 148.8,
    mcc: "5812",
  },
  {
    id: "txn_4417_0915",
    cardId: "card_4417",
    postedAt: "2026-09-15",
    descriptor: "AMZN MKTP US*2K4LM81Q2",
    amount: 89.97,
    mcc: "5942",
  },
  {
    id: "txn_4417_0918",
    cardId: "card_4417",
    postedAt: "2026-09-18",
    descriptor: "HOTEL LE MARAIS PARIS FR",
    amount: 412.4,
    mcc: "7011",
  },
  {
    id: "txn_4417_0922",
    cardId: "card_4417",
    postedAt: "2026-09-22",
    descriptor: "UNITED 0162345678901",
    amount: 686.2,
    mcc: "3000",
  },
  {
    id: "txn_4417_0925",
    cardId: "card_4417",
    postedAt: "2026-09-25",
    descriptor: "PAYPAL *WEWORK 4029357733",
    amount: 45,
    mcc: "6513",
  },
  // Marcus Lee, Visa 8820: five unmatched (the learned skill's second card).
  {
    id: "txn_8820_0904",
    cardId: "card_8820",
    postedAt: "2026-09-04",
    descriptor: "SQ *SIGHTGLASS COFFEE",
    amount: 8.75,
    mcc: "5814",
  },
  {
    id: "txn_8820_0910",
    cardId: "card_8820",
    postedAt: "2026-09-10",
    descriptor: "TST* ZUNI CAFE SAN FRAN",
    amount: 96,
    mcc: "5812",
  },
  {
    id: "txn_8820_0916",
    cardId: "card_8820",
    postedAt: "2026-09-16",
    descriptor: "AMZN MKTP US*7Q1PZ09T3",
    amount: 54.98,
    mcc: "5942",
  },
  {
    id: "txn_8820_0921",
    cardId: "card_8820",
    postedAt: "2026-09-21",
    descriptor: "IBERIA 0752394871022",
    amount: 318.6,
    mcc: "3075",
  },
  {
    id: "txn_8820_0927",
    cardId: "card_8820",
    postedAt: "2026-09-27",
    descriptor: "WWW COSTCO COM 800-955-2292",
    amount: 230.45,
    mcc: "5300",
  },
];

const PRIYA = "VISA •• 4417";
const MARCUS = "VISA •• 8820";

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
];

/** Days between two ISO dates (b - a). */
export function dayGap(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
