import { Component, computed, input, signal } from "@angular/core";
import { CopilotGenerativeUIChildren } from "@copilotkit/angular/generative-ui";
import type { GenerativeUIChildren } from "@copilotkit/angular/generative-ui";

import { a2uiHost as host } from "./a2ui-host";

type ChartDatum = { label: string; value: number };
type TableColumn = { key: string; label: string };

@Component({
  selector: "showcase-a2ui-dashboard-title",
  host,
  template: ` <h2>{{ text() }}</h2> `,
})
export class BeautifulTitleComponent {
  readonly text = input.required<string>();
  readonly level = input<string>();
}

@Component({
  selector: "showcase-a2ui-dashboard-row",
  imports: [CopilotGenerativeUIChildren],
  host,
  template: `
    <div class="beautiful-row" [style.gap.px]="gap() ?? 16">
      <ng-container *copilotGenerativeUIChildren="children()" />
    </div>
  `,
})
export class BeautifulRowComponent {
  readonly gap = input<number>();
  readonly align = input<string>();
  readonly justify = input<string>();
  readonly children = input<GenerativeUIChildren>();
}

@Component({
  selector: "showcase-a2ui-dashboard-column",
  imports: [CopilotGenerativeUIChildren],
  host,
  template: `
    <div class="beautiful-column" [style.gap.px]="gap() ?? 12">
      <ng-container *copilotGenerativeUIChildren="children()" />
    </div>
  `,
})
export class BeautifulColumnComponent {
  readonly gap = input<number>();
  readonly align = input<string>();
  readonly children = input<GenerativeUIChildren>();
}

@Component({
  selector: "showcase-a2ui-dashboard-card",
  imports: [CopilotGenerativeUIChildren],
  host,
  template: `
    <article class="beautiful-card">
      <h3>{{ title() }}</h3>
      @if (subtitle()) {
        <p>{{ subtitle() }}</p>
      }
      <ng-container *copilotGenerativeUIChildren="child()" />
    </article>
  `,
})
export class BeautifulDashboardCardComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly child = input<GenerativeUIChildren>();
}

@Component({
  selector: "showcase-a2ui-dashboard-metric",
  host,
  template: `
    <section class="beautiful-metric">
      <span>{{ label() }}</span
      ><strong>{{ value() }}</strong>
      @if (trendValue()) {
        <small>{{ trendValue() }}</small>
      }
    </section>
  `,
})
export class BeautifulMetricComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly trend = input<"up" | "down" | "neutral">();
  readonly trendValue = input<string>();
}

@Component({
  selector: "showcase-a2ui-dashboard-pie-chart",
  host,
  template: `
    <div class="beautiful-pie" role="img" aria-label="Pie chart">
      @for (datum of data(); track $index) {
        <div>
          <i [style.background]="datum.color ?? colorAt($index)"></i>
          <span>{{ datum.label }}</span
          ><strong>{{ datum.value }}</strong>
        </div>
      }
    </div>
  `,
})
export class BeautifulPieChartComponent {
  readonly data = input.required<(ChartDatum & { color?: string })[]>();
  readonly innerRadius = input<number>();
  protected readonly colorAt = colorAt;
}

@Component({
  selector: "showcase-a2ui-dashboard-bar-chart",
  host,
  template: `
    <div class="beautiful-bars" role="img" aria-label="Bar chart">
      @for (datum of data(); track $index) {
        <div>
          <i
            [style.height.%]="barHeight(datum.value)"
            [style.background]="color() ?? colorAt($index)"
          ></i>
          <small>{{ datum.label }}</small>
        </div>
      }
    </div>
  `,
})
export class BeautifulBarChartComponent {
  readonly data = input.required<ChartDatum[]>();
  readonly color = input<string>();
  protected readonly colorAt = colorAt;
  private readonly max = computed(() =>
    Math.max(1, ...this.data().map(({ value }) => value)),
  );
  protected barHeight(value: number): number {
    return Math.max(4, (value / this.max()) * 100);
  }
}

@Component({
  selector: "showcase-a2ui-dashboard-badge",
  host,
  template: ` <span>{{ text() }}</span> `,
})
export class BeautifulBadgeComponent {
  readonly text = input.required<string>();
  readonly variant = input<
    "success" | "warning" | "error" | "info" | "neutral"
  >();
}

@Component({
  selector: "showcase-a2ui-dashboard-data-table",
  host,
  template: `
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
  `,
})
export class BeautifulDataTableComponent {
  readonly columns = input.required<TableColumn[]>();
  readonly rows = input.required<Record<string, unknown>[]>();
}

@Component({
  selector: "showcase-a2ui-dashboard-button",
  imports: [CopilotGenerativeUIChildren],
  host,
  template: `
    <button
      type="button"
      class="a2ui-action-button"
      [class.done]="done()"
      [disabled]="done()"
      (click)="confirm()"
    >
      @if (done()) {
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Done
      } @else {
        <ng-container *copilotGenerativeUIChildren="child()" />
      }
    </button>
  `,
})
export class BeautifulButtonComponent {
  readonly child = input<GenerativeUIChildren>();
  readonly variant = input<"primary" | "secondary" | "ghost">();
  /** Set when the agent binds an action to the button. */
  readonly onClick = input<() => unknown>();
  protected readonly done = signal(false);

  protected confirm(): void {
    void this.onClick()?.();
    this.done.set(true);
  }
}

@Component({
  selector: "showcase-a2ui-dashboard-flight-card",
  host,
  template: `
    <article class="beautiful-flight">
      <header>
        <strong>{{ airline() }}</strong>
        <strong>{{ price() }}</strong>
      </header>
      <div class="beautiful-flight-meta">
        <span>{{ flightNumber() }}</span
        ><span>{{ date() }}</span>
      </div>
      <div class="beautiful-flight-times">
        <span>{{ departureTime() }}</span>
        <small>{{ duration() }}</small>
        <span>{{ arrivalTime() }}</span>
      </div>
      <div class="beautiful-flight-route">
        <strong>{{ origin() }}</strong
        ><span>→</span><strong>{{ destination() }}</strong>
      </div>
      <small>{{ status() }}</small>
    </article>
  `,
})
export class BeautifulFlightCardComponent {
  readonly airline = input.required<string>();
  readonly airlineLogo = input.required<string>();
  readonly flightNumber = input.required<string>();
  readonly origin = input.required<string>();
  readonly destination = input.required<string>();
  readonly date = input.required<string>();
  readonly departureTime = input.required<string>();
  readonly arrivalTime = input.required<string>();
  readonly duration = input.required<string>();
  readonly status = input.required<string>();
  readonly statusColor = input<string>();
  readonly price = input.required<string>();
  /** Set when the agent binds an action to the card. */
  readonly action = input<() => unknown>();
}

/** The showcase chart palette, cycling by index. */
function colorAt(index: number): string {
  const colors = ["#4263eb", "#845ef7", "#d6336c", "#f59f00", "#0ca678"];
  return colors[index % colors.length];
}
