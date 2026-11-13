import { Component, computed, input } from "@angular/core";
import type { A2UIProps } from "@copilotkit/angular/a2ui";
import {
  CopilotA2UIChild,
  injectA2UIComponentContext,
} from "@copilotkit/angular/a2ui";

import type { declarativeDefinitions } from "./a2ui-definitions";
import { a2uiHost as host } from "./a2ui-host";

type Props<K extends keyof typeof declarativeDefinitions> = A2UIProps<
  typeof declarativeDefinitions,
  K
>;

@Component({
  selector: "showcase-a2ui-row",
  imports: [CopilotA2UIChild],
  host,
  template: `
    <div class="a2ui-row" [style.gap.px]="props().gap ?? 16">
      @for (child of props().children; track $index) {
        <copilot-a2ui-child [child]="child" />
      }
    </div>
  `,
})
export class DeclarativeRowComponent {
  readonly props = input.required<Props<"Row">>();
}

@Component({
  selector: "showcase-a2ui-column",
  imports: [CopilotA2UIChild],
  host,
  template: `
    <div class="a2ui-column" [style.gap.px]="props().gap ?? 12">
      @for (child of props().children; track $index) {
        <copilot-a2ui-child [child]="child" />
      }
    </div>
  `,
})
export class DeclarativeColumnComponent {
  readonly props = input.required<Props<"Column">>();
}

@Component({
  selector: "showcase-a2ui-text",
  host,
  template: `
    <p class="a2ui-text">{{ props().text }}</p>
  `,
})
export class DeclarativeTextComponent {
  readonly props = input.required<Props<"Text">>();
}

@Component({
  selector: "showcase-a2ui-card",
  imports: [CopilotA2UIChild],
  host,
  template: `
    <article data-testid="declarative-card" [attr.data-card-id]="props().title">
      <h3>{{ props().title }}</h3>
      @if (props().subtitle) {
        <p>{{ props().subtitle }}</p>
      }
      @if (props().child) {
        <copilot-a2ui-child [child]="props().child" />
      }
    </article>
  `,
})
export class DeclarativeCardComponent {
  readonly props = input.required<Props<"Card">>();
}

@Component({
  selector: "showcase-a2ui-status-badge",
  host,
  template: `
    <span
      [class]="'a2ui-status a2ui-status-' + (props().variant ?? 'info')"
      data-testid="declarative-status-badge"
    >
      {{ props().text }}
    </span>
  `,
})
export class DeclarativeStatusBadgeComponent {
  readonly props = input.required<Props<"StatusBadge">>();
}

@Component({
  selector: "showcase-a2ui-metric",
  host,
  template: `
    <section data-testid="declarative-metric" class="a2ui-metric">
      <span>{{ props().label }}</span
      ><strong>{{ props().value }}</strong>
      @if (props().trendValue) {
        <small>{{ props().trendValue }}</small>
      }
    </section>
  `,
})
export class DeclarativeMetricComponent {
  readonly props = input.required<Props<"Metric">>();
}

@Component({
  selector: "showcase-a2ui-info-row",
  host,
  template: `
    <div data-testid="declarative-info-row" class="a2ui-info-row">
      <span>{{ props().label }}</span
      ><strong>{{ props().value }}</strong>
    </div>
  `,
})
export class DeclarativeInfoRowComponent {
  readonly props = input.required<Props<"InfoRow">>();
}

@Component({
  selector: "showcase-a2ui-data-table",
  host,
  template: `
    <div data-testid="declarative-data-table" class="a2ui-table-wrap">
      <table>
        <thead>
          <tr>
            @for (column of props().columns; track $index) {
              <th>{{ column.label }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of props().rows; track $index) {
            <tr>
              @for (column of props().columns; track $index) {
                <td>{{ row[column.key] }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class DeclarativeDataTableComponent {
  readonly props = input.required<Props<"DataTable">>();
}

@Component({
  selector: "showcase-a2ui-primary-button",
  host,
  template: `
    <button type="button" (click)="context.dispatch(props().action)">
      {{ props().label }}
    </button>
  `,
})
export class DeclarativePrimaryButtonComponent {
  readonly props = input.required<Props<"PrimaryButton">>();
  protected readonly context = injectA2UIComponentContext();
}

@Component({
  selector: "showcase-a2ui-pie-chart",
  host,
  template: `
    <article data-testid="declarative-pie-chart" class="a2ui-chart-card">
      <h3>{{ props().title }}</h3>
      <p>{{ props().description }}</p>
      <div class="a2ui-donut" role="img" [attr.aria-label]="props().title"></div>
      <ul>
        @for (datum of props().data; track $index) {
          <li>
            <span>{{ datum.label }}</span
            ><strong>{{ datum.value }}</strong>
          </li>
        }
      </ul>
    </article>
  `,
})
export class DeclarativePieChartComponent {
  readonly props = input.required<Props<"PieChart">>();
}

@Component({
  selector: "showcase-a2ui-bar-chart",
  host,
  template: `
    <article data-testid="declarative-bar-chart" class="a2ui-chart-card">
      <h3>{{ props().title }}</h3>
      <p>{{ props().description }}</p>
      <div class="a2ui-bars" role="img" [attr.aria-label]="props().title">
        @for (datum of props().data; track $index) {
          <span [title]="datum.label + ': ' + datum.value">
            <i [style.height.%]="barHeight(datum.value)"></i>
            <small>{{ datum.label }}</small>
          </span>
        }
      </div>
    </article>
  `,
})
export class DeclarativeBarChartComponent {
  readonly props = input.required<Props<"BarChart">>();
  private readonly max = computed(() =>
    Math.max(1, ...this.props().data.map(({ value }) => value)),
  );
  protected barHeight(value: number): number {
    return Math.max(8, (value / this.max()) * 100);
  }
}
