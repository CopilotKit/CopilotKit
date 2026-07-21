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
            <tr>${props.columns.map((column) => html`<th>${column.label}</th>`)}</tr>
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
        <h3>${props.title}</h3><p>${props.description}</p>
        <div class="a2ui-donut" role="img" aria-label=${props.title}></div>
        <ul>
          ${props.data.map(
            (datum) =>
              html`<li><span>${datum.label}</span><strong>${datum.value}</strong></li>`,
          )}
        </ul>
      </article>
    `,
    BarChart: ({ props }) => {
      const max = Math.max(1, ...props.data.map(({ value }) => value));
      return html`
        <article data-testid="declarative-bar-chart" class="a2ui-chart-card">
          <h3>${props.title}</h3><p>${props.description}</p>
          <div class="a2ui-bars" role="img" aria-label=${props.title}>
            ${props.data.map(
              (datum) => html`
                <span title=${`${datum.label}: ${datum.value}`}>
                  <i style=${`height:${Math.max(8, (datum.value / max) * 100)}%`}></i>
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

/** Select the exact A2UI catalog and recovery behavior for a demo route. */
export function a2uiConfigForFeature(feature: string): A2UIConfig | undefined {
  switch (feature) {
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

function resolvedString(value: string | { path: string }): string {
  return typeof value === "string" ? value : "";
}
