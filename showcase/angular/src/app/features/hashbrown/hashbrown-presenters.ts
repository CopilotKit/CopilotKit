import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";

interface ChartDatum {
  label: string;
  value: number;
}

@Component({
  selector: "showcase-hashbrown-metric",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "hashbrown-card hashbrown-metric" },
  template: `
    <section data-testid="metric-card" [attr.aria-label]="label()">
      <p class="hashbrown-eyebrow">{{ label() }}</p>
      <strong>{{ value() }}</strong>
      @if (trend(); as currentTrend) {
        <p data-testid="metric-trend">{{ currentTrend }}</p>
      }
    </section>
  `,
})
export class HashbrownMetricCard {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly trend = input<string | undefined>();
}

@Component({
  selector: "showcase-hashbrown-pie-chart",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "hashbrown-card hashbrown-chart" },
  template: `
    <section data-testid="pie-chart" [attr.aria-label]="title()">
      <h3>{{ title() }}</h3>
      @if (chartData(); as slices) {
        <ul>
          @for (slice of slices; track slice.label) {
            <li>
              <span>{{ slice.label }}</span>
              <strong>{{ slice.value.toLocaleString() }}</strong>
            </li>
          }
        </ul>
      } @else {
        <p role="status">Chart data is still arriving.</p>
      }
    </section>
  `,
})
export class HashbrownPieChart {
  readonly title = input.required<string>();
  readonly data = input.required<string>();
  protected readonly chartData = computed(() => parseChartData(this.data()));
}

@Component({
  selector: "showcase-hashbrown-bar-chart",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "hashbrown-card hashbrown-chart" },
  template: `
    <section data-testid="bar-chart" [attr.aria-label]="title()">
      <h3>{{ title() }}</h3>
      @if (chartData(); as bars) {
        <ul>
          @for (bar of bars; track bar.label) {
            <li>
              <span>{{ bar.label }}</span>
              <span
                class="hashbrown-bar"
                [style.--bar-size]="barWidth(bar.value)"
                aria-hidden="true"
              ></span>
              <strong>{{ bar.value.toLocaleString() }}</strong>
            </li>
          }
        </ul>
      } @else {
        <p role="status">Chart data is still arriving.</p>
      }
    </section>
  `,
})
export class HashbrownBarChart {
  readonly title = input.required<string>();
  readonly data = input.required<string>();
  protected readonly chartData = computed(() => parseChartData(this.data()));
  private readonly maximum = computed(() =>
    Math.max(...(this.chartData()?.map((datum) => datum.value) ?? [1])),
  );

  /** Return a bounded visual percentage while the numeric value remains in text. */
  protected barWidth(value: number): string {
    return `${Math.max(4, Math.round((value / this.maximum()) * 100))}%`;
  }
}

@Component({
  selector: "showcase-hashbrown-deal-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "hashbrown-card hashbrown-deal" },
  template: `
    <article data-testid="hashbrown-deal-card">
      <h3>{{ title() }}</h3>
      <p>
        <span>{{ stage() }}</span> · {{ formattedValue() }}
      </p>
      @if (assignee(); as owner) {
        <p>Owner: {{ owner }}</p>
      }
      @if (dueDate(); as due) {
        <p>Due {{ due }}</p>
      }
    </article>
  `,
})
export class HashbrownDealCard {
  readonly title = input.required<string>();
  readonly stage = input.required<string>();
  readonly value = input.required<number>();
  readonly assignee = input<string | undefined>();
  readonly dueDate = input<string | undefined>();
  protected readonly formattedValue = computed(() =>
    this.value().toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }),
  );
}

/** Parse and validate the framework-neutral chart payload used by Showcase. */
function parseChartData(value: string): ChartDatum[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;

    const data = parsed.filter(
      (candidate): candidate is ChartDatum =>
        typeof candidate === "object" &&
        candidate !== null &&
        typeof Reflect.get(candidate, "label") === "string" &&
        typeof Reflect.get(candidate, "value") === "number" &&
        Number.isFinite(Reflect.get(candidate, "value")),
    );
    return data.length === parsed.length ? data : undefined;
  } catch {
    return undefined;
  }
}
