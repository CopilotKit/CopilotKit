import { Component, computed, input, signal } from "@angular/core";
import type { A2UIProps } from "@copilotkit/angular/a2ui";
import {
  CopilotA2UIChild,
  injectA2UIComponentContext,
} from "@copilotkit/angular/a2ui";

import type { beautifulDefinitions } from "./a2ui-definitions";
import { a2uiHost as host } from "./a2ui-host";

type Props<K extends keyof typeof beautifulDefinitions> = A2UIProps<
  typeof beautifulDefinitions,
  K
>;

@Component({
  selector: "showcase-a2ui-dashboard-title",
  host,
  template: `
    <h2>{{ props().text }}</h2>
  `,
})
export class BeautifulTitleComponent {
  readonly props = input.required<Props<"Title">>();
}

@Component({
  selector: "showcase-a2ui-dashboard-row",
  imports: [CopilotA2UIChild],
  host,
  template: `
    <div class="beautiful-row" [style.gap.px]="props().gap ?? 16">
      @for (child of props().children; track $index) {
        <div><copilot-a2ui-child [child]="child" /></div>
      }
    </div>
  `,
})
export class BeautifulRowComponent {
  readonly props = input.required<Props<"Row">>();
}

@Component({
  selector: "showcase-a2ui-dashboard-column",
  imports: [CopilotA2UIChild],
  host,
  template: `
    <div class="beautiful-column" [style.gap.px]="props().gap ?? 12">
      @for (child of props().children; track $index) {
        <copilot-a2ui-child [child]="child" />
      }
    </div>
  `,
})
export class BeautifulColumnComponent {
  readonly props = input.required<Props<"Column">>();
}

@Component({
  selector: "showcase-a2ui-dashboard-card",
  imports: [CopilotA2UIChild],
  host,
  template: `
    <article class="beautiful-card">
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
export class BeautifulDashboardCardComponent {
  readonly props = input.required<Props<"DashboardCard">>();
}

@Component({
  selector: "showcase-a2ui-dashboard-metric",
  host,
  template: `
    <section class="beautiful-metric">
      <span>{{ props().label }}</span
      ><strong>{{ props().value }}</strong>
      @if (props().trendValue) {
        <small>{{ props().trendValue }}</small>
      }
    </section>
  `,
})
export class BeautifulMetricComponent {
  readonly props = input.required<Props<"Metric">>();
}

@Component({
  selector: "showcase-a2ui-dashboard-pie-chart",
  host,
  template: `
    <div class="beautiful-pie" role="img" aria-label="Pie chart">
      @for (datum of props().data; track $index) {
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
  readonly props = input.required<Props<"PieChart">>();
  protected readonly colorAt = colorAt;
}

@Component({
  selector: "showcase-a2ui-dashboard-bar-chart",
  host,
  template: `
    <div class="beautiful-bars" role="img" aria-label="Bar chart">
      @for (datum of props().data; track $index) {
        <div>
          <i
            [style.height.%]="barHeight(datum.value)"
            [style.background]="props().color ?? colorAt($index)"
          ></i>
          <small>{{ datum.label }}</small>
        </div>
      }
    </div>
  `,
})
export class BeautifulBarChartComponent {
  readonly props = input.required<Props<"BarChart">>();
  protected readonly colorAt = colorAt;
  private readonly max = computed(() =>
    Math.max(1, ...this.props().data.map(({ value }) => value)),
  );
  protected barHeight(value: number): number {
    return Math.max(4, (value / this.max()) * 100);
  }
}

@Component({
  selector: "showcase-a2ui-dashboard-badge",
  host,
  template: `
    <span>{{ props().text }}</span>
  `,
})
export class BeautifulBadgeComponent {
  readonly props = input.required<Props<"Badge">>();
}

@Component({
  selector: "showcase-a2ui-dashboard-data-table",
  host,
  template: `
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
  `,
})
export class BeautifulDataTableComponent {
  readonly props = input.required<Props<"DataTable">>();
}

@Component({
  selector: "showcase-a2ui-dashboard-button",
  imports: [CopilotA2UIChild],
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
        <copilot-a2ui-child [child]="props().child" />
      }
    </button>
  `,
})
export class BeautifulButtonComponent {
  readonly props = input.required<Props<"Button">>();
  protected readonly context = injectA2UIComponentContext();
  protected readonly done = signal(false);

  protected confirm(): void {
    void this.context.dispatch(this.props().action);
    this.done.set(true);
  }
}

@Component({
  selector: "showcase-a2ui-dashboard-flight-card",
  host,
  template: `
    <article class="beautiful-flight">
      <header>
        <strong>{{ props().airline }}</strong>
        <strong>{{ props().price }}</strong>
      </header>
      <div class="beautiful-flight-meta">
        <span>{{ props().flightNumber }}</span
        ><span>{{ props().date }}</span>
      </div>
      <div class="beautiful-flight-times">
        <span>{{ props().departureTime }}</span>
        <small>{{ props().duration }}</small>
        <span>{{ props().arrivalTime }}</span>
      </div>
      <div class="beautiful-flight-route">
        <strong>{{ props().origin }}</strong
        ><span>→</span><strong>{{ props().destination }}</strong>
      </div>
      <small>{{ props().status }}</small>
    </article>
  `,
})
export class BeautifulFlightCardComponent {
  readonly props = input.required<Props<"FlightCard">>();
}

/** The showcase chart palette, cycling by index. */
function colorAt(index: number): string {
  const colors = ["#4263eb", "#845ef7", "#d6336c", "#f59f00", "#0ca678"];
  return colors[index % colors.length];
}
