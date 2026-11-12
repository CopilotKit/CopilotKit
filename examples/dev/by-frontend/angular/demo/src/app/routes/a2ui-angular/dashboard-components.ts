import { Component, computed, input } from "@angular/core";
import { CopilotGenerativeUIChildren } from "@copilotkit/angular/generative-ui";
import type { GenerativeUIChildren } from "@copilotkit/angular/generative-ui";

type Trend = "up" | "down" | "neutral";
type BadgeVariant = "success" | "warning" | "error" | "info";
interface Bar {
  label: string;
  value: number;
}

/**
 * The dashboard components. The renderer sets one input per prop, with
 * bindings such as `{ "@path": "/revenue" }` already resolved, and a
 * `GenerativeUIChildren` handle for a slot.
 */

/** A card with a title and a subtitle above its child. */
@Component({
  selector: "demo-dashboard-card",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <section class="card">
      <header>
        <h3>{{ title() }}</h3>
        @if (subtitle()) {
          <p>{{ subtitle() }}</p>
        }
      </header>
      <ng-container *copilotGenerativeUIChildren="child()" />
    </section>
  `,
  styles: `
    :host {
      display: contents;
    }
    .card {
      margin: var(--a2ui-spacing-m, 8px);
      padding: var(--a2ui-card-padding, 16px);
      border: 1px solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-border-radius, 8px);
      box-sizing: border-box;
      background: var(--a2ui-color-surface, #fff);
      box-shadow: var(--a2ui-card-shadow, 0 2px 4px rgba(0, 0, 0, 0.1));
    }
    h3 {
      margin: 0;
      font-size: 16px;
    }
    p {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--a2ui-color-muted, #666);
    }
  `,
})
export class DashboardCardComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly child = input<GenerativeUIChildren>();
}

@Component({
  selector: "demo-dashboard-metric",
  template: `
    <div class="metric">
      <span class="label">{{ label() }}</span>
      <strong class="value">{{ value() }}</strong>
      @if (trendValue()) {
        <span class="trend" [class]="trend() ?? 'neutral'">
          {{ arrow() }} {{ trendValue() }}
        </span>
      }
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .metric {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 4px;
      margin: var(--a2ui-spacing-m, 8px);
      padding: var(--a2ui-card-padding, 16px);
      border: 1px solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-border-radius, 8px);
      background: var(--a2ui-color-surface, #fff);
    }
    .label {
      font-size: 12px;
      color: var(--a2ui-color-muted, #666);
    }
    .value {
      font-size: 24px;
    }
    .trend {
      font-size: 12px;
    }
    .up {
      color: #15803d;
    }
    .down {
      color: #b91c1c;
    }
    .neutral {
      color: var(--a2ui-color-muted, #666);
    }
  `,
})
export class MetricComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly trend = input<Trend>();
  readonly trendValue = input<string>();
  protected readonly arrow = computed(() => {
    const trend = this.trend();
    return trend === "up" ? "▲" : trend === "down" ? "▼" : "•";
  });
}

@Component({
  selector: "demo-dashboard-status-badge",
  template: `
    <span class="badge" [class]="variant() ?? 'info'">{{ text() }}</span>
  `,
  styles: `
    :host {
      display: contents;
    }
    .badge {
      align-self: flex-start;
      margin: var(--a2ui-spacing-m, 8px);
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }
    .success {
      background: #dcfce7;
      color: #166534;
    }
    .warning {
      background: #fef3c7;
      color: #92400e;
    }
    .error {
      background: #fee2e2;
      color: #991b1b;
    }
    .info {
      background: #dbeafe;
      color: #1e40af;
    }
  `,
})
export class StatusBadgeComponent {
  readonly text = input.required<string>();
  readonly variant = input<BadgeVariant>();
}

/** A "label: value" row. */
@Component({
  selector: "demo-dashboard-info-row",
  template: `
    <div class="row">
      <span>{{ label() }}</span>
      <strong>{{ value() }}</strong>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .row {
      display: flex;
      justify-content: space-between;
      margin: 0 8px;
      padding: 6px 0;
      border-bottom: 1px solid var(--a2ui-color-border, #eee);
      font-size: 14px;
    }
  `,
})
export class InfoRowComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
}

@Component({
  selector: "demo-dashboard-bar-chart",
  template: `
    <figure class="chart">
      <figcaption>{{ title() }}</figcaption>
      @for (bar of data(); track bar.label) {
        <div class="bar">
          <span class="bar-label">{{ bar.label }}</span>
          <span class="bar-track">
            <span
              class="bar-fill"
              [style.width.%]="(bar.value / max()) * 100"
            ></span>
          </span>
          <span class="bar-value">{{ bar.value }}</span>
        </div>
      }
    </figure>
  `,
  styles: `
    :host {
      display: contents;
    }
    .chart {
      margin: var(--a2ui-spacing-m, 8px);
    }
    figcaption {
      margin-bottom: 8px;
      font-size: 14px;
      font-weight: bold;
    }
    .bar {
      display: grid;
      grid-template-columns: 80px 1fr 32px;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 12px;
    }
    .bar-track {
      height: 10px;
      border-radius: 5px;
      background: var(--a2ui-color-placeholder, #f3f4f6);
    }
    .bar-fill {
      display: block;
      height: 100%;
      border-radius: 5px;
      background: var(--a2ui-color-primary, #007bff);
    }
    .bar-value {
      text-align: right;
    }
  `,
})
export class BarChartComponent {
  readonly title = input.required<string>();
  readonly data = input.required<Bar[]>();
  protected readonly max = computed(() =>
    Math.max(1, ...this.data().map((bar) => bar.value)),
  );
}
