import { createCatalog } from "@copilotkit/a2ui-renderer/web-components";
import type { A2UIConfig } from "@copilotkit/angular";
import { html } from "lit";
import { z } from "zod";

const dynamicString = z.union([z.string(), z.object({ path: z.string() })]);
const chartDatum = z.object({ label: z.string(), value: z.number() });

const declarativeDefinitions = {
  Row: {
    props: z.object({
      gap: z.number().optional(),
      align: z.string().optional(),
      justify: z.string().optional(),
      children: z.array(z.string()),
    }),
  },
  Column: {
    props: z.object({
      gap: z.number().optional(),
      align: z.string().optional(),
      children: z.array(z.string()),
    }),
  },
  Text: { props: z.object({ text: z.string() }) },
  Card: {
    props: z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      child: z.string().optional(),
    }),
  },
  StatusBadge: {
    props: z.object({
      text: z.string(),
      variant: z.enum(["success", "warning", "error", "info"]).optional(),
    }),
  },
  Metric: {
    props: z.object({
      label: z.string(),
      value: z.string(),
      trend: z.enum(["up", "down", "neutral"]).optional(),
      trendValue: z.string().optional(),
    }),
  },
  InfoRow: { props: z.object({ label: z.string(), value: z.string() }) },
  DataTable: {
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      rows: z.array(z.record(z.union([z.string(), z.number()]))),
    }),
  },
  PrimaryButton: {
    props: z.object({ label: z.string(), action: z.unknown().optional() }),
  },
  PieChart: {
    props: z.object({
      title: z.string(),
      description: z.string(),
      data: z.array(chartDatum),
    }),
  },
  BarChart: {
    props: z.object({
      title: z.string(),
      description: z.string(),
      data: z.array(chartDatum),
    }),
  },
};

const declarativeCatalog = createCatalog(
  declarativeDefinitions,
  {
    Row: ({ props, children }) => html`
      <div class="a2ui-row" style=${`gap:${props.gap ?? 16}px`}>
        ${props.children.map((id) => children(id))}
      </div>
    `,
    Column: ({ props, children }) => html`
      <div class="a2ui-column" style=${`gap:${props.gap ?? 12}px`}>
        ${props.children.map((id) => children(id))}
      </div>
    `,
    Text: ({ props }) => html`<p class="a2ui-text">${props.text}</p>`,
    Card: ({ props, children }) => html`
      <article data-testid="declarative-card" data-card-id=${props.title}>
        <h3>${props.title}</h3>
        ${props.subtitle ? html`<p>${props.subtitle}</p>` : null}
        ${props.child ? children(props.child) : null}
      </article>
    `,
    StatusBadge: ({ props }) => html`
      <span
        class=${`a2ui-status a2ui-status-${props.variant ?? "info"}`}
        data-testid="declarative-status-badge"
      >
        ${props.text}
      </span>
    `,
    Metric: ({ props }) => html`
      <section data-testid="declarative-metric" class="a2ui-metric">
        <span>${props.label}</span><strong>${props.value}</strong>
        ${props.trendValue ? html`<small>${props.trendValue}</small>` : null}
      </section>
    `,
    InfoRow: ({ props }) => html`
      <div data-testid="declarative-info-row" class="a2ui-info-row">
        <span>${props.label}</span><strong>${props.value}</strong>
      </div>
    `,
    DataTable: ({ props }) => html`
      <div data-testid="declarative-data-table" class="a2ui-table-wrap">
        <table>
          <thead>
            <tr>
              ${props.columns.map((column) => html`<th>${column.label}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${props.rows.map(
              (row) => html`
                <tr>
                  ${props.columns.map(
                    (column) => html`<td>${String(row[column.key] ?? "")}</td>`,
                  )}
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `,
    PrimaryButton: ({ props, dispatch }) => html`
      <button type="button" @click=${() => dispatch?.(props.action)}>
        ${props.label}
      </button>
    `,
    PieChart: ({ props }) => html`
      <article data-testid="declarative-pie-chart" class="a2ui-chart-card">
        <h3>${props.title}</h3>
        <p>${props.description}</p>
        <div class="a2ui-donut" role="img" aria-label=${props.title}></div>
        <ul>
          ${props.data.map(
            (datum) =>
              html`<li>
                <span>${datum.label}</span><strong>${datum.value}</strong>
              </li>`,
          )}
        </ul>
      </article>
    `,
    BarChart: ({ props }) => {
      const max = Math.max(1, ...props.data.map(({ value }) => value));
      return html`
        <article data-testid="declarative-bar-chart" class="a2ui-chart-card">
          <h3>${props.title}</h3>
          <p>${props.description}</p>
          <div class="a2ui-bars" role="img" aria-label=${props.title}>
            ${props.data.map(
              (datum) => html`
                <span title=${`${datum.label}: ${datum.value}`}>
                  <i
                    style=${`height:${Math.max(8, (datum.value / max) * 100)}%`}
                  ></i>
                  <small>${datum.label}</small>
                </span>
              `,
            )}
          </div>
        </article>
      `;
    },
  },
  { catalogId: "declarative-gen-ui-catalog", includeBasicCatalog: true },
);

const fixedDefinitions = {
  Card: { props: z.object({ child: z.string() }) },
  Title: { props: z.object({ text: dynamicString }) },
  Airport: { props: z.object({ code: dynamicString }) },
  Arrow: { props: z.object({}) },
  AirlineBadge: { props: z.object({ name: dynamicString }) },
  PriceTag: { props: z.object({ amount: dynamicString }) },
  Button: {
    props: z.object({
      child: z.string(),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
      action: z.unknown().optional(),
    }),
  },
};

const fixedCatalog = createCatalog(
  fixedDefinitions,
  {
    Card: ({ props, children }) => html`
      <article data-testid="a2ui-fixed-card" class="a2ui-flight-card">
        ${children(props.child)}
      </article>
    `,
    Title: ({ props }) => html`<h3>${resolvedString(props.text)}</h3>`,
    Airport: ({ props }) => html`
      <strong class="a2ui-airport">${resolvedString(props.code)}</strong>
    `,
    Arrow: () =>
      html`
        <span class="a2ui-arrow" aria-hidden="true">→</span>
      `,
    AirlineBadge: ({ props }) => html`
      <span class="a2ui-airline">${resolvedString(props.name)}</span>
    `,
    PriceTag: ({ props }) => html`
      <strong class="a2ui-price">${resolvedString(props.amount)}</strong>
    `,
    Button: ({ props, children, dispatch }) => html`
      <button type="button" @click=${() => dispatch?.(props.action)}>
        ${children(props.child)}
      </button>
    `,
  },
  {
    catalogId: "copilotkit://flight-fixed-catalog",
    includeBasicCatalog: true,
  },
);

const beautifulDefinitions = {
  Title: {
    props: z.object({ text: z.string(), level: z.string().optional() }),
  },
  Row: {
    props: z.object({
      gap: z.number().optional(),
      align: z.string().optional(),
      justify: z.string().optional(),
      children: z.union([
        z.array(z.string()),
        z.object({ componentId: z.string(), path: z.string() }),
      ]),
    }),
  },
  Column: {
    props: z.object({
      gap: z.number().optional(),
      align: z.string().optional(),
      children: z.union([
        z.array(z.string()),
        z.object({ componentId: z.string(), path: z.string() }),
      ]),
    }),
  },
  DashboardCard: {
    props: z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      child: z.string().optional(),
    }),
  },
  Metric: {
    props: z.object({
      label: z.string(),
      value: z.string(),
      trend: z.enum(["up", "down", "neutral"]).optional(),
      trendValue: z.string().optional(),
    }),
  },
  PieChart: {
    props: z.object({
      data: z.array(chartDatum.extend({ color: z.string().optional() })),
      innerRadius: z.number().optional(),
    }),
  },
  BarChart: {
    props: z.object({
      data: z.array(chartDatum),
      color: z.string().optional(),
    }),
  },
  Badge: {
    props: z.object({
      text: z.string(),
      variant: z
        .enum(["success", "warning", "error", "info", "neutral"])
        .optional(),
    }),
  },
  DataTable: {
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      rows: z.array(z.record(z.string(), z.unknown())),
    }),
  },
  Button: {
    props: z.object({
      child: z.string(),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
      action: z.unknown().optional(),
    }),
  },
  FlightCard: {
    props: z.object({
      airline: dynamicString,
      airlineLogo: dynamicString,
      flightNumber: dynamicString,
      origin: dynamicString,
      destination: dynamicString,
      date: dynamicString,
      departureTime: dynamicString,
      arrivalTime: dynamicString,
      duration: dynamicString,
      status: dynamicString,
      statusColor: dynamicString.optional(),
      price: dynamicString,
      action: z.unknown().optional(),
    }),
  },
};

const beautifulCatalog = createCatalog(
  beautifulDefinitions,
  {
    Title: ({ props }) => html`<h2>${props.text}</h2>`,
    Row: ({ props, children }) => html`
      <div
        style=${`display:flex;flex-wrap:wrap;gap:${props.gap ?? 16}px;width:100%`}
      >
        ${
          Array.isArray(props.children)
            ? props.children.map(
                (id) =>
                  html`<div style="flex:1 1 16rem;min-width:0">
                  ${children(id)}
                </div>`,
              )
            : null
        }
      </div>
    `,
    Column: ({ props, children }) => html`
      <div
        style=${`display:flex;flex-direction:column;gap:${props.gap ?? 12}px;width:100%`}
      >
        ${
          Array.isArray(props.children)
            ? props.children.map((id) => children(id))
            : null
        }
      </div>
    `,
    DashboardCard: ({ props, children }) => html`
      <article
        style="padding:1rem;border:1px solid #d8e0ea;border-radius:0.9rem;background:#fff;color:#14213d"
      >
        <h3 style="margin:0">${props.title}</h3>
        ${props.subtitle ? html`<p>${props.subtitle}</p>` : null}
        ${props.child ? children(props.child) : null}
      </article>
    `,
    Metric: ({ props }) => html`
      <section style="display:grid;gap:0.25rem">
        <span>${props.label}</span
        ><strong style="font-size:1.4rem">${props.value}</strong>
        ${props.trendValue ? html`<small>${props.trendValue}</small>` : null}
      </section>
    `,
    PieChart: ({ props }) => html`
      <div role="img" aria-label="Pie chart" style="display:grid;gap:0.4rem">
        ${props.data.map(
          (datum, index) => html`
            <div
              style="display:grid;grid-template-columns:auto 1fr auto;gap:0.4rem"
            >
              <i
                style=${`width:.7rem;height:.7rem;border-radius:50%;background:${datum.color ?? chartColor(index)}`}
              ></i>
              <span>${datum.label}</span><strong>${datum.value}</strong>
            </div>
          `,
        )}
      </div>
    `,
    BarChart: ({ props }) => {
      const max = Math.max(1, ...props.data.map(({ value }) => value));
      return html`
        <div
          role="img"
          aria-label="Bar chart"
          style="display:flex;align-items:end;gap:.5rem;height:12rem"
        >
          ${props.data.map(
            (datum, index) => html`
              <div
                style="display:grid;align-items:end;flex:1;height:100%;text-align:center"
              >
                <i
                  style=${`display:block;height:${Math.max(4, (datum.value / max) * 100)}%;background:${props.color ?? chartColor(index)};border-radius:.35rem .35rem 0 0`}
                ></i>
                <small>${datum.label}</small>
              </div>
            `,
          )}
        </div>
      `;
    },
    Badge: ({ props }) => html`<span>${props.text}</span>`,
    DataTable: ({ props }) => html`
      <table>
        <thead>
          <tr>
            ${props.columns.map((column) => html`<th>${column.label}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${props.rows.map(
            (row) => html`
              <tr>
                ${props.columns.map(
                  (column) => html`<td>${String(row[column.key] ?? "")}</td>`,
                )}
              </tr>
            `,
          )}
        </tbody>
      </table>
    `,
    Button: ({ props, children, dispatch }) => html`
      <button type="button" @click=${() => dispatch?.(props.action)}>
        ${children(props.child)}
      </button>
    `,
    FlightCard: ({ props }) => html`
      <article
        style="display:grid;gap:.7rem;min-width:16rem;padding:1rem;border:1px solid #d8e0ea;border-radius:1rem;background:#fff;color:#14213d"
      >
        <header style="display:flex;justify-content:space-between;gap:1rem">
          <strong>${resolvedString(props.airline)}</strong>
          <strong>${resolvedString(props.price)}</strong>
        </header>
        <div style="display:flex;justify-content:space-between;color:#66758a">
          <span>${resolvedString(props.flightNumber)}</span
          ><span>${resolvedString(props.date)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:700">
          <span>${resolvedString(props.departureTime)}</span>
          <small>${resolvedString(props.duration)}</small>
          <span>${resolvedString(props.arrivalTime)}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <strong>${resolvedString(props.origin)}</strong><span>→</span
          ><strong>${resolvedString(props.destination)}</strong>
        </div>
        <small>${resolvedString(props.status)}</small>
      </article>
    `,
  },
  {
    catalogId: "copilotkit://app-dashboard-catalog",
    includeBasicCatalog: true,
  },
);

/** Select the exact A2UI catalog and recovery behavior for a demo route. */
export function a2uiConfigForFeature(feature: string): A2UIConfig | undefined {
  switch (feature) {
    case "beautiful-chat":
      return { catalog: beautifulCatalog };
    case "declarative-gen-ui":
      return { catalog: declarativeCatalog };
    case "a2ui-recovery":
      return {
        catalog: declarativeCatalog,
        recovery: { showAfterMs: 2_000, showAfterAttempts: 2 },
      };
    case "a2ui-fixed-schema":
      return { catalog: fixedCatalog };
    default:
      return undefined;
  }
}

/** Resolve one stable flagship A2UI chart color. */
function chartColor(index: number): string {
  return ["#4263eb", "#845ef7", "#d6336c", "#f59f00"][index % 4] ?? "#4263eb";
}

function resolvedString(value: string | { path: string }): string {
  return typeof value === "string" ? value : "";
}
