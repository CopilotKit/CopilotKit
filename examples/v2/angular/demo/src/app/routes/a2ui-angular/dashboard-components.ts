import { Component, computed, input } from "@angular/core";
import { CopilotA2UIChild } from "@copilotkit/angular/a2ui";
import type { A2UIProps } from "@copilotkit/angular/a2ui";
import type { dashboardDefinitions } from "./dashboard-catalog";

type Props<K extends keyof typeof dashboardDefinitions> = A2UIProps<
  typeof dashboardDefinitions,
  K
>;

/** Replaces the basic Card: adds a title and subtitle above the child. */
@Component({
  selector: "demo-a2ui-card",
  imports: [CopilotA2UIChild],
  template: `
    <section class="card">
      <header>
        <h3>{{ props().title }}</h3>
        @if (props().subtitle) {
          <p>{{ props().subtitle }}</p>
        }
      </header>
      <copilot-a2ui-child [child]="props().child" />
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
  readonly props = input.required<Props<"Card">>();
}

@Component({
  selector: "demo-a2ui-metric",
  template: `
    <div class="metric">
      <span class="label">{{ props().label }}</span>
      <strong class="value">{{ props().value }}</strong>
      @if (props().trendValue) {
        <span class="trend" [class]="props().trend ?? 'neutral'">
          {{ arrow() }} {{ props().trendValue }}
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
  readonly props = input.required<Props<"Metric">>();
  protected readonly arrow = computed(() => {
    const trend = this.props().trend;
    return trend === "up" ? "▲" : trend === "down" ? "▼" : "•";
  });
}

@Component({
  selector: "demo-a2ui-status-badge",
  template: `
    <span class="badge" [class]="props().variant ?? 'info'">{{
      props().text
    }}</span>
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
  readonly props = input.required<Props<"StatusBadge">>();
}

/** Binds by convention: one input per schema key instead of `props`. */
@Component({
  selector: "demo-a2ui-info-row",
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
  readonly label = input("");
  readonly value = input("");
}

@Component({
  selector: "demo-a2ui-bar-chart",
  template: `
    <figure class="chart">
      <figcaption>{{ props().title }}</figcaption>
      @for (bar of props().data; track bar.label) {
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
  readonly props = input.required<Props<"BarChart">>();
  protected readonly max = computed(() =>
    Math.max(1, ...this.props().data.map((bar) => bar.value)),
  );
}
