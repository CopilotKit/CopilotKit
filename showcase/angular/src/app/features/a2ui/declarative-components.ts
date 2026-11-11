import { Component, computed, input } from "@angular/core";
import { CopilotGenerativeUIChildren } from "@copilotkit/angular/generative-ui";
import type { GenerativeUIChildren } from "@copilotkit/angular/generative-ui";

import { a2uiHost as host } from "./a2ui-host";

type Align = "start" | "center" | "end" | "stretch" | "baseline";
type ChartDatum = { label: string; value: number };
type TableColumn = { key: string; label: string };

@Component({
  selector: "showcase-a2ui-row",
  imports: [CopilotGenerativeUIChildren],
  host,
  template: `
    <div class="a2ui-row" [style.gap.px]="gap() ?? 16">
      <ng-container *copilotGenerativeUIChildren="children()" />
    </div>
  `,
})
export class DeclarativeRowComponent {
  readonly gap = input<number>();
  readonly align = input<Align>();
  readonly justify = input<"start" | "center" | "end" | "spaceBetween">();
  readonly children = input<GenerativeUIChildren>();
}

@Component({
  selector: "showcase-a2ui-column",
  imports: [CopilotGenerativeUIChildren],
  host,
  template: `
    <div class="a2ui-column" [style.gap.px]="gap() ?? 12">
      <ng-container *copilotGenerativeUIChildren="children()" />
    </div>
  `,
})
export class DeclarativeColumnComponent {
  readonly gap = input<number>();
  readonly align = input<Align>();
  readonly children = input<GenerativeUIChildren>();
}

@Component({
  selector: "showcase-a2ui-text",
  host,
  template: ` <p class="a2ui-text">{{ text() }}</p> `,
})
export class DeclarativeTextComponent {
  readonly text = input.required<string>();
}

@Component({
  selector: "showcase-a2ui-card",
  imports: [CopilotGenerativeUIChildren],
  host,
  template: `
    <article data-testid="declarative-card" [attr.data-card-id]="title()">
      <h3>{{ title() }}</h3>
      @if (subtitle()) {
        <p>{{ subtitle() }}</p>
      }
      <ng-container *copilotGenerativeUIChildren="child()" />
    </article>
  `,
})
export class DeclarativeCardComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly child = input<GenerativeUIChildren>();
}

@Component({
  selector: "showcase-a2ui-status-badge",
  host,
  template: `
    <span
      [class]="'a2ui-status a2ui-status-' + (variant() ?? 'info')"
      data-testid="declarative-status-badge"
    >
      {{ text() }}
    </span>
  `,
})
export class DeclarativeStatusBadgeComponent {
  readonly text = input.required<string>();
  readonly variant = input<"success" | "warning" | "error" | "info">();
}

@Component({
  selector: "showcase-a2ui-metric",
  host,
  template: `
    <section data-testid="declarative-metric" class="a2ui-metric">
      <span>{{ label() }}</span
      ><strong>{{ value() }}</strong>
      @if (trendValue()) {
        <small>{{ trendValue() }}</small>
      }
    </section>
  `,
})
export class DeclarativeMetricComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly trend = input<"up" | "down" | "neutral">();
  readonly trendValue = input<string>();
}

@Component({
  selector: "showcase-a2ui-info-row",
  host,
  template: `
    <div data-testid="declarative-info-row" class="a2ui-info-row">
      <span>{{ label() }}</span
      ><strong>{{ value() }}</strong>
    </div>
  `,
})
export class DeclarativeInfoRowComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
}

@Component({
  selector: "showcase-a2ui-data-table",
  host,
  template: `
    <div data-testid="declarative-data-table" class="a2ui-table-wrap">
      <table>
        <thead>
          <tr>
            @for (column of columns(); track $index) {
              <th>{{ column.label }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track $index) {
            <tr>
              @for (column of columns(); track $index) {
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
  readonly columns = input.required<TableColumn[]>();
  readonly rows = input.required<Record<string, string | number>[]>();
}

@Component({
  selector: "showcase-a2ui-primary-button",
  host,
  template: `
    <button type="button" (click)="action()?.()">
      {{ label() }}
    </button>
  `,
})
export class DeclarativePrimaryButtonComponent {
  readonly label = input.required<string>();
  /** Set when the agent binds an action to the button. */
  readonly action = input<() => unknown>();
}

@Component({
  selector: "showcase-a2ui-pie-chart",
  host,
  template: `
    <article data-testid="declarative-pie-chart" class="a2ui-chart-card">
      <h3>{{ title() }}</h3>
      <p>{{ description() }}</p>
      <div class="a2ui-donut" role="img" [attr.aria-label]="title()"></div>
      <ul>
        @for (datum of data(); track $index) {
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
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly data = input.required<ChartDatum[]>();
}

@Component({
  selector: "showcase-a2ui-bar-chart",
  host,
  template: `
    <article data-testid="declarative-bar-chart" class="a2ui-chart-card">
      <h3>{{ title() }}</h3>
      <p>{{ description() }}</p>
      <div class="a2ui-bars" role="img" [attr.aria-label]="title()">
        @for (datum of data(); track $index) {
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
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly data = input.required<ChartDatum[]>();
  private readonly max = computed(() =>
    Math.max(1, ...this.data().map(({ value }) => value)),
  );
  protected barHeight(value: number): number {
    return Math.max(8, (value / this.max()) * 100);
  }
}
