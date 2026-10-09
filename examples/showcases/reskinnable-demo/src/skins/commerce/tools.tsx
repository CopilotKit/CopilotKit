"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  useAgentContext,
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { CheckCircle2, CircleAlert, Radio, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { useCommerceLedger } from "./data/ledger-context";
import {
  CATEGORY_VOCABULARY,
  categoryParameter,
  resolveCategoryScope,
} from "./category-argument";
import {
  EXCEPTION_FILTERS,
  HOLD_REASONS,
  ORDER_EXCEPTION_LABEL,
  ORDER_SORTS,
  ORDER_STATUS_FILTERS,
  RETURN_REASON_LABEL,
  ageInDays,
  formatMargin,
  formatMoney,
  isOnException,
  nullableBelowFloor,
  orderUnits,
  productFloorStatus,
  productMargin,
  promotionFloorStatus,
  promotionMargin,
  refundGuidance,
  weeksOfCover,
} from "./data/derive";
import {
  JUSTIFICATION_MAX_LENGTH,
  JUSTIFICATION_MIN_LENGTH,
} from "./data/waiver-codes";
import * as records from "./data/find-record";
import type {
  CommerceStoreState,
  MarginFloor,
  Order,
  Product,
  ReturnRequest,
} from "./data/types";
import { NOTIFICATION_TEMPLATES } from "./data/types";
import { selectSummaryRows } from "./margin-summary";
import {
  normalizeQueueLevers,
  queueLeverChips,
  queueLeverQuery,
} from "./order-queue-levers";
import { readRefundedCustomer, submitRefund } from "./refund";
import {
  describeError,
  isWriteFailureLine,
  narrateWrite,
  settleInterrupt,
  staleNote,
} from "./settle";
import { MarginLadder } from "./components/margin-ladder";
import { SkuTile } from "./components/sku-tile";
import { Pill } from "./components/primitives";
import { useRecording } from "@/shell/teach";
import {
  SAVE_PROCEDURE_CONFIRMED,
  SAVE_PROCEDURE_DECLINED,
  buildDemonstrationDirective,
  classifySaveProcedureResult,
  readDemonstratedStepCount,
} from "./teach-mode-directives";

/**
 * Every frontend tool, HITL card, gen-UI component and global readable
 * Bellwether ships. Renders null. Registered at the SKIN level rather than per
 * page, so the teach-mode chain survives the navigation it is recording.
 *
 * Six rules run through this whole file; each fails SILENTLY if broken.
 *
 *  1. EVERY registration closes with a deps array. Omit it and the closure
 *     captures whatever the data was at registration time — for a REST-backed
 *     skin, the EMPTY ledger from before the first fetch — forever. It compiles,
 *     it lints, it passes tests, and the agent narrates confidently over a
 *     component rendering its "not found" branch.
 *
 *  2. A parameterized `useComponent` render receives the schema output DIRECTLY
 *     (`render: ({ category }) => …`). Only `useFrontendTool` and
 *     `useHumanInTheLoop` renders get `{ args, status, result, respond }`.
 *
 *  3. Renders are REPLAY-SAFE: keyed off `result`, never off `status`. Reopen a
 *     thread and you get the recorded result with no live status transition, so
 *     a status-keyed render is perfect during the demo and blank the moment
 *     anyone revisits — which is exactly when beat 2 is being shown.
 *
 *  4. Nothing sensitive goes into a tool result. Whatever a handler returns is
 *     stored in the thread forever (beat 3a).
 *
 *  5. A HITL card NEVER calls `respond` directly — it goes through
 *     `settleInterrupt` from `./settle`, and a card that awaits anything must
 *     restore its own controls in a `finally`. `respond` is `undefined` while
 *     arguments stream and its promise can reject, so `respond?.(…)` silently
 *     drops the response and WEDGES the run: the card waits, the agent waits,
 *     and nothing is logged. Read the header of `./settle` before touching any
 *     card's buttons.
 *
 *  6. EVERY write handler's body goes through `narrateWrite` from `./settle`, and
 *     `!res.ok` is only HALF of the failures. A `fetch` REJECTS when the browser
 *     is offline or the dev server restarts mid-call, and an uncaught rejection
 *     throws out of the handler, so the agent gets no result for that step at
 *     all. Beat 5 is a three-write chain against one order, so that is not one
 *     missing sentence — it is a half-mutated ledger with one visible receipt,
 *     one vanished write, and no error anywhere.
 */

/**
 * BEAT 2 + 3a — replay memory for the refund card.
 *
 * On thread reopen a HITL call replays as in-progress with no live state, so the
 * card needs somewhere to recover what happened. This map holds ONLY the
 * customer's name and the product label — never the figure the merchant typed.
 * That omission is the beat: the amount exists in the REST call and the ledger,
 * and nowhere the assistant or the transcript can reach.
 */
const answeredRefunds = new Map<string, { customer: string }>();

/** Same idea for the navigate-confirm card. */
const answeredNavigations = new Map<string, { confirmed: boolean }>();

function ToolCard({
  tone = "brand",
  children,
}: {
  tone?: "brand" | "positive" | "negative";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "my-1 rounded-lg border bg-surface p-3 text-ink shadow-soft",
        tone === "brand" && "border-brand/25",
        tone === "positive" && "border-positive/30",
        tone === "negative" && "border-negative/30",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The card a render draws while its arguments are STILL STREAMING.
 *
 * Every render in this file runs from the FIRST frame of its tool call, holding
 * `partialJSONParse(toolCall.function.arguments)` — which is `{}` until the first
 * field closes. So an argument that the schema declares REQUIRED is `undefined`
 * for some of the renders it appears in, and a render either guards for that or
 * ships one of two bugs: it dereferences the absent value and THROWS inside React
 * render, or it formats the absent value into a confident label and asserts
 * something nobody has established.
 *
 * The honest state is neither a default nor an empty return: a default asserts a
 * choice the agent has not made (the precedent is the Sort chip in
 * `./order-queue-levers`, which printed "oldest first" over an unset lever), and
 * rendering nothing at all is worse television than a placeholder — beat 1 leads
 * with generative UI and the room is watching it appear. So: a visible, muted
 * card that claims only what is known.
 */
function ArrivingCard({ children }: { children: React.ReactNode }) {
  return (
    <ToolCard>
      <p className="text-[0.78rem] text-ink-muted">{children}</p>
    </ToolCard>
  );
}

/**
 * The trimmed string an argument holds once it has ARRIVED, or `null` while it
 * has not.
 *
 * `null` covers all three shapes an unarrived argument takes: absent, blank (the
 * `{"product": "` frame parses to `""`), and not-a-string-yet — a render is
 * handed unvalidated JSON, so `typeof` is part of the guard rather than a
 * formality.
 */
function arrivedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A one-line "this happened" receipt. Every mutation gets one. */
function Receipt({
  tone = "positive",
  icon,
  children,
}: {
  tone?: "positive" | "negative";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "my-1 flex items-start gap-2 rounded-lg border px-3 py-2 text-[0.8rem]",
        tone === "positive"
          ? "border-positive/30 bg-positive-soft text-ink"
          : "border-negative/30 bg-negative-soft text-ink",
      )}
    >
      <span className={tone === "positive" ? "text-positive" : "text-negative"}>
        {/* The icon FOLLOWS the tone by default. A negative receipt that had to
            be handed a CircleAlert explicitly is a receipt that reads as a green
            tick the one time somebody forgets — and on a failure line the tick is
            what the room believes, not the sentence. */}
        {icon ??
          (tone === "negative" ? (
            <CircleAlert className="mt-0.5 h-4 w-4" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4" />
          ))}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/**
 * The receipt for a write tool's result — the ONE renderer every write handler
 * uses, so tone can never drift from what the line actually says.
 *
 * `isWriteFailureLine` covers both halves of "it didn't happen": the server
 * refused it (`REFUSED…`) or it never completed (`narrateWrite`'s prefix). The
 * `REFUSED` marker itself is stripped — it is an internal convention the renders
 * branch on, not something to put in front of an audience.
 */
function WriteReceipt({ result }: { result: unknown }) {
  const failed = isWriteFailureLine(result);
  return (
    <Receipt tone={failed ? "negative" : "positive"}>
      {String(result).replace(/^REFUSED(?: \([^)]*\))?:\s*/, "")}
    </Receipt>
  );
}

export function CommerceTools() {
  const { data, refresh, operator } = useCommerceLedger();
  const router = useRouter();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const recording = useRecording();

  /**
   * Handlers read the ledger through a ref, not through the closure.
   *
   * `useFrontendTool` / `useHumanInTheLoop` TEAR DOWN and re-register whenever
   * their deps change. A `[data]` dep on a tool that itself mutates the ledger
   * therefore unregisters the tool in the middle of its own call — the write
   * lands, the tool disappears, and the agent gets no result. Banking hit this
   * exact bug with its PIN tool. So: `[]` deps on write tools plus this ref, and
   * real deps on the read-only display components below.
   */
  const ledgerRef = useRef<CommerceStoreState>(data);
  useEffect(() => {
    ledgerRef.current = data;
  }, [data]);
  const operatorRef = useRef(operator);
  useEffect(() => {
    operatorRef.current = operator;
  }, [operator]);

  /**
   * Resolving an agent-supplied reference to a row. The matching itself is pure
   * and lives in `./data/find-record` — including the guard that makes a BLANK
   * needle resolve to nothing instead of to `rows[0]` (read that file's header
   * before touching any of the three). These are only the ledgerRef bindings.
   */
  const findOrder = (needle: string): Order | undefined =>
    records.findOrder(ledgerRef.current.orders, needle);

  const findProduct = (needle: string): Product | undefined =>
    records.findProduct(ledgerRef.current.products, needle);

  const findReturn = (needle: string): ReturnRequest | undefined =>
    records.findReturn(ledgerRef.current.returns, needle);

  // ── Global readables ──────────────────────────────────────────────────────
  // The page-scoped readables (in each page component) say what is ON SCREEN.
  // This one says what EXISTS, so tools callable from anywhere — hold an order,
  // approve a markdown — can resolve a name to an id without the user having to
  // be on the right page first.
  useAgentContext({
    description:
      "The Bellwether commerce ledger: the whole product range with each " +
      "item's margin against its category floor, the category margin policy, " +
      "the whole order book — cancelled orders included — with each row's " +
      "exception and whether it still counts as queue work (`onException`), " +
      "the returns desk, the pending markdowns, and the restock plans on file. " +
      "Use this to resolve a product, order, return or markdown to an id " +
      "before calling any tool.",
    value: JSON.stringify({
      marginFloors: data.floors,
      products: data.products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        vendor: p.vendor,
        listPrice: p.listPrice,
        unitCost: p.unitCost,
        margin: formatMargin(productMargin(p)),
        // `null`, never `false`, when the category has no floor on file — the
        // agent must not be able to report an unchecked SKU as compliant.
        belowFloor: nullableBelowFloor(productFloorStatus(data.floors, p)),
        inventory: p.inventory,
        weeksOfCover: weeksOfCover(p),
        status: p.status,
      })),
      // The WHOLE order book, cancelled rows included. This used to filter them
      // out, which made `cancelled` the one status `showOrderQueue` could set and
      // the agent could not then talk about: the page has that control, renders
      // those rows and describes them in its own readable, and the OGUI sandbox's
      // `getOrders` returns them — so the exclusion also put a page readable
      // listing rows next to a ledger readable denying they exist.
      //
      // What a cancelled order is NOT is queue work, and that is said HERE with
      // the one shared predicate rather than by dropping the row: `onException`
      // is `isOnException`, the same clause behind every count, figure and queue
      // list in the skin.
      orders: data.orders.map((o) => ({
        id: o.id,
        number: o.number,
        customer: o.customerName,
        status: o.status,
        exception: ORDER_EXCEPTION_LABEL[o.exception],
        onException: isOnException(o),
        total: o.total,
        units: orderUnits(o),
        ageDays: ageInDays(o.placedAt),
      })),
      returns: data.returns.map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber,
        customer: r.customerName,
        product: data.products.find((p) => p.id === r.productId)?.name,
        reason: RETURN_REASON_LABEL[r.reason],
        status: r.status,
        itemValue: r.itemValue,
      })),
      pendingMarkdowns: data.promotions
        .filter((p) => p.status === "pending")
        .map((promo) => {
          const item = data.products.find((p) => p.id === promo.productId);
          const floor = data.floors.find(
            (f) => f.category === item?.category,
          )?.floor;
          const margin = promotionMargin(item, promo);
          return {
            id: promo.id,
            name: promo.name,
            product: item?.name,
            discountPercent: promo.discountPercent,
            margin: margin === null ? null : formatMargin(margin),
            floor: floor === undefined ? null : formatMargin(floor),
            // Same rule as the products above: `null` when it could not be
            // checked. Beat 6 turns on this flag, so a false `false` here would
            // have the agent claim a gated markdown is clear to approve.
            belowFloor: nullableBelowFloor(
              promotionFloorStatus(data.floors, item, promo),
            ),
          };
        }),
      restockPlans: data.plans.map((plan) => ({
        id: plan.id,
        vendor: plan.vendor,
        season: plan.season,
      })),
    }),
  });

  // ══ BEAT 1 — GIVE THE AGENT A FACE ═══════════════════════════════════════
  // Lead with generative UI, never a wall of text. The margin ladder is
  // Bellwether's signature visual and its first answer.

  useComponent(
    {
      name: "showMarginLadder",
      description:
        "Display the margin ladder: every product plotted at its gross margin " +
        "against its own category floor, with anything below its floor flagged " +
        "in red beneath the line. Use this for any question about margin, " +
        "which products are below floor, or how the range is trading. Render " +
        "the ladder AND answer in one or two sentences — never one without the " +
        "other.",
      // ENUMERATED, not `z.string()`. The category is the one closed-set value
      // the model fills here, and the enum is what puts the five accepted names
      // in the tool definition it reads. See `./category-argument` — the same
      // parameter the OGUI sandbox advertises.
      parameters: z.object({
        category: categoryParameter
          .optional()
          .describe(
            `Restrict the ladder to one category, spelled exactly — one of: ${CATEGORY_VOCABULARY}. Omit for the whole range.`,
          ),
      }),
      // Parameterized `useComponent` → the render receives the schema output
      // DIRECTLY. This is NOT the `{ args }` shape a HITL render gets.
      render: ({ category }) => {
        // …and the schema above is NOT enforced before this runs. A render is
        // handed `partialJSONParse(toolCall.function.arguments)` verbatim, and a
        // render-only tool posts an EMPTY tool result, so there is nowhere to
        // report a bad argument back to either. `resolveCategoryScope` is the
        // enforcement; read its module header before loosening anything here.
        const scope = resolveCategoryScope(category);
        if (scope.kind === "unknown") {
          // NOT a ladder. An off-vocabulary category used to draw all five rails
          // with no dots on them, which is the worst outcome available: it looks
          // like an answer.
          return (
            <ToolCard tone="negative">
              <p className="text-[0.8rem] text-ink-muted">
                There is no “{scope.value}” category in the range, so there is
                nothing to plot. Bellwether trades {CATEGORY_VOCABULARY} — ask
                again with one of those.
              </p>
            </ToolCard>
          );
        }
        // `arriving` — a prefix of a real category, i.e. still streaming — draws
        // the whole range exactly as an omitted category does.
        const only = scope.kind === "one" ? scope.category : null;
        // No floors fallback. The old `floors.length ? floors : data.floors` was
        // the other half of the empty ladder: it re-broadened the RAILS while
        // leaving the products filtered. A real category with no floor on file
        // now draws no rail and `ladderCaption` says why.
        const floors = only
          ? data.floors.filter((f) => f.category === only)
          : data.floors;
        const items = only
          ? data.products.filter((p) => p.category === only)
          : data.products;
        return (
          <ToolCard>
            <MarginLadder floors={floors} products={items} compact />
          </ToolCard>
        );
      },
    },
    [data],
  );

  useComponent(
    {
      name: "showProduct",
      description:
        "Display one product's card: price, landed cost, margin against its " +
        "category floor, inventory and weeks of cover. Use when the user asks " +
        "about a specific SKU.",
      parameters: z.object({
        product: z.string().describe("The product's name, SKU code or id."),
      }),
      render: ({ product }) => {
        // The needle STREAMS, so the first renders of every call to this card
        // hold no needle at all. It used to go straight into the matcher, and a
        // miss on nothing drew the red "Nothing in the range matches “”" — a
        // refusal flashed over an argument the agent had not finished sending, on
        // every SKU the demo looks up. An arriving card instead; the red one is
        // for a needle that arrived and matched nothing, which is a real answer.
        const needle = arrivedText(product);
        if (needle === null) {
          return <ArrivingCard>Looking up the product…</ArrivingCard>;
        }
        // Reads `data`, not ledgerRef — this is a display component with a
        // `[data]` dep, so the closure is live. Same pure matcher as the tools,
        // so a blank argument renders the "nothing matches" branch rather than
        // presenting the first SKU in the range as the one that was asked for.
        const item = records.findProduct(data.products, needle);
        if (!item) {
          return (
            <ToolCard tone="negative">
              <p className="text-[0.8rem] text-ink-muted">
                Nothing in the range matches “{needle}”.
              </p>
            </ToolCard>
          );
        }
        const margin = productMargin(item);
        const floor = data.floors.find(
          (f) => f.category === item.category,
        )?.floor;
        const status = productFloorStatus(data.floors, item);
        const below = status === "below";
        const cover = weeksOfCover(item);
        return (
          <ToolCard>
            <div className="flex items-start gap-3">
              <SkuTile
                name={item.name}
                size="lg"
                ring={below ? "negative" : "brand"}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.name}</p>
                <p className="bw-num text-[0.75rem] text-ink-muted">
                  {item.sku} · {item.vendor}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Pill tone="brand">{item.category}</Pill>
                  <Pill>{formatMoney(item.listPrice)}</Pill>
                  <Pill>cost {formatMoney(item.unitCost)}</Pill>
                  {/* Three states, because the green pill is an assertion. A
                      SKU whose category has no floor on file gets a NEUTRAL
                      pill saying so — it has not been cleared, it has not been
                      checked. */}
                  {below ? (
                    <Pill tone="negative">
                      {formatMargin(margin)} · below floor
                    </Pill>
                  ) : status === "unknown" ? (
                    <Pill tone="neutral">
                      {formatMargin(margin)} · no floor on file
                    </Pill>
                  ) : (
                    <Pill tone="positive">{formatMargin(margin)} margin</Pill>
                  )}
                  {floor !== undefined ? (
                    <Pill>floor {formatMargin(floor)}</Pill>
                  ) : null}
                </div>
                <p className="bw-num mt-2 text-[0.72rem] text-ink-muted">
                  {item.inventory.toLocaleString("en-US")} on hand ·{" "}
                  {item.trailing30Units.toLocaleString("en-US")} sold in 30 days
                  {cover === null ? "" : ` · ${cover} weeks of cover`}
                </p>
              </div>
            </div>
          </ToolCard>
        );
      },
    },
    [data],
  );

  useComponent(
    {
      name: "showOrderList",
      description:
        "Display a list of orders by id or order number. Use this instead of " +
        "writing a markdown table whenever you are showing more than one order.",
      parameters: z.object({
        orderIds: z
          .array(z.string())
          .describe("Order ids or numbers, in the order to show."),
        caption: z.string().optional(),
      }),
      render: ({ orderIds, caption }) => {
        // BEAT 1 CRASHED HERE. `orderIds` is declared required, which is not the
        // same as PRESENT: this render ran `orderIds.map(…)` from the first frame
        // of the call, before any id had streamed, so it threw a TypeError inside
        // React render on the beat the demo opens with. `?? []` is banking's
        // established guard for the identical shape (`showTable`'s
        // `columns ?? []` / `rows ?? []`, src/skins/banking/tools.tsx:793-794);
        // the array's CONTENTS need the same treatment, because a half-streamed
        // `["` parses to `[""]` and `id.replace` throws on anything unstringy.
        const ids = (Array.isArray(orderIds) ? orderIds : [])
          .map((id) => arrivedText(id))
          .filter((id): id is string => id !== null);
        // No ids yet is NOT "no order matched" — that red card is an answer, and
        // asserting it before the argument arrives makes every order list the
        // demo draws open on a refusal.
        if (ids.length === 0) {
          return <ArrivingCard>Pulling the orders…</ArrivingCard>;
        }
        const rows = ids
          .map(
            (id) =>
              data.orders.find((o) => o.id === id) ??
              data.orders.find((o) => o.number === id.replace(/^#/, "")),
          )
          .filter((o): o is Order => Boolean(o));
        if (rows.length === 0) {
          return (
            <ToolCard tone="negative">
              <p className="text-[0.8rem] text-ink-muted">
                No matching orders.
              </p>
            </ToolCard>
          );
        }
        return (
          <ToolCard>
            {caption ? (
              <p className="mb-2 text-[0.75rem] font-medium text-ink-muted">
                {caption}
              </p>
            ) : null}
            <ul className="divide-y divide-hairline">
              {rows.map((order) => (
                <li key={order.id} className="flex items-center gap-2 py-1.5">
                  <SkuTile
                    name={order.customerName}
                    size="xs"
                    shape="round"
                    ring={order.exception !== "none" ? "negative" : null}
                  />
                  <span className="bw-num shrink-0 text-[0.72rem] text-ink-muted">
                    #{order.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.78rem]">
                    {order.customerName}
                    {order.exception !== "none" ? (
                      <span className="ml-1.5 text-negative">
                        {ORDER_EXCEPTION_LABEL[order.exception]}
                      </span>
                    ) : null}
                  </span>
                  <span className="bw-num shrink-0 text-[0.7rem] text-ink-muted">
                    {ageInDays(order.placedAt)}d
                  </span>
                  <span className="bw-num shrink-0 text-[0.72rem] font-medium">
                    {formatMoney(order.total)}
                  </span>
                </li>
              ))}
            </ul>
          </ToolCard>
        );
      },
    },
    [data],
  );

  // ══ BEAT 4 — LONG-TERM MEMORY ════════════════════════════════════════════
  // `note` is the slot where the agent NAMES the preference it recalled. Without
  // a visible "why", recall looks like a normal answer and the beat is invisible
  // to the room even when it worked perfectly.
  useComponent(
    {
      name: "showMarginSummary",
      description:
        "Summarize where margin stands across the range. Before calling this, " +
        "recall the user's saved formatting preference and pass it through the " +
        "flags. ALWAYS fill `note` with the preference you applied, in your own " +
        "words — that is how the user knows you remembered.",
      parameters: z.object({
        byCategory: z
          .boolean()
          .describe("Group by category rather than by vendor."),
        belowFloorFirst: z
          .boolean()
          .describe("Put anything under its category floor at the top."),
        asMarginPercent: z
          .boolean()
          .describe(
            "Show each product as its gross margin percent instead of its price.",
          ),
        note: z
          .string()
          .describe(
            "Name the saved preference you applied, e.g. 'You read these by category, below-floor first.'",
          ),
      }),
      render: ({ byCategory, belowFloorFirst, asMarginPercent, note }) => (
        <MarginSummaryList
          products={data.products}
          floors={data.floors}
          byCategory={byCategory}
          belowFloorFirst={belowFloorFirst}
          asMarginPercent={asMarginPercent}
          note={note}
        />
      ),
    },
    [data],
  );

  // ══ BEAT 3a — DRIVE THE APP, SECRET WITHHELD ═════════════════════════════
  useHumanInTheLoop(
    {
      name: "issueRefund",
      description:
        "Open the refund card for one return so the user can enter the " +
        "goodwill amount themselves. NEVER ask for the figure and never ask " +
        "which return first — call this immediately with your best match.",
      parameters: z.object({
        returnRef: z
          .string()
          .describe("The return id, the customer's name, or the order number."),
      }),
      render: ({ args, respond, result, toolCallId }) => {
        // REPLAY-SAFE. Consult the answered map first (a thread reopened in the
        // same session), then the recorded `result` (a reload). Only fall
        // through to the live editor when neither exists. Nothing here reads
        // `status`, which does not replay.
        //
        // The result must be CLASSIFIED, not merely detected. An earlier version
        // of the equivalent card in the people skin branched on "is there a
        // result at all" and rendered the success receipt for every settled
        // call — so a CANCELLED refund replayed as "Refund issued", claiming a
        // mutation that never happened. A replayed card asserting a write that
        // did not occur is worse than a blank one, and only shows up when
        // someone reopens the thread — which is exactly when beat 2 is being
        // demonstrated.
        const remembered = toolCallId
          ? answeredRefunds.get(toolCallId)
          : undefined;
        const settled = typeof result === "string" ? result : null;
        // The name comes back through `readRefundedCustomer`, which lives beside
        // the line `submitRefund` writes — the card does not carry its own idea
        // of how that sentence is worded.
        const refundedCustomer =
          remembered?.customer ??
          (settled ? readRefundedCustomer(settled) : null);

        if (refundedCustomer) {
          return (
            <Receipt>
              Refund issued on <strong>{refundedCustomer}</strong>&rsquo;s
              return. The amount stayed in this card — it was never sent to the
              assistant.
            </Receipt>
          );
        }
        if (settled) {
          // Cancelled, or the REST call was refused. Say which, plainly.
          const cancelled = /cancelled/i.test(settled);
          return (
            <Receipt
              tone="negative"
              icon={<CircleAlert className="mt-0.5 h-4 w-4" />}
            >
              {cancelled
                ? "The refund was cancelled — nothing was issued."
                : settled}
            </Receipt>
          );
        }
        return (
          <RefundCard
            query={args?.returnRef ?? ""}
            find={findReturn}
            productName={(id) =>
              ledgerRef.current.products.find((p) => p.id === id)?.name ??
              "the item"
            }
            // `submitRefund` is TOTAL: every path through it settles the
            // interrupt and it never throws, resolving with `null` on success or
            // the sentence the card must show. It lives in `./refund` so that
            // guarantee is directly testable rather than asserted in a comment.
            onDone={(request, amount) =>
              submitRefund({
                request,
                amount,
                respond,
                refresh,
                onIssued: () => {
                  if (toolCallId) {
                    answeredRefunds.set(toolCallId, {
                      customer: request.customerName,
                    });
                  }
                },
              })
            }
            onCancel={() =>
              settleInterrupt(respond, "The user cancelled the refund.")
            }
          />
        );
      },
    },
    // `[]` + ledgerRef: this tool writes, and a data dep would tear it down
    // mid-write. See the note on ledgerRef above.
    [],
  );

  // ══ BEAT 3c — NAVIGATE WITH LEVERS ═══════════════════════════════════════
  useHumanInTheLoop(
    {
      name: "showOrderQueue",
      description:
        "Take the user to the Orders page with a specific status filter, " +
        "exception filter, sort order and top-N limit applied. Confirm the " +
        "levers with them first. Use for any 'show me the oldest / biggest / " +
        "stuck orders' question. For anything about orders being STUCK or " +
        "WAITING, filter on the exception and leave status as 'all' — an " +
        "exception filter already excludes clean orders, and pinning the " +
        "status as well means any order you later put on hold drops straight " +
        "out of the view you just built.",
      // Every lever's advertised values come from the page's OWN control
      // vocabularies, so the tool cannot offer a value the Orders page has no
      // control for. `top` is `.int().positive()` because that is precisely what
      // `parseTopLever` will honour — a fractional or zero limit is not a limit.
      parameters: z.object({
        status: z.enum(ORDER_STATUS_FILTERS),
        exception: z
          .enum(EXCEPTION_FILTERS)
          .describe("'any' means every order still carrying an exception."),
        sort: z.enum(ORDER_SORTS),
        top: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Limit to the first N rows."),
        reason: z.string().describe("One short line on why this view."),
      }),
      render: ({ args, respond, result, toolCallId }) => {
        const remembered = toolCallId
          ? answeredNavigations.get(toolCallId)
          : undefined;
        const settled = remembered !== undefined || typeof result === "string";
        const confirmed =
          remembered?.confirmed ?? String(result ?? "").startsWith("Opened");

        // ONE normalized record behind both the chips and the URL — see the
        // header of `./order-queue-levers`. A lever that was not set (arguments
        // stream, so mid-render that is every lever) draws NO chip rather than a
        // default the agent never chose.
        const levers = normalizeQueueLevers(args);
        const chips = queueLeverChips(levers);

        return (
          <ToolCard tone={settled && !confirmed ? "negative" : "brand"}>
            {/* The headline promises a list only when there is one — no chips
                means no levers have arrived yet, and "with these controls set:"
                over an empty strip is the same false claim in prose. */}
            <p className="text-[0.8rem] font-medium">
              {settled
                ? confirmed
                  ? chips.length
                    ? "Opened the Orders page with these controls set:"
                    : "Opened the Orders page."
                  : "Stayed on this page."
                : chips.length
                  ? "I can open the Orders page with these controls set:"
                  : "I can open the Orders page for you."}
            </p>
            {chips.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {chips.map((chip) => (
                  <li key={chip}>
                    <Pill tone="brand">{chip}</Pill>
                  </li>
                ))}
              </ul>
            ) : null}
            {args?.reason ? (
              <p className="mt-2 text-[0.74rem] text-ink-muted">
                {args.reason}
              </p>
            ) : null}
            {!settled ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    // The same `levers` the chips above were drawn from, so the
                    // view this opens is the view the card just promised. Built
                    // from the ONE normalized record rather than re-read off
                    // `args` here: a second reading is how the chips and the URL
                    // drifted apart in the first place.
                    const query = queueLeverQuery(levers);
                    // The nav is attempted inside a try for the same reason every
                    // write handler now runs inside `narrateWrite`: a throw here
                    // used to escape this async onClick, which means the interrupt
                    // is never settled and the RUN WEDGES — the one failure worse
                    // than not navigating. Whatever `router.push` does, the report
                    // below still goes back.
                    let navigated = true;
                    try {
                      // The Orders page IS the skin index, so this is skinHref()
                      // with no segment — `/commerce` unlocked, `/` under a lock.
                      router.push(`${skinHref()}${query ? `?${query}` : ""}`);
                    } catch (error) {
                      navigated = false;
                      console.error(
                        "[commerce] could not open the Orders view",
                        error,
                      );
                    }
                    // Same rule as the refund card: remember the answer only once
                    // the interrupt is really settled, and never drop the failure
                    // silently — `settleInterrupt` logs one. This card keeps no
                    // state to show it in, so an undelivered response simply
                    // leaves both buttons live and the user clicks again.
                    const failure = await settleInterrupt(
                      respond,
                      navigated
                        ? "Opened the Orders page with the filters and sort applied. The controls are highlighted on screen."
                        : "Could not open the Orders page — the navigation failed, so the user is still where they were.",
                    );
                    if (!failure && toolCallId && navigated) {
                      answeredNavigations.set(toolCallId, { confirmed: true });
                    }
                  }}
                  className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground"
                >
                  Open it
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const failure = await settleInterrupt(
                      respond,
                      "The user chose to stay on the current page.",
                    );
                    if (!failure && toolCallId) {
                      answeredNavigations.set(toolCallId, { confirmed: false });
                    }
                  }}
                  className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
                >
                  Stay here
                </button>
              </div>
            ) : null}
          </ToolCard>
        );
      },
    },
    [],
  );

  // ══ BEAT 5 — THE STORED PROCEDURE'S THREE WRITES ═════════════════════════
  // Registered globally so the procedure can run from any page. Each produces a
  // change the audience can SEE on the Orders page.

  useFrontendTool(
    {
      name: "holdOrder",
      description:
        "Put an order on hold so fulfillment stops, and record which exception " +
        "caused it.",
      parameters: z.object({
        order: z.string().describe("The order number or id."),
        // Built FROM `ORDER_EXCEPTIONS` (see `HOLD_REASONS` in `data/derive`),
        // not hand-copied — same rule as `notifyCustomer`'s templates below and
        // `showOrderQueue`'s levers above.
        reason: z
          .enum(HOLD_REASONS)
          .describe("Which exception is stopping the order."),
      }),
      handler: async ({ order, reason }) => {
        const target = findOrder(order);
        if (!target) return `No order matches "${order}".`;
        // `subject` is the ORDER, shared with the two writes below: that is what
        // lets whichever of the three fails recite what the other two landed.
        return narrateWrite(
          { action: `the hold on order ${target.number}`, subject: target.id },
          async (landed) => {
            const res = await fetch(`/api/commerce/v1/orders/${target.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ status: "on-hold", exception: reason }),
            });
            if (!res.ok)
              return `Could not hold the order (HTTP ${res.status}).`;
            landed("put on hold");
            const refreshed = await refresh();
            recording.logStep(
              `Put order ${target.number} on hold for ${ORDER_EXCEPTION_LABEL[reason]}`,
            );
            return (
              `Order ${target.number} is on hold — ${ORDER_EXCEPTION_LABEL[reason]}.` +
              staleNote(refreshed)
            );
          },
        );
      },
      render: ({ result, args }) => {
        if (result) return <WriteReceipt result={result} />;
        // `args.order` streams too. "Holding order …" with the number missing is
        // the same absent-value formatting as the cards above, so the in-flight
        // line names the order only once it has one.
        const order = arrivedText(args?.order);
        return (
          <ArrivingCard>
            {order ? `Holding order ${order}…` : "Holding the order…"}
          </ArrivingCard>
        );
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "notifyCustomer",
      description:
        "Send the customer on an order a templated message. Use " +
        "'verification-required' when an order is being held for fraud review.",
      parameters: z.object({
        order: z.string().describe("The order number or id."),
        // Built FROM the store's closed set, not hand-copied: the route
        // validates against the same list, so a template the tool offers and the
        // wire refuses (or the reverse) is unrepresentable.
        template: z
          .enum(NOTIFICATION_TEMPLATES)
          .describe("Which templated message to send."),
      }),
      handler: async ({ order, template }) => {
        const target = findOrder(order);
        if (!target) return `No order matches "${order}".`;
        return narrateWrite(
          {
            action: `the message to ${target.customerName} on order ${target.number}`,
            subject: target.id,
          },
          async (landed) => {
            const res = await fetch(
              `/api/commerce/v1/orders/${target.id}/notify`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  template,
                  sentBy: operatorRef.current.name,
                }),
              },
            );
            if (!res.ok)
              return `Could not notify the customer (HTTP ${res.status}).`;
            landed("notified the customer");
            const refreshed = await refresh();
            recording.logStep(
              `Sent ${target.customerName} the ${template} message`,
            );
            return (
              `Sent ${target.customerName} the ${template.replace(/-/g, " ")} message.` +
              staleNote(refreshed)
            );
          },
        );
      },
      render: ({ result }) =>
        result ? <WriteReceipt result={result} /> : null,
    },
    [],
  );

  useFrontendTool(
    {
      name: "postOrderNote",
      description:
        "Post a short note on an order's record saying what was done and why. " +
        "Keep it to one sentence.",
      parameters: z.object({
        order: z.string().describe("The order number or id."),
        text: z.string().describe("The note, one sentence."),
      }),
      handler: async ({ order, text }) => {
        const target = findOrder(order);
        if (!target) return `No order matches "${order}".`;
        // Force the marker. "Use a light or a bell or whatever so people can see
        // that it changed" — a note that reads like every other note is
        // invisible from the back of a room, so the emoji is prepended here
        // rather than left to the model's discretion.
        const marked = text.trim().startsWith("🚨")
          ? text.trim()
          : `🚨 ${text.trim()}`;
        return narrateWrite(
          { action: `the note on order ${target.number}`, subject: target.id },
          async (landed) => {
            const res = await fetch(
              `/api/commerce/v1/orders/${target.id}/notes`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  text: marked,
                  author: operatorRef.current.name,
                }),
              },
            );
            if (!res.ok) return `Could not post the note (HTTP ${res.status}).`;
            landed("posted a note");
            const refreshed = await refresh();
            recording.logStep(`Posted a note on order ${target.number}`);
            return (
              `Posted the note on order ${target.number}.` +
              staleNote(refreshed)
            );
          },
        );
      },
      render: ({ result }) =>
        result ? <WriteReceipt result={result} /> : null,
    },
    [],
  );

  // ── Distractors ──────────────────────────────────────────────────────────
  // Plausible, real, and useless for both the stored procedure and the gate.
  // They are what make "it picked the right three" and "it cleared the gate"
  // mean something rather than being the only options available.
  useFrontendTool(
    {
      name: "requestChargebackEvidence",
      description:
        "Pull the evidence packet a payment processor needs to fight a chargeback.",
      parameters: z.object({ order: z.string() }),
      handler: async ({ order }) =>
        `Chargeback evidence packet requested for order ${findOrder(order)?.number ?? order}.`,
      render: ({ result }) =>
        result ? <Receipt>{String(result)}</Receipt> : null,
    },
    [],
  );

  useFrontendTool(
    {
      name: "scheduleCarrierPickup",
      description:
        "Book a carrier pickup slot for an order that is ready to go.",
      parameters: z.object({ order: z.string() }),
      handler: async ({ order }) =>
        `Carrier pickup scheduled for order ${findOrder(order)?.number ?? order}.`,
      render: ({ result }) =>
        result ? <Receipt>{String(result)}</Receipt> : null,
    },
    [],
  );

  useFrontendTool(
    {
      name: "sendReviewRequest",
      description: "Ask a customer to review what they bought.",
      parameters: z.object({ order: z.string() }),
      handler: async ({ order }) =>
        `Review request queued for ${findOrder(order)?.customerName ?? order}.`,
      render: ({ result }) =>
        result ? <Receipt>{String(result)}</Receipt> : null,
    },
    [],
  );

  useFrontendTool(
    {
      name: "openSupplierClaim",
      description:
        "Open a claim against a supplier for damaged or short-shipped goods.",
      parameters: z.object({ product: z.string(), detail: z.string() }),
      handler: async ({ product, detail }) =>
        `Supplier claim opened on ${findProduct(product)?.name ?? product}: ${detail}`,
      render: ({ result }) =>
        result ? <Receipt>{String(result)}</Receipt> : null,
    },
    [],
  );

  // ══ BEAT 3d — MULTIMODAL IN, DURABLE ARTIFACT OUT ════════════════════════
  useFrontendTool(
    {
      name: "createRestockPlan",
      description:
        "File a restock plan into the app. When the user has attached a vendor " +
        "price sheet, read it and carry its REAL details — the quoted landed " +
        "costs, the minimum order quantities, the freight terms and the ship " +
        "schedule — into this call rather than inventing plausible ones.",
      parameters: z.object({
        vendor: z.string().describe("The supplier the sheet came from."),
        season: z
          .string()
          .describe('What the plan covers, e.g. "Autumn knitwear".'),
        summary: z
          .string()
          .describe("Two sentences on what is being bought and why."),
        highlights: z
          .array(z.string())
          .max(3)
          .describe("At most three short facts worth surfacing."),
        // `landedCost` and `units` are bounded to what a PO can mean, because
        // `POST /plans` refuses anything else field by field (`requireNumber`,
        // with `integer: true` on units) and a 422 the schema could have
        // prevented is a round trip spent on a row the model already had. The
        // ROW COUNT is deliberately not repeated here: that cap is a layout
        // budget owned by the route, which names it in its refusal, and a third
        // copy of the number is a third thing to drift.
        lines: z
          .array(
            z.object({
              sku: z.string(),
              name: z.string(),
              landedCost: z
                .number()
                .nonnegative()
                .describe("Quoted landed cost per unit, in dollars."),
              units: z
                .number()
                .int()
                .nonnegative()
                .describe("Whole units being bought."),
            }),
          )
          .describe("The SKUs the plan covers, at the QUOTED landed cost."),
        schedule: z
          .array(z.object({ week: z.string(), item: z.string() }))
          .describe(
            'The ship schedule, e.g. [{ week: "Week 1", item: "PO countersigned" }].',
          ),
      }),
      handler: async ({
        vendor,
        season,
        summary,
        highlights,
        lines,
        schedule,
      }) => {
        // No `subject`: a plan is filed in ONE write, so there is no sibling
        // write on the same record for a failure here to recite.
        return narrateWrite(
          { action: `the ${season} restock plan for ${vendor}` },
          async (landed) => {
            const res = await fetch("/api/commerce/v1/plans", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                vendor,
                season,
                summary,
                highlights,
                lines,
                schedule,
                filedBy: operatorRef.current.name,
              }),
            });
            if (!res.ok) {
              // Surface the route's message, not just the status. `POST /plans`
              // REFUSES a plan that would not fit the card or whose rows it
              // cannot read (it no longer trims or coerces them into a quietly
              // wrong artifact), and the refusal names the offending field —
              // which is only actionable if the agent can see it.
              const body = await res.json().catch(() => ({}));
              return `Could not file the plan: ${body?.message ?? `HTTP ${res.status}`}`;
            }
            landed("filed the plan");
            const refreshed = await refresh();
            return (
              `Filed the ${season} restock plan for ${vendor}. It is on the Catalog page under Restock plans.` +
              staleNote(refreshed)
            );
          },
        );
      },
      render: ({ result, args }) =>
        result ? (
          // Not `WriteReceipt`: this one carries the durability line that IS
          // beat 3d, and it must not be promised over a plan that never filed.
          isWriteFailureLine(result) ? (
            <WriteReceipt result={result} />
          ) : (
            <Receipt>
              {String(result)}{" "}
              <span className="text-ink-muted">
                It belongs to the app, so deleting this conversation will not
                remove it.
              </span>
            </Receipt>
          )
        ) : (
          <ArrivingCard>
            {arrivedText(args?.vendor)
              ? `Filing the plan for ${arrivedText(args?.vendor)}…`
              : "Filing the restock plan…"}
          </ArrivingCard>
        ),
    },
    [],
  );

  // ══ BEAT 6 — THE GATE, THE UNLOCK, AND THE TEACH CHAIN ═══════════════════

  useFrontendTool(
    {
      name: "approveMarkdown",
      description:
        "Approve a pending markdown so it goes live at the discounted price.",
      parameters: z.object({
        promotionId: z
          .string()
          .describe("The markdown's id, e.g. promo-cedar."),
      }),
      handler: async ({ promotionId }) => {
        // No `subject`: beat 6's chain spans a promotion AND a waiver id, so no
        // single record key would cover it. A half-applied unlock is also benign
        // — a draft waiver that was never finalized changes nothing — which is
        // exactly what beat 5's chain is not.
        return narrateWrite(
          { action: `the approval of ${promotionId}` },
          async (landed) => {
            const res = await fetch(
              `/api/commerce/v1/promotions/${promotionId}/approve`,
              { method: "POST" },
            );
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
              recording.logStep("Approve refused");
              // The refusal is passed through VERBATIM and is symptom-only. Do
              // not append a hint here — the agent must not be able to derive the
              // unlock from the error, or beat 6 stops proving that it learned.
              return `REFUSED (${body?.error ?? res.status}): ${body?.message ?? "Approval refused."}`;
            }
            landed("approved the markdown");
            const refreshed = await refresh();
            const name = body?.promotion?.name ?? "the markdown";
            recording.logStep(`Approved ${name}`);
            // The DISCOUNT clause is dropped rather than filled with `""`. The
            // old line read "goes live at % off" whenever the route's body did
            // not carry the percent — a receipt stating a figure with the figure
            // missing from it, kept in the thread forever (beat 2). Same rule as
            // the streaming renders above: an absent value gets no sentence, not
            // an empty slot in one.
            const discount = body?.promotion?.discountPercent;
            const atDiscount =
              typeof discount === "number" && Number.isFinite(discount)
                ? ` at ${discount}% off`
                : "";
            return (
              `Approved. ${name} goes live${atDiscount}.` + staleNote(refreshed)
            );
          },
        );
      },
      render: ({ result, args }) => {
        if (!result) {
          const promotionId = arrivedText(args?.promotionId);
          return (
            <ArrivingCard>
              {promotionId
                ? `Approving ${promotionId}…`
                : "Approving the markdown…"}
            </ArrivingCard>
          );
        }
        return <WriteReceipt result={result} />;
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "openMarginWaiver",
      description:
        "File a margin waiver against a markdown under a given code.",
      parameters: z.object({
        promotionId: z.string(),
        // DELIBERATELY a free string, and the one parameter in this file that
        // must stay one. `MARGIN_WAIVER_CODES` is a closed set, but enumerating
        // it here would hand the agent the whole catalogue in the tool
        // definition — and beat 6 turns on the agent NOT knowing it and having
        // to watch a merchandiser file one. The store refuses an unknown code
        // without listing the valid ones for exactly the same reason; see the
        // header of `data/waiver-codes.ts`.
        code: z.string().describe("The waiver code to file under."),
        // The API refuses an empty or placeholder justification, so say so here
        // rather than spending a round-trip on a 422 the model has to read.
        justification: z
          .string()
          .min(JUSTIFICATION_MIN_LENGTH)
          .max(JUSTIFICATION_MAX_LENGTH)
          .describe(
            `Why the waiver is being filed — what is on file. At least ${JUSTIFICATION_MIN_LENGTH} characters; never blank.`,
          ),
      }),
      handler: async ({ promotionId, code, justification }) => {
        return narrateWrite(
          { action: `the margin waiver on ${promotionId}` },
          async (landed) => {
            const res = await fetch("/api/commerce/v1/margin-waivers", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ promotionId, code, justification }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) return `REFUSED: ${body?.message ?? res.status}`;
            landed("filed a margin waiver");
            const refreshed = await refresh();
            // Beat 6's next step is `finalizeMarginWaiver`, which needs this id —
            // so "Waiver id undefined" was worse than saying nothing: the agent
            // reads this line and would go on to finalize the string
            // "undefined". Say it only when it is there.
            const waiverId = arrivedText(body?.id);
            return (
              `Filed a margin waiver (${code}).` +
              (waiverId ? ` Waiver id ${waiverId}.` : "") +
              " It still needs finalizing." +
              staleNote(refreshed)
            );
          },
        );
      },
      render: ({ result }) =>
        result ? <WriteReceipt result={result} /> : null,
    },
    [],
  );

  useFrontendTool(
    {
      name: "finalizeMarginWaiver",
      description: "Finalize a draft margin waiver so it takes effect.",
      parameters: z.object({ waiverId: z.string() }),
      handler: async ({ waiverId }) => {
        return narrateWrite(
          { action: `the finalizing of waiver ${waiverId}` },
          async (landed) => {
            const res = await fetch(
              `/api/commerce/v1/margin-waivers/${waiverId}/finalize`,
              { method: "POST" },
            );
            const body = await res.json().catch(() => ({}));
            if (!res.ok) return `REFUSED: ${body?.message ?? res.status}`;
            landed("finalized the margin waiver");
            const refreshed = await refresh();
            const code = arrivedText(body?.code);
            return (
              `Finalized the${code ? ` ${code}` : ""} margin waiver.` +
              staleNote(refreshed)
            );
          },
        );
      },
      render: ({ result }) =>
        result ? <WriteReceipt result={result} /> : null,
    },
    [],
  );

  // ── The teach chain: offer → watch → save ────────────────────────────────
  useHumanInTheLoop(
    {
      followUp: true,
      name: "offerWorkflowRecording",
      description:
        "Call this when you have hit a refusal you have no saved procedure " +
        "for. Say plainly that you do not know this one and offer to watch the " +
        "user do it. Never guess a workaround instead of calling this.",
      parameters: z.object({
        situation: z
          .string()
          .describe("What you were blocked on, in one line."),
      }),
      render: ({ args, respond, result }) => {
        // Settled. Render a HUMAN line, never `result` — that string is an
        // internal directive addressed to the agent ("Call awaitDemonstration
        // now and wait…") and printing it verbatim puts the demo's own wiring on
        // screen in front of the audience.
        if (typeof result === "string") {
          const agreed = /agreed to demonstrate/i.test(result);
          return (
            <ToolCard>
              <p className="text-[0.78rem] text-ink-muted">
                {agreed
                  ? "Watching you do it once."
                  : "Left it for now — nothing was recorded."}
              </p>
            </ToolCard>
          );
        }
        return (
          <ToolCard>
            <p className="text-[0.8rem]">
              I don&rsquo;t have a saved way to do this yet
              {args?.situation
                ? ` — ${args.situation.replace(/\.+$/, "")}`
                : ""}
              . Want to show me once, and I&rsquo;ll remember it?
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  void settleInterrupt(
                    respond,
                    "The user agreed to demonstrate. Call awaitDemonstration now and wait — do not guess any steps.",
                  )
                }
                className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground"
              >
                Show me
              </button>
              <button
                type="button"
                onClick={() =>
                  void settleInterrupt(
                    respond,
                    "The user declined to demonstrate. Stop here.",
                  )
                }
                className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
              >
                Not now
              </button>
            </div>
          </ToolCard>
        );
      },
    },
    [],
  );

  useHumanInTheLoop(
    {
      followUp: true,
      name: "awaitDemonstration",
      description:
        "Hold the conversation while the user demonstrates. Do NOT list steps " +
        "or suggest what they should do — you do not know yet. That is the point.",
      parameters: z.object({}),
      render: ({ respond, result }) => {
        // Same rule as above: `result` is the raw observed-steps directive
        // written for the agent. Summarize it for the human instead.
        if (typeof result === "string") {
          // The figure the RECORDER reported, never one re-counted out of this
          // prose: a step label containing "1. 50" or "12.5 %" used to be
          // counted as a step of its own. `null` = the directive carries no
          // count (an older thread), so claim no number at all.
          const count = readDemonstratedStepCount(result);
          return (
            <ToolCard tone="positive">
              <p className="text-[0.78rem]">
                Recorded{" "}
                {count === null
                  ? "the demonstration"
                  : `${count} ${count === 1 ? "step" : "steps"}`}
                .
              </p>
            </ToolCard>
          );
        }
        return (
          <DemonstrationCard
            onDone={(summary) => settleInterrupt(respond, summary)}
          />
        );
      },
    },
    [],
  );

  useHumanInTheLoop(
    {
      followUp: true,
      name: "saveLearnedProcedure",
      description:
        "Summarize what you just watched as a numbered procedure and show it " +
        "for confirmation. After the user confirms, persist it with save_memory " +
        "(scope 'user', kind 'operational'). Save it AT MOST ONCE.",
      parameters: z.object({
        procedure: z
          .string()
          .describe(
            "The numbered procedure, naming the exact waiver code that worked.",
          ),
      }),
      render: ({ args, respond, result }) => {
        // CLASSIFIED, not merely detected — see `teach-mode-directives.ts`. Both
        // buttons below settle this tool with a string, so "is there a result at
        // all" would print the saved receipt over a decline and claim a durable
        // write that never happened. Same rule the refund card above states.
        const outcome = classifySaveProcedureResult(result);
        if (outcome === "saved") {
          return (
            <Receipt>
              Saved. I&rsquo;ll use this next time without being asked.
            </Receipt>
          );
        }
        if (outcome === "declined") {
          return (
            <ToolCard>
              <p className="text-[0.78rem] text-ink-muted">
                Left it unsaved — nothing was written to memory.
              </p>
            </ToolCard>
          );
        }
        if (outcome === "unknown") {
          return (
            <ToolCard>
              <p className="text-[0.78rem] text-ink-muted">
                This card was already answered.
              </p>
            </ToolCard>
          );
        }
        return (
          <ToolCard>
            <p className="text-[0.78rem] font-medium">
              Here&rsquo;s what I picked up — shall I remember it?
            </p>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface-muted p-2.5 text-[0.73rem] leading-relaxed text-ink">
              {args?.procedure}
            </pre>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  void settleInterrupt(respond, SAVE_PROCEDURE_CONFIRMED)
                }
                className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground"
              >
                Remember it
              </button>
              <button
                type="button"
                onClick={() =>
                  void settleInterrupt(respond, SAVE_PROCEDURE_DECLINED)
                }
                className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
              >
                Don&rsquo;t save
              </button>
            </div>
          </ToolCard>
        );
      },
    },
    [],
  );

  return null;
}

/**
 * BEAT 4's list. Split out of the `showMarginSummary` render so the ordering and
 * the truncation can be tested without a provider stack — the selection itself is
 * pure and lives in `./margin-summary`.
 *
 * The list is CAPPED and says so. It used to render `rows.slice(0, 12)` and
 * nothing else, against a fourteen-SKU seeded range: two rows vanished with no
 * mark, and under `byCategory` — where the ranked order is alphabetical by
 * category — the two that vanished were both Outerwear SKUs, one of them below
 * its floor. A category missing entirely is indistinguishable from a category
 * with nothing to report, so the omission read as an all-clear in the one skin
 * whose whole claim is that margin is comparable across categories. The caption
 * `selectSummaryRows` returns names the count, the below-floor and unchecked
 * rows among them, and any category that disappeared.
 */
export function MarginSummaryList({
  products,
  floors,
  byCategory,
  belowFloorFirst,
  asMarginPercent,
  note,
}: {
  products: Product[];
  floors: MarginFloor[];
  // OPTIONAL, all four, even though the tool schema declares them required. The
  // render is handed streaming arguments, so this component is called with
  // `undefined` in every slot on the way to the real values, and the types said
  // otherwise while the runtime did not — which is how the empty band below
  // shipped.
  byCategory?: boolean;
  belowFloorFirst?: boolean;
  asMarginPercent?: boolean;
  note?: string;
}) {
  // A presentation flag that has not arrived reads as its plain shape (by vendor,
  // in money) — the same defaulting banking does for `showSpendSummary`'s
  // remembered flags. Safe here only because nothing in this card LABELS the
  // flags: the list shows what it shows and claims nothing about why.
  const { visible, caption } = selectSummaryRows(products, floors, {
    byCategory: byCategory ?? false,
    belowFloorFirst: belowFloorFirst ?? false,
  });
  // The `note`, by contrast, is a CLAIM — and it streams last of the four. An
  // absent one used to draw the rose band as an empty coloured bar: beat 4's one
  // visible piece of evidence that memory was recalled, rendered as decoration
  // with nothing in it. No note, no band, exactly as the caption below already
  // does it.
  const why = arrivedText(note);

  return (
    <ToolCard>
      {/* The "why" slot. Rose, because in Bellwether rose marks the thing
          a merchandiser is being asked to notice — and being remembered
          is one. */}
      {why ? (
        <p className="mb-2 flex items-start gap-1.5 rounded-md border border-brand-violet/30 bg-brand-violet/10 px-2.5 py-1.5 text-[0.74rem] text-ink">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-violet" />
          <span>{why}</span>
        </p>
      ) : null}
      <ul className="divide-y divide-hairline">
        {visible.map((item) => {
          const status = productFloorStatus(floors, item);
          const below = status === "below";
          return (
            <li key={item.id} className="flex items-center gap-2 py-1.5">
              <SkuTile name={item.name} size="xs" />
              <span className="min-w-0 flex-1 truncate text-[0.78rem]">
                {item.name}
              </span>
              {byCategory ? (
                <Pill tone="brand">{item.category}</Pill>
              ) : (
                <Pill>{item.vendor}</Pill>
              )}
              <span
                className={cn(
                  "bw-num w-24 shrink-0 text-right text-[0.74rem] font-medium",
                  below && "text-negative",
                )}
              >
                {asMarginPercent
                  ? `${formatMargin(productMargin(item))}${below ? " ↓" : status === "unknown" ? " ?" : ""}`
                  : formatMoney(item.listPrice)}
              </span>
            </li>
          );
        })}
      </ul>
      {caption ? (
        <p className="mt-2 flex items-start gap-1.5 text-[0.72rem] text-ink-muted">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{caption}</span>
        </p>
      ) : null}
    </ToolCard>
  );
}

/**
 * BEAT 3a's card. The figure lives in local state and goes straight to REST; it
 * is never lifted into a tool argument, a respond() string, or the transcript.
 * What the item was originally charged at IS shown, so the merchant can see the
 * ceiling they are working under — the same rule the store enforces, surfaced
 * rather than hidden.
 *
 * Both handlers are contracted to SETTLE the interrupt and resolve — never to
 * throw — returning `null` on success or a sentence this card must show. See
 * `./settle`. The card still wraps them in try/finally: an earlier version awaited
 * `onDone` bare, so one rejected fetch left the button reading "Issuing…" forever
 * with the run wedged behind it and nothing logged anywhere.
 */
export function RefundCard({
  query,
  find,
  productName,
  onDone,
  onCancel,
}: {
  query: string;
  find: (needle: string) => ReturnRequest | undefined;
  productName: (productId: string) => string;
  onDone: (request: ReturnRequest, amount: number) => Promise<string | null>;
  onCancel: () => Promise<string | null>;
}) {
  const request = find(query);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * The single path out of this card. Whatever happens, `saving` comes back down
   * and either the interrupt is settled or the user is told why it is not.
   */
  const run = async (action: () => Promise<string | null>) => {
    setFailure(null);
    setSaving(true);
    try {
      setFailure(await action());
    } catch (error) {
      // Unreachable via the handlers this card is given, which settle and return
      // instead of throwing. Kept so a future edit to a call site cannot put the
      // stuck-spinner bug back: catching here is what guarantees the button
      // recovers no matter what the caller does.
      setFailure(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  const failureNote = failure ? (
    <p
      role="alert"
      className="mt-2 flex items-start gap-1.5 text-[0.72rem] text-negative"
    >
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {failure}
    </p>
  ) : null;

  if (!request) {
    return (
      <ToolCard tone="negative">
        <p className="text-[0.8rem] text-ink-muted">
          I couldn&rsquo;t find a return matching “{query}”.
        </p>
        <button
          type="button"
          disabled={saving}
          onClick={() => void run(onCancel)}
          className="mt-2 rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] disabled:opacity-40"
        >
          Close
        </button>
        {failureNote}
      </ToolCard>
    );
  }

  // The placeholder and the button's rule come out of ONE call, so the figure
  // the card invites is always a figure the card accepts. See `refundGuidance`.
  const {
    placeholder,
    ceiling,
    amount: parsed,
    valid,
  } = refundGuidance(request.itemValue, value);

  return (
    <ToolCard>
      <div className="flex items-center gap-2.5">
        <SkuTile name={productName(request.productId)} size="md" />
        <div className="min-w-0">
          <p className="text-[0.82rem] font-semibold">
            {productName(request.productId)}
          </p>
          <p className="bw-num text-[0.72rem] text-ink-muted">
            {request.customerName} · #{request.orderNumber} ·{" "}
            {RETURN_REASON_LABEL[request.reason]}
          </p>
        </div>
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-[0.7rem] font-medium text-ink-muted">
          Goodwill refund
        </span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          className="bw-num w-full rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-[0.85rem] text-ink outline-none focus:border-brand/50"
        />
        <span className="bw-num mt-1 block text-[0.68rem] text-ink-muted">
          Charged {ceiling} · {ageInDays(request.requestedAt)} days open
        </span>
      </label>

      <p className="mt-2 text-[0.68rem] text-ink-muted">
        This figure goes straight to the payment processor. The assistant never
        sees it.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!valid || saving}
          onClick={() => void run(() => onDone(request, parsed))}
          className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground disabled:opacity-40"
        >
          {saving ? "Issuing…" : "Issue refund"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void run(onCancel)}
          className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
      {failureNote}
    </ToolCard>
  );
}

/**
 * BEAT 6's waiting card. Deliberately NON-DIRECTIONAL: it never lists steps or
 * hints at what to do, because the whole premise is that the agent does not know
 * them. It shows a live "Rec" badge and narrates the steps it observes, so the
 * room can see that watching is really happening.
 *
 * `onDone` settles the interrupt and resolves with `null`, or with a sentence
 * this card shows. Same contract, and same reason, as `RefundCard`: "I'm done"
 * handing off to an unavailable `respond` used to be a silent no-op that stranded
 * the whole teach-mode chain mid-recording.
 */
export function DemonstrationCard({
  onDone,
}: {
  onDone: (summary: string) => Promise<string | null>;
}) {
  const { beginRecording, endRecording, steps, getDemonstratedCode } =
    useRecording();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // No explicit feed reset: the shell's `beginRecording` clears it when it opens
  // a FRESH window, and deliberately inherits the feed when one is already open
  // (the `filed → finalized → approve` chain arriving as brackets microseconds
  // apart must read as one demonstration). An unconditional reset here would
  // blank a live feed mid-demonstration.
  useEffect(() => {
    beginRecording();
    return () => endRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ToolCard>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-negative-soft px-2 py-0.5 text-[0.68rem] font-semibold text-negative">
          <Radio className="h-3 w-3 animate-pulse" />
          Rec
        </span>
        <p className="text-[0.8rem]">Watching — go ahead and show me.</p>
      </div>

      {steps.length > 0 ? (
        <ol className="mt-2.5 space-y-1 border-l-2 border-brand/30 pl-3">
          {steps.map((step, index) => (
            <li key={step.id} className="text-[0.74rem] text-ink">
              <span className="bw-num mr-1.5 text-ink-muted">{index + 1}.</span>
              {step.label}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-[0.72rem] text-ink-muted">
          Nothing captured yet.
        </p>
      )}

      <button
        type="button"
        disabled={sending}
        onClick={async () => {
          // The recorder is the only thing that KNOWS how many steps it caught,
          // so the directive it hands over reports that number — the card that
          // renders the settled result reads it rather than recounting the
          // prose. Both halves live in `./teach-mode-directives`.
          const directive = buildDemonstrationDirective({
            steps: steps.map((s) => s.label),
            code: getDemonstratedCode(),
          });
          setFailure(null);
          setSending(true);
          try {
            setFailure(await onDone(directive));
          } catch (error) {
            setFailure(describeError(error));
          } finally {
            setSending(false);
          }
        }}
        className="mt-3 rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground disabled:opacity-40"
      >
        {sending ? "Saving…" : "I’m done"}
      </button>
      {failure ? (
        <p
          role="alert"
          className="mt-2 flex items-start gap-1.5 text-[0.72rem] text-negative"
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {failure}
        </p>
      ) : null}
    </ToolCard>
  );
}
