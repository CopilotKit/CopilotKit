/**
 * Bellwether's seeded scenario — the state every demo starts from.
 *
 * Dates are stored as RELATIVE OFFSETS and materialized against `now` in
 * `store.materialize()`. A committed absolute timestamp would make the exception
 * queue read "placed 400 days ago" to anyone running the demo a year from now,
 * and beat 3c's whole pitch is "the ten OLDEST orders still stuck".
 *
 * Two things in here are load-bearing for the beats rather than decoration:
 *
 *  - **Two products sit below their category margin floor already** (Harbor
 *    Parka, Lark Runner). Beat 1's ladder needs something to flag on first
 *    render, and beat 4's recalled preference ("below floor first") needs
 *    something to actually reorder.
 *  - **Two pending promotions are below floor AFTER their discount** (Cedar
 *    Hoodie, Slate Chelsea Boot), plus one that is comfortably above it (Terra
 *    Mug Set). Beat 6 is taught on Cedar and replayed unaided on Slate — the
 *    case demonstrated on stage is resolved by the demonstration, so a second
 *    gated case is the only way to prove it learned. Terra exists so the gate
 *    cannot be mistaken for "approval always fails".
 */

import type { Category, MarginFloor, Operator } from "./types";

// A tiny alias so the seed's literal unions stay readable below.
type SeedCategory = Category;

/**
 * Category margin policy. `floor` is what the BELOW_MARGIN_FLOOR gate enforces;
 * `target` is the plan. Accessories carries the highest floor because it is the
 * range's margin engine; Home the lowest because it trades on basket size.
 */
export const SEED_FLOORS: readonly MarginFloor[] = [
  { category: "Outerwear", floor: 0.42, target: 0.52 },
  { category: "Knitwear", floor: 0.45, target: 0.56 },
  { category: "Footwear", floor: 0.4, target: 0.5 },
  { category: "Accessories", floor: 0.55, target: 0.64 },
  { category: "Home", floor: 0.38, target: 0.5 },
];

export interface SeedProduct {
  id: string;
  sku: string;
  name: string;
  category: SeedCategory;
  listPrice: number;
  unitCost: number;
  inventory: number;
  trailing30Units: number;
  status: "live" | "backorder" | "discontinued";
  vendor: string;
}

export const SEED_PRODUCTS: readonly SeedProduct[] = [
  {
    id: "prd-cedar-hoodie",
    sku: "BW-CDR-HDY",
    name: "Cedar Hoodie",
    category: "Knitwear",
    listPrice: 128,
    unitCost: 47,
    inventory: 640,
    trailing30Units: 412,
    status: "live",
    vendor: "Kestrel Mills",
  },
  {
    id: "prd-aspen-shell",
    sku: "BW-ASP-SHL",
    name: "Aspen Shell Jacket",
    category: "Outerwear",
    listPrice: 340,
    unitCost: 168,
    inventory: 92,
    trailing30Units: 58,
    status: "live",
    vendor: "Northfield Outfitters",
  },
  {
    id: "prd-fern-cardigan",
    sku: "BW-FRN-CRD",
    name: "Fern Cardigan",
    category: "Knitwear",
    listPrice: 168,
    unitCost: 71,
    inventory: 210,
    trailing30Units: 96,
    status: "live",
    vendor: "Kestrel Mills",
  },
  {
    // BELOW FLOOR at list: 41.4% against a 42% Outerwear floor. Landed cost
    // moved after the range was priced, which is exactly how this happens in a
    // real buying office.
    id: "prd-harbor-parka",
    sku: "BW-HBR-PRK",
    name: "Harbor Parka",
    category: "Outerwear",
    listPrice: 420,
    unitCost: 246,
    inventory: 34,
    trailing30Units: 21,
    status: "live",
    vendor: "Northfield Outfitters",
  },
  {
    // BELOW FLOOR at list: 39.3% against a 40% Footwear floor.
    id: "prd-lark-runner",
    sku: "BW-LRK-RNR",
    name: "Lark Runner",
    category: "Footwear",
    listPrice: 145,
    unitCost: 88,
    inventory: 480,
    trailing30Units: 388,
    status: "live",
    vendor: "Vela Footworks",
  },
  {
    id: "prd-slate-boot",
    sku: "BW-SLT-CHB",
    name: "Slate Chelsea Boot",
    category: "Footwear",
    listPrice: 240,
    unitCost: 132,
    inventory: 118,
    trailing30Units: 44,
    status: "live",
    vendor: "Vela Footworks",
  },
  {
    id: "prd-flax-throw",
    sku: "BW-FLX-THR",
    name: "Flax Linen Throw",
    category: "Home",
    listPrice: 96,
    unitCost: 55,
    inventory: 300,
    trailing30Units: 132,
    status: "live",
    vendor: "Halden Home",
  },
  {
    id: "prd-terra-mug",
    sku: "BW-TRA-MUG",
    name: "Terra Mug Set",
    category: "Home",
    listPrice: 48,
    unitCost: 21,
    inventory: 900,
    trailing30Units: 512,
    status: "live",
    vendor: "Halden Home",
  },
  {
    id: "prd-willow-tote",
    sku: "BW-WLW-TOT",
    name: "Willow Tote",
    category: "Accessories",
    listPrice: 180,
    unitCost: 66,
    inventory: 260,
    trailing30Units: 174,
    status: "live",
    vendor: "Ardent Leather",
  },
  {
    id: "prd-brass-belt",
    sku: "BW-BRS-BLT",
    name: "Brass Buckle Belt",
    category: "Accessories",
    listPrice: 88,
    unitCost: 36,
    inventory: 150,
    trailing30Units: 63,
    status: "live",
    vendor: "Ardent Leather",
  },
  {
    id: "prd-moss-scarf",
    sku: "BW-MSS-SCF",
    name: "Moss Merino Scarf",
    category: "Accessories",
    listPrice: 76,
    unitCost: 33,
    inventory: 420,
    trailing30Units: 201,
    status: "live",
    vendor: "Kestrel Mills",
  },
  {
    id: "prd-pine-flannel",
    sku: "BW-PNE-FLN",
    name: "Pine Flannel",
    category: "Knitwear",
    listPrice: 112,
    unitCost: 58,
    inventory: 380,
    trailing30Units: 155,
    status: "live",
    vendor: "Kestrel Mills",
  },
  {
    id: "prd-ember-candle",
    sku: "BW-EMB-CND",
    name: "Ember Candle",
    category: "Home",
    listPrice: 42,
    unitCost: 19,
    inventory: 1100,
    trailing30Units: 640,
    status: "live",
    vendor: "Halden Home",
  },
  {
    id: "prd-onyx-duffel",
    sku: "BW-ONX-DFL",
    name: "Onyx Duffel",
    category: "Accessories",
    listPrice: 260,
    unitCost: 104,
    inventory: 46,
    trailing30Units: 29,
    status: "backorder",
    vendor: "Ardent Leather",
  },
];

export interface SeedOrder {
  id: string;
  number: string;
  customerName: string;
  customerEmail: string;
  channel: "web" | "retail" | "wholesale" | "marketplace";
  destination: string;
  placedDaysAgo: number;
  status: "open" | "on-hold" | "fulfilled" | "cancelled";
  exception:
    | "none"
    | "fraud-review"
    | "address-invalid"
    | "oversell"
    | "carrier-delay"
    | "payment-declined";
  lines: { productId: string; quantity: number; unitPrice: number }[];
  total: number;
}

/**
 * The order book. Ages are spread from today back to five weeks so beat 3c's
 * "ten oldest still on an exception" is a genuinely different list from "the ten
 * most recent" — a filter that changes nothing is not a demonstration.
 *
 * Order 4471 is beat 5's trigger: a fraud-review exception on a high-value
 * first-time order, which is the shape the seeded procedure is written for.
 *
 * ── TWO COUNTS HERE ARE LOAD-BEARING FOR BEAT 3c ────────────────────────────
 *
 * 1. **FIFTEEN orders carry an exception, thirteen of them still `open`.** The
 *    beat sets a `top=10` lever, and a limit that truncates nothing is a lever
 *    that LOOKS like it worked while doing nothing — the queue renders as though
 *    it were filtered and the audience is asked to take the maneuver on faith.
 *    Both lever shapes the agent can reach for must exceed ten: the sanctioned
 *    `exception=any` with `status=all` (15 rows), and the `status=open` variant a
 *    user can still ask for by name (13 rows). `store.test.ts` pins both.
 *
 * 2. **Every exception order added for that count is NEWER than 4471's three
 *    days**, which keeps 4471 inside the ten oldest. Truncation is an exclusion
 *    just like a status filter: if 4471 fell past rank 10 it would drop out of
 *    the view beat 3c built, taking beat 5's hold pill and forced-🚨 note with
 *    it — the exact failure the status-filter guidance in `agent.ts` and
 *    `showOrderQueue` exists to prevent. So the six rows the limit cuts are the
 *    freshest arrivals, which is also how an exception desk really reads: the
 *    old ones are the escalations, the new ones are today's noise. They cluster
 *    on purpose — a carrier hub disruption and a run of gateway declines — so
 *    six same-week exceptions read as two incidents rather than as filler.
 *
 * Sub-day offsets on that cluster are deliberate: they keep every `placedAt`
 * distinct, so "oldest first" is a total order rather than a tie the sort has to
 * break arbitrarily on stage.
 *
 * ── ORDER NUMBERS ARE MONOTONIC WITH PLACEMENT TIME ─────────────────────────
 *
 * Older order ⇒ strictly lower number, because order numbers are issued
 * sequentially in every real commerce system. This is not cosmetic: beat 3c
 * puts the queue on screen sorted OLDEST FIRST, so a reversed sequence makes
 * the number column count DOWN in front of the room, and an audience reading
 * the screen concludes the data is fake before it concludes anything about the
 * agent. `store.test.ts` pins the invariant rather than the values, so the
 * numbers below can be re-spaced freely as long as the ordering holds.
 *
 * 4471 is the one number that is pinned by identity — tests, `suggestions.ts`
 * and the demo script all name it — so it stays put and everything else is
 * numbered around it: the thirteen orders older than its three days take
 * numbers below 4471, the eight newer arrivals take numbers above.
 */
export const SEED_ORDERS: readonly SeedOrder[] = [
  {
    id: "ord-4471",
    number: "4471",
    customerName: "Dorian Vale",
    customerEmail: "d.vale@fastmail.example",
    channel: "web",
    destination: "Miami, FL",
    placedDaysAgo: 3,
    status: "open",
    exception: "fraud-review",
    lines: [
      { productId: "prd-aspen-shell", quantity: 2, unitPrice: 340 },
      { productId: "prd-onyx-duffel", quantity: 2, unitPrice: 260 },
    ],
    total: 1200,
  },
  {
    id: "ord-4409",
    number: "4409",
    customerName: "Ines Aranda",
    customerEmail: "ines.aranda@example.com",
    channel: "web",
    destination: "Portland, OR",
    placedDaysAgo: 34,
    status: "open",
    exception: "oversell",
    lines: [{ productId: "prd-onyx-duffel", quantity: 1, unitPrice: 260 }],
    total: 260,
  },
  {
    id: "ord-4419",
    number: "4419",
    customerName: "Sam Oduya",
    customerEmail: "s.oduya@example.com",
    channel: "marketplace",
    destination: "Chicago, IL",
    placedDaysAgo: 29,
    status: "open",
    exception: "address-invalid",
    lines: [{ productId: "prd-cedar-hoodie", quantity: 3, unitPrice: 128 }],
    total: 384,
  },
  {
    id: "ord-4423",
    number: "4423",
    customerName: "Priya Raghavan",
    customerEmail: "praghavan@example.com",
    channel: "web",
    destination: "Austin, TX",
    placedDaysAgo: 27,
    status: "on-hold",
    exception: "payment-declined",
    lines: [{ productId: "prd-harbor-parka", quantity: 1, unitPrice: 420 }],
    total: 420,
  },
  {
    id: "ord-4429",
    number: "4429",
    customerName: "Marguerite Bell",
    customerEmail: "m.bell@example.com",
    channel: "web",
    destination: "Boston, MA",
    placedDaysAgo: 24,
    status: "fulfilled",
    exception: "none",
    lines: [{ productId: "prd-aspen-shell", quantity: 1, unitPrice: 340 }],
    total: 340,
  },
  {
    id: "ord-4433",
    number: "4433",
    customerName: "Tobias Renner",
    customerEmail: "t.renner@example.com",
    channel: "wholesale",
    destination: "Denver, CO",
    placedDaysAgo: 22,
    status: "open",
    exception: "carrier-delay",
    lines: [{ productId: "prd-pine-flannel", quantity: 24, unitPrice: 95 }],
    total: 2280,
  },
  {
    id: "ord-4439",
    number: "4439",
    customerName: "Hana Kobayashi",
    customerEmail: "h.kobayashi@example.com",
    channel: "web",
    destination: "Seattle, WA",
    placedDaysAgo: 19,
    status: "open",
    exception: "oversell",
    lines: [{ productId: "prd-onyx-duffel", quantity: 2, unitPrice: 260 }],
    total: 520,
  },
  {
    id: "ord-4443",
    number: "4443",
    customerName: "Elias Nkemdirim",
    customerEmail: "e.nkem@example.com",
    channel: "retail",
    destination: "Brooklyn, NY",
    placedDaysAgo: 17,
    status: "fulfilled",
    exception: "none",
    lines: [
      { productId: "prd-terra-mug", quantity: 2, unitPrice: 48 },
      { productId: "prd-ember-candle", quantity: 3, unitPrice: 42 },
    ],
    total: 222,
  },
  {
    id: "ord-4447",
    number: "4447",
    customerName: "Nadia Sorenson",
    customerEmail: "n.sorenson@example.com",
    channel: "web",
    destination: "Madison, WI",
    placedDaysAgo: 15,
    status: "open",
    exception: "address-invalid",
    lines: [{ productId: "prd-willow-tote", quantity: 1, unitPrice: 180 }],
    total: 180,
  },
  {
    id: "ord-4453",
    number: "4453",
    customerName: "Owen Brightwell",
    customerEmail: "o.brightwell@example.com",
    channel: "web",
    destination: "Santa Fe, NM",
    placedDaysAgo: 12,
    status: "on-hold",
    exception: "fraud-review",
    lines: [{ productId: "prd-slate-boot", quantity: 3, unitPrice: 240 }],
    total: 720,
  },
  {
    id: "ord-4457",
    number: "4457",
    customerName: "Camille Fournier",
    customerEmail: "c.fournier@example.com",
    channel: "marketplace",
    destination: "Montréal, QC",
    placedDaysAgo: 10,
    status: "fulfilled",
    exception: "none",
    lines: [{ productId: "prd-moss-scarf", quantity: 4, unitPrice: 76 }],
    total: 304,
  },
  {
    id: "ord-4461",
    number: "4461",
    customerName: "Jonah Mbeki",
    customerEmail: "j.mbeki@example.com",
    channel: "web",
    destination: "Atlanta, GA",
    placedDaysAgo: 8,
    status: "open",
    exception: "carrier-delay",
    lines: [{ productId: "prd-lark-runner", quantity: 2, unitPrice: 145 }],
    total: 290,
  },
  {
    id: "ord-4465",
    number: "4465",
    customerName: "Roos van Dijk",
    customerEmail: "r.vandijk@example.com",
    channel: "web",
    destination: "Amsterdam, NL",
    placedDaysAgo: 6,
    status: "fulfilled",
    exception: "none",
    lines: [{ productId: "prd-flax-throw", quantity: 2, unitPrice: 96 }],
    total: 192,
  },
  {
    id: "ord-4469",
    number: "4469",
    customerName: "Aiko Tanaka",
    customerEmail: "a.tanaka@example.com",
    channel: "retail",
    destination: "San Jose, CA",
    placedDaysAgo: 4,
    status: "open",
    exception: "none",
    lines: [{ productId: "prd-fern-cardigan", quantity: 1, unitPrice: 168 }],
    total: 168,
  },
  // ── The carrier hub disruption (two orders, same lane) ────────────────────
  {
    id: "ord-4473",
    number: "4473",
    customerName: "Marisol Ferrer",
    customerEmail: "m.ferrer@example.com",
    channel: "web",
    destination: "Sacramento, CA",
    placedDaysAgo: 2.7,
    status: "open",
    exception: "carrier-delay",
    lines: [
      { productId: "prd-pine-flannel", quantity: 1, unitPrice: 112 },
      { productId: "prd-moss-scarf", quantity: 1, unitPrice: 76 },
    ],
    total: 188,
  },
  // ── The gateway decline run (two orders, same BIN range) ──────────────────
  {
    id: "ord-4476",
    number: "4476",
    customerName: "Emeka Diallo",
    customerEmail: "e.diallo@example.com",
    channel: "marketplace",
    destination: "Philadelphia, PA",
    placedDaysAgo: 2.2,
    status: "open",
    exception: "payment-declined",
    lines: [{ productId: "prd-aspen-shell", quantity: 1, unitPrice: 340 }],
    total: 340,
  },
  {
    id: "ord-4477",
    number: "4477",
    customerName: "Beatrix Lund",
    customerEmail: "b.lund@example.com",
    channel: "web",
    destination: "Oslo, NO",
    placedDaysAgo: 2,
    status: "open",
    exception: "none",
    lines: [{ productId: "prd-brass-belt", quantity: 2, unitPrice: 88 }],
    total: 176,
  },
  {
    id: "ord-4478",
    number: "4478",
    customerName: "Sylvie Marchand",
    customerEmail: "s.marchand@example.com",
    channel: "web",
    destination: "Ottawa, ON",
    placedDaysAgo: 1.9,
    status: "open",
    exception: "address-invalid",
    lines: [
      { productId: "prd-willow-tote", quantity: 1, unitPrice: 180 },
      { productId: "prd-brass-belt", quantity: 1, unitPrice: 88 },
    ],
    total: 268,
  },
  {
    id: "ord-4481",
    number: "4481",
    customerName: "Ravi Anand",
    customerEmail: "r.anand@example.com",
    channel: "web",
    destination: "Raleigh, NC",
    placedDaysAgo: 1.4,
    status: "open",
    exception: "payment-declined",
    lines: [{ productId: "prd-slate-boot", quantity: 1, unitPrice: 240 }],
    total: 240,
  },
  {
    id: "ord-4483",
    number: "4483",
    customerName: "Gil Okafor",
    customerEmail: "g.okafor@example.com",
    channel: "web",
    destination: "Houston, TX",
    placedDaysAgo: 1,
    status: "open",
    exception: "none",
    lines: [{ productId: "prd-cedar-hoodie", quantity: 1, unitPrice: 128 }],
    total: 128,
  },
  {
    // Wholesale trades below list, exactly as 4433's flannel does.
    id: "ord-4485",
    number: "4485",
    customerName: "Greta Halvorsen",
    customerEmail: "g.halvorsen@example.com",
    channel: "wholesale",
    destination: "Milwaukee, WI",
    placedDaysAgo: 0.6,
    status: "open",
    exception: "carrier-delay",
    lines: [{ productId: "prd-flax-throw", quantity: 18, unitPrice: 78 }],
    total: 1404,
  },
  {
    // Oversold the Onyx Duffel, which is the one SKU seeded on backorder — the
    // same shortfall 4409 and 4439 are waiting on.
    id: "ord-4487",
    number: "4487",
    customerName: "Tomas Leal",
    customerEmail: "t.leal@example.com",
    channel: "retail",
    destination: "Phoenix, AZ",
    placedDaysAgo: 0.3,
    status: "open",
    exception: "oversell",
    lines: [{ productId: "prd-onyx-duffel", quantity: 1, unitPrice: 260 }],
    total: 260,
  },
];

export interface SeedReturn {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  productId: string;
  reason:
    | "sizing"
    | "damaged"
    | "not-as-described"
    | "changed-mind"
    | "late-delivery";
  detail: string;
  requestedDaysAgo: number;
  status: "requested" | "approved" | "refunded" | "declined";
  itemValue: number;
  refundAmount: number | null;
}

/**
 * The returns desk. `ret-2210` is beat 3a's case: already approved by a human,
 * waiting only on the goodwill figure the merchant types into the chat card.
 *
 * `itemValue` MUST be a whole number of units at the price the referenced order
 * line actually charged, and no more units than that line carried — and any
 * count the `detail` prose states must be either that unit count or the line's
 * quantity. The assistant quotes the prose verbatim while its arithmetic comes
 * from the fields, so a third quantity makes it contradict its own record on
 * screen. `store.test.ts` pins the invariant over every return.
 */
export const SEED_RETURNS: readonly SeedReturn[] = [
  {
    id: "ret-2210",
    orderId: "ord-4429",
    orderNumber: "4429",
    customerName: "Marguerite Bell",
    productId: "prd-aspen-shell",
    reason: "sizing",
    detail:
      "Ordered a medium, needs a large. Happy to keep it if we can make the price work.",
    requestedDaysAgo: 5,
    status: "approved",
    itemValue: 340,
    refundAmount: null,
  },
  {
    id: "ret-2207",
    orderId: "ord-4443",
    orderNumber: "4443",
    customerName: "Elias Nkemdirim",
    productId: "prd-terra-mug",
    reason: "damaged",
    detail: "Two mugs arrived chipped; photos attached to the ticket.",
    requestedDaysAgo: 9,
    status: "refunded",
    itemValue: 96,
    refundAmount: 96,
  },
  {
    id: "ret-2204",
    orderId: "ord-4457",
    orderNumber: "4457",
    customerName: "Camille Fournier",
    productId: "prd-moss-scarf",
    reason: "changed-mind",
    // Order 4457 carries FOUR scarves and `itemValue` pays for two of them, so
    // the prose says four and two. It used to say "Bought three, keeping one",
    // which made three different quantities out of one return — and the
    // assistant quotes this line verbatim while its arithmetic comes from the
    // fields, so it contradicted itself on screen mid-refund.
    detail: "Bought four as gifts, keeping two — the other two go back unworn.",
    requestedDaysAgo: 6,
    status: "requested",
    itemValue: 152,
    refundAmount: null,
  },
  {
    id: "ret-2201",
    orderId: "ord-4465",
    orderNumber: "4465",
    customerName: "Roos van Dijk",
    productId: "prd-flax-throw",
    reason: "not-as-described",
    detail: "Colour reads much greyer than the product photography.",
    requestedDaysAgo: 3,
    status: "requested",
    itemValue: 96,
    refundAmount: null,
  },
  {
    id: "ret-2198",
    orderId: "ord-4461",
    orderNumber: "4461",
    customerName: "Jonah Mbeki",
    productId: "prd-lark-runner",
    reason: "late-delivery",
    detail: "Arrived after the event they were bought for.",
    requestedDaysAgo: 1,
    status: "requested",
    itemValue: 290,
    refundAmount: null,
  },
];

export interface SeedPromotion {
  id: string;
  name: string;
  productId: string;
  discountPercent: number;
  startsInDays: number;
  endsInDays: number;
  submittedBy: string;
  submittedDaysAgo: number;
  status: "pending" | "approved" | "declined";
}

/**
 * BEAT 6's material. Two pending markdowns break the floor and one does not:
 *
 *  - `promo-cedar` — 40% off a 63% SKU lands at 38.8% against a 45% Knitwear
 *    floor. This is the one taught on stage.
 *  - `promo-slate` — 35% off a 45% SKU lands at 15.4% against a 40% Footwear
 *    floor. This is the unaided replay, and it must be a DIFFERENT product from
 *    the one demonstrated, because the demonstration resolves its own case.
 *  - `promo-terra` — 20% off a 56% SKU lands at 45.3% against a 38% Home floor,
 *    so it approves in one call with no waiver at all.
 */
export const SEED_PROMOTIONS: readonly SeedPromotion[] = [
  {
    id: "promo-fern",
    name: "Fern Cardigan preview event",
    productId: "prd-fern-cardigan",
    discountPercent: 15,
    startsInDays: -21,
    endsInDays: -7,
    submittedBy: "Theo Vance",
    submittedDaysAgo: 24,
    status: "approved",
  },
  {
    id: "promo-terra",
    name: "Terra Mug gifting push",
    productId: "prd-terra-mug",
    discountPercent: 20,
    startsInDays: 4,
    endsInDays: 25,
    submittedBy: "Theo Vance",
    submittedDaysAgo: 2,
    status: "pending",
  },
  {
    id: "promo-cedar",
    name: "Cedar Hoodie autumn markdown",
    productId: "prd-cedar-hoodie",
    discountPercent: 40,
    startsInDays: 6,
    endsInDays: 27,
    submittedBy: "Theo Vance",
    submittedDaysAgo: 3,
    status: "pending",
  },
  {
    id: "promo-slate",
    name: "Slate Boot end-of-season",
    productId: "prd-slate-boot",
    discountPercent: 35,
    startsInDays: 9,
    endsInDays: 37,
    submittedBy: "Theo Vance",
    submittedDaysAgo: 5,
    status: "pending",
  },
];

export interface SeedPlan {
  id: string;
  vendor: string;
  season: string;
  summary: string;
  highlights: string[];
  lines: { sku: string; name: string; landedCost: number; units: number }[];
  schedule: { week: string; item: string }[];
  filedDaysAgo: number;
  filedBy: string;
}

/**
 * One historical restock plan, so the Catalog page's Plans panel is never empty
 * before the demo files its first one. An empty panel reads as a broken feature
 * rather than as a fresh account.
 */
export const SEED_PLANS: readonly SeedPlan[] = [
  {
    id: "pln-spring-kestrel",
    vendor: "Kestrel Mills",
    season: "Spring basics",
    summary:
      "Carry-over knit basics at the negotiated spring cost, held flat against last season to protect the Knitwear floor.",
    highlights: [
      "Cedar Hoodie cost held at $47 for the full run",
      "Six-week lead time confirmed in writing",
      "Moss Scarf moved to the same shipment to save freight",
    ],
    lines: [
      {
        sku: "BW-CDR-HDY",
        name: "Cedar Hoodie",
        landedCost: 47,
        units: 1200,
      },
      {
        sku: "BW-MSS-SCF",
        name: "Moss Merino Scarf",
        landedCost: 33,
        units: 800,
      },
    ],
    schedule: [
      { week: "Week 1", item: "PO issued and deposit released" },
      { week: "Week 4", item: "Pre-production samples approved" },
      { week: "Week 6", item: "Bulk ships from mill" },
    ],
    filedDaysAgo: 46,
    filedBy: "Nadia Okonjo",
  },
];

/**
 * Two operators, and the difference between them is the point: Nadia is the
 * seeded persona the demo runs as, so Bellwether already knows how she reads a
 * margin review. Theo has taught it nothing.
 */
export const SEED_OPERATORS: readonly Operator[] = [
  {
    id: "op-nadia",
    name: "Nadia Okonjo",
    role: "merch-lead",
    team: "Merchandising",
  },
  {
    id: "op-theo",
    name: "Theo Vance",
    role: "ops-manager",
    team: "Fulfillment",
  },
];

export const DEFAULT_OPERATOR_ID = "op-nadia";
