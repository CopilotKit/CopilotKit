"use client";

import type { RendererProps } from "@copilotkit/a2ui-renderer";
import { cn } from "@/lib/utils";
import { MarginLadder } from "../components/margin-ladder";
import { SkuTile } from "../components/sku-tile";
import {
  EmptyState,
  Metric,
  Panel,
  Pill,
  SectionLabel,
} from "../components/primitives";
import {
  ORDER_EXCEPTION_LABEL,
  ageInDays,
  belowFloorCount,
  formatMargin,
  formatMoney,
  noFloorCaveat,
  ordersOnException,
  productMargin,
  productPosition,
  promotionFloorStatus,
  promotionMargin,
  tallyFloorStatus,
  valueAtRisk,
} from "../data/derive";
import type { MarginPosition, Product } from "../data/types";
import { useReportData } from "../report-data";

const GAP = { sm: "gap-2", md: "gap-4", lg: "gap-6", xl: "gap-10" } as const;

// Text props in the catalog are `string | { path }` (a data-bound ref). The A2UI
// runtime resolves refs before render, but the Zod-inferred type still carries
// the union, so coerce to a display string here.
type TextRef = string | { path: string };
const asText = (value: TextRef): string =>
  typeof value === "string" ? value : "";

function Slot({ render }: { render: React.ReactNode }) {
  return <>{render}</>;
}

// --- Layout primitives (mirror banking/logistics/people exactly) ------------

const Stack = ({
  props,
  children,
}: RendererProps<{ children: string[]; gap?: keyof typeof GAP }>) => (
  <div className={cn("flex flex-col", GAP[props.gap ?? "md"])}>
    {props.children?.map((id) => (
      <Slot key={id} render={children(id)} />
    ))}
  </div>
);

const Row = ({
  props,
  children,
}: RendererProps<{ children: string[]; gap?: "sm" | "md" | "lg" }>) => (
  <div className={cn("flex flex-wrap", GAP[props.gap ?? "md"])}>
    {props.children?.map((id) => (
      <Slot key={id} render={children(id)} />
    ))}
  </div>
);

const Grid = ({
  props,
  children,
}: RendererProps<{ children: string[]; columns?: number }>) => (
  <div
    className="grid gap-4"
    style={{
      gridTemplateColumns: `repeat(${props.columns ?? 3}, minmax(0, 1fr))`,
    }}
  >
    {props.children?.map((id) => (
      <Slot key={id} render={children(id)} />
    ))}
  </div>
);

const Section = ({
  props,
  children,
}: RendererProps<{ title: string; child: string }>) => (
  <section className="space-y-3">
    <h2 className="text-lg font-semibold text-ink">{props.title}</h2>
    <Slot render={children(props.child)} />
  </section>
);

const Heading = ({ props }: RendererProps<{ text: TextRef }>) => (
  <h1 className="text-2xl font-semibold tracking-tight text-ink">
    {asText(props.text)}
  </h1>
);

const Text = ({
  props,
}: RendererProps<{ text: TextRef; tone?: "default" | "muted" }>) => (
  <p
    className={cn(
      "text-sm",
      props.tone === "muted" ? "text-ink-muted" : "text-ink",
    )}
  >
    {asText(props.text)}
  </p>
);

// --- Live, data-bound widgets ----------------------------------------------
// Every figure below is computed HERE from useReportData(), never read from a
// prop. The catalog op only ever named the metric/kind; the numbers are the
// ledger's, so the agent can select but never fabricate.

const StatCard = ({
  props,
}: RendererProps<{
  metric:
    | "ordersOnException"
    | "valueAtRisk"
    | "belowFloorSkus"
    | "medianMargin"
    | "pendingMarkdowns";
  label: TextRef;
}>) => {
  const { products, floors, orders, promotions } = useReportData();

  let value = "—";
  let hint: string | null = null;
  let tone: "neutral" | "brand" | "positive" | "negative" | "markdown" =
    "neutral";

  switch (props.metric) {
    case "ordersOnException": {
      const n = ordersOnException(orders).length;
      value = String(n);
      tone = n > 0 ? "negative" : "positive";
      break;
    }
    case "valueAtRisk":
      value = formatMoney(valueAtRisk(orders));
      break;
    case "belowFloorSkus": {
      const n = belowFloorCount(floors, products);
      // Below-floor is the exception the whole skin is about — flag it red when
      // there is anything to act on, quiet green when the range is clean, and an
      // em dash when a missing category floor means it CANNOT be called clean.
      // A green `0` here would be a fabricated all-clear on the canvas.
      value = n === null ? "—" : String(n);
      tone = n === null || n > 0 ? "negative" : "positive";
      hint = noFloorCaveat(tallyFloorStatus(floors, products).unknown);
      break;
    }
    case "medianMargin": {
      const margins = products.map(productMargin).sort((a, b) => a - b);
      if (margins.length) {
        const mid = Math.floor(margins.length / 2);
        const median =
          margins.length % 2 === 0
            ? (margins[mid - 1] + margins[mid]) / 2
            : margins[mid];
        value = formatMargin(median);
      }
      tone = "brand";
      break;
    }
    case "pendingMarkdowns":
      value = String(promotions.filter((p) => p.status === "pending").length);
      tone = "markdown";
      break;
  }

  return (
    <Metric
      label={asText(props.label)}
      value={value}
      hint={hint ?? undefined}
      tone={tone}
    />
  );
};

const CategoryBreakdown = () => {
  const { products, floors } = useReportData();
  if (!products.length || !floors.length) {
    return (
      <Panel>
        <EmptyState
          title="No range to plot"
          hint="Once the ledger loads, every product appears on the margin ladder against its own category floor."
        />
      </Panel>
    );
  }
  return (
    <Panel>
      <SectionLabel>Category breakdown</SectionLabel>
      <MarginLadder floors={floors} products={products} />
    </Panel>
  );
};

function BelowFloorList() {
  const { products, floors } = useReportData();
  // Carry each row's POSITION rather than re-finding its floor below: a row is
  // only in this list because it has a floor, so the floor comes back non-null
  // and there is no lookup left to default. (It used to end `?? 0`, which would
  // have printed a nonsense "−45pt under" out of a missing floor.)
  const rows = products
    .map((item) => ({ item, position: productPosition(floors, item) }))
    .filter(
      (row): row is { item: Product; position: MarginPosition } =>
        row.position !== null && row.position.belowFloor,
    );
  const caveat = noFloorCaveat(tallyFloorStatus(floors, products).unknown);
  if (!rows.length) {
    return (
      <Panel>
        <SectionLabel>Below floor</SectionLabel>
        {/* Only ever an all-clear when the whole range was actually checked. */}
        <EmptyState
          title={
            caveat
              ? "The range could not be fully checked"
              : "Every product is above its floor"
          }
          hint={
            caveat
              ? `${caveat}. No SKU with a floor on file is trading under it.`
              : "No SKU is trading under its category minimum — there is nothing to escalate at the review."
          }
        />
      </Panel>
    );
  }
  return (
    <Panel>
      <SectionLabel>Below floor</SectionLabel>
      {caveat ? (
        <p className="mb-2 text-[0.72rem] text-negative">{caveat}.</p>
      ) : null}
      <ul className="divide-y divide-hairline">
        {rows.map(({ item, position }) => {
          const margin = productMargin(item);
          const { floor } = position;
          return (
            <li
              key={item.id}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <SkuTile name={item.name} size="sm" ring="negative" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">
                  {item.name}
                </div>
                <div className="bw-num truncate text-[0.72rem] text-ink-muted">
                  {item.sku} · {item.category}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="bw-num text-sm font-semibold text-ink">
                  {formatMargin(margin)}
                </span>
                <Pill tone="negative">
                  {formatMargin(floor - margin).replace("%", "")}pt under
                </Pill>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ExceptionOrdersList() {
  const { orders } = useReportData();
  const rows = ordersOnException(orders);
  if (!rows.length) {
    return (
      <Panel>
        <SectionLabel>Orders on exception</SectionLabel>
        <EmptyState
          title="The queue is clear"
          hint="No order is waiting on a decision — the review can skip the exception queue."
        />
      </Panel>
    );
  }
  return (
    <Panel>
      <SectionLabel>Orders on exception</SectionLabel>
      <ul className="divide-y divide-hairline">
        {[...rows]
          .sort((a, b) => a.placedAt.localeCompare(b.placedAt))
          .map((order) => {
            const age = ageInDays(order.placedAt);
            return (
              <li
                key={order.id}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <SkuTile
                  name={order.customerName}
                  size="sm"
                  shape="round"
                  ring="negative"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="bw-num shrink-0 text-[0.72rem] text-ink-muted">
                      #{order.number}
                    </span>
                    <span className="truncate text-sm font-medium text-ink">
                      {order.customerName}
                    </span>
                    <Pill tone="negative">
                      {ORDER_EXCEPTION_LABEL[order.exception]}
                    </Pill>
                  </div>
                  <div className="truncate text-[0.72rem] text-ink-muted">
                    {order.destination}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className="bw-num text-sm font-semibold text-ink">
                    {formatMoney(order.total)}
                  </span>
                  <span className="bw-num text-[0.68rem] text-ink-muted">
                    {age === 0 ? "today" : `${age}d ago`}
                  </span>
                </div>
              </li>
            );
          })}
      </ul>
    </Panel>
  );
}

function PendingMarkdownsList() {
  const { promotions, products, floors } = useReportData();
  const rows = promotions.filter((p) => p.status === "pending");
  if (!rows.length) {
    return (
      <Panel>
        <SectionLabel>Markdowns pending</SectionLabel>
        <EmptyState
          title="Nothing waiting on a decision"
          hint="Every markdown the desk has raised has been approved or declined."
        />
      </Panel>
    );
  }
  return (
    <Panel>
      <SectionLabel>Markdowns pending</SectionLabel>
      <ul className="divide-y divide-hairline">
        {rows.map((promotion) => {
          const item = products.find((p) => p.id === promotion.productId);
          const floor =
            floors.find((f) => f.category === item?.category)?.floor ?? null;
          const margin = promotionMargin(item, promotion);
          // Tri-state, so a markdown whose floor is missing is not painted as a
          // healthy one: `unknown` keeps the markdown ring and the neutral ink.
          //
          // The MARGIN still prints — it is a real, computed figure, and blanking
          // it would throw away a fact the ledger does have. What must not happen
          // is the FLOOR line going quiet: this comment used to claim both figures
          // rendered as em dashes while the code printed a real margin beside a
          // bare `floor —`, which reads as "nothing to report" rather than "never
          // checked". The line below says which it is, the way the catalog's own
          // row does ("· no floor").
          const status = promotionFloorStatus(floors, item, promotion);
          const below = status === "below";
          return (
            <li
              key={promotion.id}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <SkuTile
                name={item?.name ?? promotion.name}
                size="sm"
                ring={below ? "negative" : "markdown"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {promotion.name}
                  </span>
                  <Pill tone="markdown">−{promotion.discountPercent}%</Pill>
                </div>
                <div className="truncate text-[0.72rem] text-ink-muted">
                  {item?.name ?? "Unknown product"} · {item?.category ?? "—"}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end">
                <span
                  className={cn(
                    "bw-num text-sm font-semibold",
                    below ? "text-negative" : "text-ink",
                  )}
                >
                  {margin === null ? "—" : formatMargin(margin)}
                </span>
                <span className="bw-num text-[0.68rem] text-ink-muted">
                  {floor === null
                    ? "no floor on file"
                    : `floor ${formatMargin(floor)}`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const TradingList = ({
  props,
}: RendererProps<{
  kind: "belowFloor" | "exceptionOrders" | "pendingMarkdowns";
}>) => {
  if (props.kind === "belowFloor") return <BelowFloorList />;
  if (props.kind === "exceptionOrders") return <ExceptionOrdersList />;
  return <PendingMarkdownsList />;
};

export const renderers = {
  Stack,
  Row,
  Grid,
  Section,
  Heading,
  Text,
  StatCard,
  CategoryBreakdown,
  TradingList,
};
