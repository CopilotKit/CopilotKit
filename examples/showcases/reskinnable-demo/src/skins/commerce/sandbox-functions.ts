import { z } from "zod";
import type { SandboxFunction } from "@copilotkit/react-core/v2";
import { categoryParameter } from "./category-argument";
import type { CommerceStoreState } from "./data/types";
import {
  ORDER_EXCEPTION_LABEL,
  RETURN_REASON_LABEL,
  ageInDays,
  belowFloorCount,
  discountedPrice,
  formatMargin,
  isOnException,
  nullableBelowFloor,
  openReturns,
  orderUnits,
  ordersOnException,
  productFloorStatus,
  productMargin,
  promotionFloorStatus,
  promotionMargin,
  tallyFloorStatus,
  valueAtRisk,
  weeksOfCover,
} from "./data/derive";

/**
 * Functions exposed INSIDE the OGUI sandboxed iframe, so generated UI can bind
 * to Bellwether's real ledger instead of the model typing numbers into markup.
 *
 * Five things this file is careful about:
 *
 *  1. It projects onto explicit DTOs rather than passing records through. The
 *     sandbox is a different trust boundary, and a spread of the raw order
 *     object would carry customer email addresses across it for no reason. Only
 *     what a generated view could legitimately draw goes over.
 *
 *  2. It reads a module-scope snapshot rather than a hook, because these are
 *     plain functions invoked from an iframe with no React context. The snapshot
 *     is kept current by `<SandboxDataSync />`, mounted in the skin's Providers
 *     — without that component these return an empty ledger, which renders as a
 *     plausible-looking but entirely blank generated UI.
 *
 *  3. It never hand-writes a set predicate. "On exception" and "open return" are
 *     shared derivations (`isOnException` / `isOpenReturn` in `data/derive.ts`)
 *     because generated UI lands on the canvas BESIDE the app's own cards, off
 *     the same ledger. A local copy of a predicate here does not fail loudly —
 *     it puts a second, larger number next to the first one on screen. Both
 *     `exceptionsOnly` and `openReturns` below had drifted that way.
 *
 *  4. Every parameter is enumerated to its real domain AND enforced (see
 *     `define` below). A `z.string()` category is the same failure as a drifted
 *     predicate wearing different clothes: the handler filters to nothing, the
 *     generated panel renders a convincingly empty view, and the model is never
 *     told it guessed the vocabulary wrong. The category enum itself lives in
 *     `./category-argument`, shared with the chat's `showMarginLadder`, so the
 *     sandbox and the transcript advertise ONE vocabulary.
 *
 *  5. Every figure that crosses this boundary states its unit. Counts and days
 *     are named by their field (`units`, `ageDays`, `weeksOfCover`), money is
 *     declared as US dollars in the function's `description`, and every margin
 *     goes over TWICE — a `…Ratio` fraction of 1 for geometry and a `…Label`
 *     display string built by the app's own `formatMargin`. An unlabelled `0.42`
 *     is the ambiguity that matters most here: the same value renders as "0.42%"
 *     or "42%" with equal confidence, and `discountPercent: 40` sits in the same
 *     object to muddy the guess. Shipping the label removes the guess AND makes
 *     the generated panel read identically to the app card beside it, one
 *     decimal and all. Money gets a description rather than a label because the
 *     figures the app prints are whole dollars either way, and generated UI has
 *     no reason to scale them.
 *
 * A note on the returns: the model NEVER sees these DTOs before drawing against
 * them. Only `name`, `description` and the JSON-schema-ified `parameters` are
 * registered as agent context (`sandboxFunctionsDescriptors` in
 * `CopilotKitProvider`), so a `description` is the ONLY place the shape and units
 * of a result can be documented. Keep the descriptions below in step with the
 * projections.
 */

let snapshot: CommerceStoreState | null = null;

export function setSandboxSnapshot(next: CommerceStoreState) {
  snapshot = next;
}

const empty: CommerceStoreState = {
  products: [],
  floors: [],
  orders: [],
  notifications: [],
  returns: [],
  promotions: [],
  waivers: [],
  plans: [],
  operators: [],
};

const read = () => snapshot ?? empty;

/**
 * A sandbox function that ENFORCES the schema it advertises.
 *
 * The runtime does not do this for us and is not going to: the provider
 * serializes `parameters` into agent context as documentation, and the renderer
 * then hands the bare `handler` to the iframe (`api[fn.name] = fn.handler` in
 * `OpenGenerativeUIRenderer`). Nothing parses the arguments on the way in. So a
 * schema written here and not applied here is a comment — the handler receives
 * whatever the generated script passed, and `p.category === "Shoes"` matches no
 * row and returns `[]`.
 *
 * Refusing is strictly better than that empty array. A rejected promise inside
 * the generated script is visible — it hits the script's own error path instead
 * of drawing an empty table that looks like an answer — and the message names the
 * accepted values, which is the only way the model can correct itself.
 */
function define<S extends z.ZodType>(spec: {
  name: string;
  description: string;
  parameters: S;
  handler: (args: z.output<S>) => unknown;
}): SandboxFunction {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    handler: async (args: unknown) => {
      // `args ?? {}` because a no-argument call arrives as `undefined`, which a
      // `z.object({})` schema would otherwise reject.
      const parsed = spec.parameters.safeParse(args ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.join(".") || "arguments"}: ${issue.message}`,
          )
          .join("; ");
        throw new Error(
          `${spec.name} rejected its arguments (${detail}). Nothing was read, ` +
            `so do not draw an empty view — call again with a value the schema lists.`,
        );
      }
      return spec.handler(parsed.data);
    },
  };
}

/** `formatMargin`, null-safe: every margin below can legitimately be absent. */
const marginLabel = (ratio: number | null) =>
  ratio === null ? null : formatMargin(ratio);

export const sandboxFunctions: SandboxFunction[] = [
  define({
    name: "getProducts",
    description:
      "Every product in the range with its price, landed cost, gross margin, " +
      "category margin floor, inventory and weeks of cover. `listPrice` and " +
      "`unitCost` are whole US dollars. Margin arrives twice: `marginRatio` and " +
      "`floorRatio` are fractions of 1 (0.418 means 41.8%) for bar heights and " +
      "arithmetic, while `marginLabel` and `floorLabel` are the display strings " +
      "the app's own cards show — render the label, never a percent you " +
      "computed. `floorRatio`, `floorLabel` and `belowFloor` are all null when " +
      "the category has no floor on file: that SKU was NOT checked, which is " +
      "neither an all-clear nor a violation, so label it as unchecked and never " +
      "count it among the products below their floor. " +
      "`weeksOfCover` is weeks at the trailing-30 run rate, null when nothing " +
      "is selling.",
    /**
     * `.strict()` because this schema was RENAMED (`belowFloorOnly` →
     * `notClearingFloorOnly`, see below). Zod strips an unrecognized key by
     * default, so a call still carrying the old name would silently lose its
     * filter and return the WHOLE range — which a panel titled "below floor"
     * would then draw as violations. Refusing names the accepted keys; that is the
     * same trade `define` above is built on.
     */
    parameters: z
      .object({
        category: categoryParameter
          .optional()
          .describe("Restrict to one category."),
        /**
         * NOT `belowFloorOnly`, and the rename is the fix rather than a tidy-up.
         *
         * That filter tested `productFloorStatus(...) === "below"`, so a SKU whose
         * category has no floor on file was silently DROPPED: generated UI got a
         * short list with nothing saying it was short, and the model could not
         * tell a clean range from an unchecked one. Including the unmeasurable
         * rows — each already flagged `belowFloor: null` — is the honest shape,
         * because every row then describes its own verdict and the list is
         * COMPLETE for the category. The name has to describe what comes back:
         * "not clearing its floor" is true of both a violation and an unchecked
         * SKU, where "below floor" is only true of the first.
         */
        notClearingFloorOnly: z
          .boolean()
          .optional()
          .describe(
            "Only products that do not CLEAR their category floor: those " +
              "trading under it (belowFloor true) plus those whose category has " +
              "no floor on file (belowFloor null, never checked). Nothing is " +
              "dropped, so the list is complete.",
          ),
      })
      .strict(),
    handler: ({ category, notClearingFloorOnly }) => {
      const { products, floors } = read();
      return products
        .filter((p) => !category || p.category === category)
        .filter(
          (p) =>
            !notClearingFloorOnly || productFloorStatus(floors, p) !== "clear",
        )
        .map((p) => {
          const margin = productMargin(p);
          const floor =
            floors.find((f) => f.category === p.category)?.floor ?? null;
          return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            category: p.category,
            listPrice: p.listPrice,
            unitCost: p.unitCost,
            marginRatio: margin,
            marginLabel: formatMargin(margin),
            floorRatio: floor,
            floorLabel: marginLabel(floor),
            // `null` — alongside a `null` floor — when the category has no floor
            // on file. A `false` here would tell generated UI the SKU is fine.
            belowFloor: nullableBelowFloor(productFloorStatus(floors, p)),
            inventory: p.inventory,
            trailing30Units: p.trailing30Units,
            weeksOfCover: weeksOfCover(p),
            status: p.status,
            vendor: p.vendor,
          };
        });
    },
  }),
  define({
    name: "getMarginFloors",
    description:
      "The category margin policy: the floor a markdown may not break and the " +
      "planned target margin for each category. `floorRatio` and `targetRatio` " +
      "are fractions of 1 (0.42 means 42%); `floorLabel` and `targetLabel` are " +
      "the display strings the app shows — render the label.",
    parameters: z.object({}),
    handler: () =>
      read().floors.map((f) => ({
        category: f.category,
        floorRatio: f.floor,
        floorLabel: formatMargin(f.floor),
        targetRatio: f.target,
        targetLabel: formatMargin(f.target),
      })),
  }),
  define({
    name: "getOrders",
    description:
      "The order book — status, exception, value, units and how many days each " +
      "order has been waiting. `total` is whole US dollars, `units` is items on " +
      "the order, and `ageDays` is whole days since it was placed.",
    parameters: z.object({
      status: z
        .enum(["all", "open", "on-hold", "fulfilled", "cancelled"])
        .optional()
        .describe("Defaults to all."),
      exceptionsOnly: z
        .boolean()
        .optional()
        .describe(
          "Only orders still in the exception queue — carrying an exception " +
            "and not cancelled.",
        ),
    }),
    handler: ({ status = "all", exceptionsOnly }) => {
      const { orders } = read();
      return orders
        .filter((o) => status === "all" || o.status === status)
        .filter((o) => !exceptionsOnly || isOnException(o))
        .map((o) => ({
          id: o.id,
          number: o.number,
          customer: o.customerName,
          channel: o.channel,
          destination: o.destination,
          status: o.status,
          exception: ORDER_EXCEPTION_LABEL[o.exception],
          total: o.total,
          units: orderUnits(o),
          ageDays: ageInDays(o.placedAt),
        }));
    },
  }),
  define({
    name: "getPromotions",
    description:
      "Markdowns and promotions with the margin each would actually trade at " +
      "once its discount applies, and whether that breaks the category floor. " +
      "`discountPercent` is whole percent off list (40 means 40% off). " +
      "`discountedPrice` is US dollars and may carry cents. `marginRatio` and " +
      "`floorRatio` are fractions of 1 (0.418 means 41.8%); `marginLabel` and " +
      "`floorLabel` are the display strings the app shows — render the label. " +
      "All four, and `belowFloor`, are null when the product or its floor is " +
      "missing.",
    parameters: z.object({
      status: z
        .enum(["all", "pending", "approved", "declined"])
        .optional()
        .describe("Defaults to pending."),
    }),
    handler: ({ status = "pending" }) => {
      const { promotions, products, floors } = read();
      return promotions
        .filter((p) => status === "all" || p.status === status)
        .map((promo) => {
          const item = products.find((p) => p.id === promo.productId);
          const floor =
            floors.find((f) => f.category === item?.category)?.floor ?? null;
          const price = item
            ? discountedPrice(item.listPrice, promo.discountPercent)
            : null;
          const margin = promotionMargin(item, promo);
          return {
            id: promo.id,
            name: promo.name,
            product: item?.name ?? "Unknown",
            category: item?.category ?? null,
            discountPercent: promo.discountPercent,
            discountedPrice: price,
            marginRatio: margin,
            marginLabel: marginLabel(margin),
            floorRatio: floor,
            floorLabel: marginLabel(floor),
            // `null` when the product or its floor is missing: generated UI must
            // not be able to draw an uncheckable markdown as a compliant one.
            belowFloor: nullableBelowFloor(
              promotionFloorStatus(floors, item, promo),
            ),
            status: promo.status,
          };
        });
    },
  }),
  define({
    name: "getReturns",
    description:
      "The returns desk — reason, value, status and any refund already issued. " +
      "`itemValue` and `refundAmount` are US dollars; `refundAmount` is null " +
      "until a refund has actually been issued. `ageDays` is whole days since " +
      "the return was requested.",
    parameters: z.object({
      status: z
        .enum(["all", "requested", "approved", "refunded", "declined"])
        .optional()
        .describe("Defaults to all."),
    }),
    handler: ({ status = "all" }) => {
      const { returns, products } = read();
      return returns
        .filter((r) => status === "all" || r.status === status)
        .map((r) => ({
          id: r.id,
          orderNumber: r.orderNumber,
          customer: r.customerName,
          product:
            products.find((p) => p.id === r.productId)?.name ?? "Unknown",
          reason: RETURN_REASON_LABEL[r.reason],
          status: r.status,
          itemValue: r.itemValue,
          refundAmount: r.refundAmount,
          ageDays: ageInDays(r.requestedAt),
        }));
    },
  }),
  define({
    name: "getTradingKpis",
    description:
      "Headline trading figures: open orders, how many carry an exception, " +
      "products below their margin floor, pending markdowns, and the value " +
      "sitting in the exception queue. `valueAtRisk` is whole US dollars; every " +
      "other figure is a count. `belowFloorSkus` is null when " +
      "`skusWithNoFloorOnFile` is above zero — the range could not be fully " +
      "checked, so do NOT render it as a zero or as an all-clear.",
    parameters: z.object({}),
    handler: () => {
      const { orders, products, floors, promotions, returns } = read();
      return {
        openOrders: orders.filter((o) => o.status === "open").length,
        // The exception set and the at-risk total come from the SHARED
        // predicates, so this KPI block cannot drift from the Orders page the way
        // it used to. The below-floor figure stays `null` whenever any SKU could
        // not be checked — see the description above, which promises exactly that.
        ordersOnException: ordersOnException(orders).length,
        valueAtRisk: valueAtRisk(orders),
        belowFloorSkus: belowFloorCount(floors, products),
        skusWithNoFloorOnFile: tallyFloorStatus(floors, products).unknown,
        pendingPromotions: promotions.filter((p) => p.status === "pending")
          .length,
        openReturns: openReturns(returns).length,
        categories: [...new Set(products.map((p) => p.category))],
      };
    },
  }),
];
