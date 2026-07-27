import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from "@angular/core";
import type {
  AngularToolCall,
  HumanInTheLoopToolCall,
} from "@copilotkit/angular";

export interface ChartDatum {
  readonly label: string;
  readonly value: number;
}

export interface ChartArgs extends Record<string, unknown> {
  readonly title?: string;
  readonly description?: string;
  readonly data?: readonly ChartDatum[];
}

const CHART_COLORS = ["#4263eb", "#845ef7", "#d6336c", "#f59f00", "#0ca678"];

@Component({
  selector: "showcase-beautiful-pie-chart",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="chart-card" data-testid="beautiful-pie-chart">
      <header>
        <h3>{{ title() }}</h3>
        <p>{{ description() }}</p>
      </header>
      <svg viewBox="0 0 240 240" role="img" [attr.aria-label]="title()">
        <circle
          cx="120"
          cy="120"
          r="86"
          fill="none"
          stroke="#edf0f5"
          stroke-width="36"
        />
        @for (slice of slices(); track slice.label) {
          <circle
            cx="120"
            cy="120"
            r="86"
            fill="none"
            [attr.stroke]="slice.color"
            stroke-width="36"
            [attr.stroke-dasharray]="slice.arc + ' ' + slice.gap"
            [attr.stroke-dashoffset]="slice.offset"
            transform="rotate(-90 120 120)"
          />
        }
      </svg>
      <ul>
        @for (datum of data(); track datum.label; let index = $index) {
          <li>
            <i [style.background]="color(index)"></i>
            <span>{{ datum.label }}</span
            ><strong>{{ datum.value }}</strong>
          </li>
        }
      </ul>
    </article>
  `,
  styles: `
    .chart-card {
      max-width: 36rem;
      margin: 1rem auto;
      padding: 1rem;
      border: 1px solid #d8e0ea;
      border-radius: 1rem;
      color: #14213d;
      background: #fff;
    }
    header h3,
    header p {
      margin: 0;
    }
    header p {
      margin-top: 0.25rem;
      color: #66758a;
      font-size: 0.82rem;
    }
    svg {
      display: block;
      width: min(100%, 15rem);
      height: auto;
      margin: 0.75rem auto;
      overflow: visible;
    }
    ul {
      display: grid;
      gap: 0.4rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.82rem;
    }
    li i {
      width: 0.65rem;
      height: 0.65rem;
      border-radius: 50%;
    }
  `,
})
export class PieChartCard {
  readonly toolCall = input.required<AngularToolCall<ChartArgs>>();
  protected readonly title = computed(
    () => this.toolCall().args.title ?? "Pie chart",
  );
  protected readonly description = computed(
    () => this.toolCall().args.description ?? "",
  );
  protected readonly data = computed(() =>
    validData(this.toolCall().args.data),
  );
  protected readonly slices = computed(() => {
    const circumference = 2 * Math.PI * 86;
    const total = this.data().reduce((sum, datum) => sum + datum.value, 0);
    let accumulated = 0;
    return this.data().map((datum, index) => {
      const arc = total > 0 ? (datum.value / total) * circumference : 0;
      const result = {
        ...datum,
        arc,
        gap: circumference - arc,
        offset: -accumulated,
        color: colorAt(index),
      };
      accumulated += arc;
      return result;
    });
  });

  /** Resolve one stable chart-series color. */
  protected color(index: number): string {
    return colorAt(index);
  }
}

@Component({
  selector: "showcase-beautiful-bar-chart",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="chart-card bar-card" data-testid="beautiful-bar-chart">
      <header>
        <h3>{{ title() }}</h3>
        <p>{{ description() }}</p>
      </header>
      <div class="recharts-responsive-container">
        <svg viewBox="0 0 520 280" role="img" [attr.aria-label]="title()">
          @for (bar of bars(); track bar.label) {
            <g class="recharts-bar-rectangle">
              <rect
                [attr.x]="bar.x"
                [attr.y]="bar.y"
                [attr.width]="bar.width"
                [attr.height]="bar.height"
                [attr.fill]="bar.color"
                rx="5"
              />
              <text [attr.x]="bar.x + bar.width / 2" y="268" text-anchor="middle">
                {{ bar.label }}
              </text>
            </g>
          }
        </svg>
      </div>
    </article>
  `,
  styles: `
    .chart-card {
      max-width: 44rem;
      margin: 1rem auto;
      padding: 1rem;
      border: 1px solid #d8e0ea;
      border-radius: 1rem;
      color: #14213d;
      background: #fff;
    }
    header h3,
    header p {
      margin: 0;
    }
    header p {
      margin-top: 0.25rem;
      color: #66758a;
      font-size: 0.82rem;
    }
    .recharts-responsive-container {
      width: 100%;
      min-height: 17.5rem;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      margin: 0.75rem auto;
      overflow: visible;
    }
    text {
      fill: #66758a;
      font-size: 12px;
    }
  `,
})
export class BarChartCard {
  readonly toolCall = input.required<AngularToolCall<ChartArgs>>();
  protected readonly title = computed(
    () => this.toolCall().args.title ?? "Bar chart",
  );
  protected readonly description = computed(
    () => this.toolCall().args.description ?? "",
  );
  protected readonly bars = computed(() => {
    const data = validData(this.toolCall().args.data);
    const max = Math.max(1, ...data.map((datum) => datum.value));
    const slot = 480 / Math.max(1, data.length);
    const width = Math.min(58, slot * 0.66);
    return data.map((datum, index) => {
      const height = Math.max(4, (datum.value / max) * 220);
      return {
        ...datum,
        x: 20 + slot * index + (slot - width) / 2,
        y: 250 - height,
        width,
        height,
        color: colorAt(index),
      };
    });
  });
}

interface FlightResult extends Record<string, unknown> {
  readonly airline?: string;
  readonly flightNumber?: string;
  readonly origin?: string;
  readonly destination?: string;
  readonly date?: string;
  readonly departureTime?: string;
  readonly arrivalTime?: string;
  readonly duration?: string;
  readonly status?: string;
  readonly price?: string;
}

interface FlightSearchArgs extends Record<string, unknown> {
  readonly flights?: readonly FlightResult[];
}

@Component({
  selector: "showcase-beautiful-flight-search",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="flight-results"
      data-testid="beautiful-flight-results"
      aria-label="Flight search results"
    >
      @for (flight of flights(); track flightKey(flight, $index)) {
        <article class="flight-card">
          <header>
            <strong>{{ flight.airline ?? "Airline" }}</strong>
            <strong>{{ flight.price ?? "Price unavailable" }}</strong>
          </header>
          <div class="flight-meta">
            <span>{{ flight.flightNumber ?? "Flight" }}</span>
            <span>{{ flight.date ?? "" }}</span>
          </div>
          <div class="flight-times">
            <strong>{{ flight.departureTime ?? "—" }}</strong>
            <small>{{ flight.duration ?? "" }}</small>
            <strong>{{ flight.arrivalTime ?? "—" }}</strong>
          </div>
          <div class="flight-route">
            <strong>{{ flight.origin ?? "—" }}</strong>
            <span aria-hidden="true">→</span>
            <strong>{{ flight.destination ?? "—" }}</strong>
          </div>
          @if (flight.status; as status) {
            <small class="flight-status">{{ status }}</small>
          }
        </article>
      } @empty {
        <p>No matching flights were returned.</p>
      }
    </section>
  `,
  styles: `
    .flight-results {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
      gap: 0.75rem;
      margin: 0.75rem 0;
    }
    .flight-card {
      display: grid;
      gap: 0.65rem;
      padding: 1rem;
      border: 1px solid #d8e0ea;
      border-radius: 1rem;
      color: #14213d;
      background: #fff;
    }
    header,
    .flight-meta,
    .flight-times,
    .flight-route {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .flight-meta,
    .flight-times,
    .flight-status {
      color: #66758a;
    }
    .flight-route {
      font-size: 1.05rem;
    }
    .flight-times small {
      text-align: center;
    }
    p {
      margin: 0;
      color: #66758a;
    }
  `,
})
export class FlightSearchCard {
  readonly toolCall = input.required<AngularToolCall<FlightSearchArgs>>();
  protected readonly flights = computed(() => {
    const flights = this.toolCall().args.flights;
    return Array.isArray(flights)
      ? flights.filter((flight): flight is FlightResult => isRecord(flight))
      : [];
  });

  /** Produce a stable repeat key without requiring every backend to emit IDs. */
  protected flightKey(flight: FlightResult, index: number): string {
    return `${flight.flightNumber ?? flight.airline ?? "flight"}-${index}`;
  }
}

interface MeetingArgs extends Record<string, unknown> {
  readonly reasonForScheduling?: string;
  readonly meetingDuration?: number;
}

@Component({
  selector: "showcase-beautiful-meeting-picker",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="meeting-card" data-testid="beautiful-meeting-picker">
      @if (selected(); as slot) {
        <span class="confirmation" aria-hidden="true">✓</span>
        <h3>Meeting Scheduled</h3>
        <p>{{ slot.date }} at {{ slot.time }}</p>
        <small>{{ duration() }} min</small>
      } @else {
        <span class="clock" aria-hidden="true">◷</span>
        <h3>{{ reason() }}</h3>
        <p>Pick a time that works for you</p>
        <div class="meeting-options">
          @for (slot of slots; track slot.date) {
            <button
              type="button"
              [attr.data-testid]="'meeting-slot-' + slot.id"
              (click)="choose(slot)"
            >
              <span
                ><strong>{{ slot.date }}</strong
                ><small>{{ slot.time }}</small></span
              >
              <em>{{ duration() }} min</em>
            </button>
          }
        </div>
        <button type="button" class="decline" (click)="decline()">
          None of these work
        </button>
      }
    </article>
  `,
  styles: `
    .meeting-card {
      max-width: 28rem;
      margin: 1rem auto;
      padding: 1.25rem;
      border: 1px solid #d8e0ea;
      border-radius: 1rem;
      text-align: center;
      background: #fff;
      color: #14213d;
    }
    h3,
    p {
      margin: 0.35rem 0;
    }
    .clock,
    .confirmation {
      display: grid;
      width: 2.5rem;
      height: 2.5rem;
      margin: 0 auto;
      place-items: center;
      border-radius: 50%;
      background: #eef2ff;
      color: #4263eb;
      font-size: 1.25rem;
    }
    .confirmation {
      color: #fff;
      background: #189370;
    }
    .meeting-options {
      display: grid;
      gap: 0.55rem;
      margin-top: 1rem;
    }
    .meeting-options button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem;
      border: 1px solid #d8e0ea;
      border-radius: 0.7rem;
      color: inherit;
      background: #fff;
      cursor: pointer;
    }
    .meeting-options span {
      display: grid;
      gap: 0.15rem;
      text-align: left;
    }
    small,
    em {
      color: #66758a;
      font-size: 0.75rem;
      font-style: normal;
    }
    .decline {
      margin-top: 0.75rem;
      border: 0;
      color: #66758a;
      background: transparent;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 3px solid #91a7ff;
      outline-offset: 2px;
    }
  `,
})
export class MeetingTimePickerCard {
  readonly toolCall = input.required<HumanInTheLoopToolCall<MeetingArgs>>();
  protected readonly selected = signal<(typeof this.slots)[number] | null>(
    null,
  );
  protected readonly slots = [
    { id: "tomorrow", date: "Tomorrow", time: "2:00 PM" },
    { id: "friday", date: "Friday", time: "10:00 AM" },
    { id: "next-monday", date: "Next Monday", time: "3:00 PM" },
  ] as const;
  protected readonly reason = computed(
    () => this.toolCall().args.reasonForScheduling ?? "Schedule a Meeting",
  );
  protected readonly duration = computed(
    () => this.toolCall().args.meetingDuration ?? 30,
  );

  /** Resolve a selected slot and resume the paused agent. */
  protected choose(slot: (typeof this.slots)[number]): void {
    this.selected.set(slot);
    this.toolCall().respond(
      `Meeting scheduled for ${slot.date} at ${slot.time} (${this.duration()} min).`,
    );
  }

  /** Resume the paused agent with an explicit declined response. */
  protected decline(): void {
    this.toolCall().respond(
      "The user declined all proposed meeting times. Please suggest alternatives.",
    );
  }
}

const INTERNAL_TOOLS = new Set([
  "render_a2ui",
  "generate_a2ui",
  "log_a2ui_event",
]);

@Component({
  selector: "showcase-beautiful-tool-reasoning",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!hidden()) {
      <details class="reasoning-card" [open]="toolCall().status !== 'complete'">
        <summary>
          <span>{{ toolCall().status === "complete" ? "✓" : "◌" }}</span>
          {{ toolCall().name ?? "Tool" }}
        </summary>
        <pre>{{ argumentsText() }}</pre>
      </details>
    }
  `,
  styles: `
    .reasoning-card {
      margin: 0.5rem 0;
      padding: 0.65rem 0.8rem;
      border: 1px solid #d8e0ea;
      border-radius: 0.75rem;
      background: #f8fafc;
      color: #314158;
    }
    summary {
      cursor: pointer;
      font-weight: 650;
    }
    pre {
      overflow: auto;
      margin: 0.65rem 0 0;
      font-size: 0.75rem;
      white-space: pre-wrap;
    }
  `,
})
export class BeautifulToolReasoningCard {
  readonly toolCall = input.required<AngularToolCall>();
  protected readonly hidden = computed(() =>
    INTERNAL_TOOLS.has(this.toolCall().name ?? ""),
  );
  protected readonly argumentsText = computed(() =>
    JSON.stringify(this.toolCall().args, null, 2),
  );
}

/** Discard malformed, negative, and non-finite chart data. */
function validData(value: readonly ChartDatum[] | undefined): ChartDatum[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (datum) =>
      typeof datum?.label === "string" &&
      typeof datum.value === "number" &&
      Number.isFinite(datum.value) &&
      datum.value >= 0,
  );
}

/** Resolve a stable color for one chart-series index. */
function colorAt(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? CHART_COLORS[0];
}

/** Narrow unknown fixture and provider payloads to safe flight records. */
function isRecord(value: unknown): value is FlightResult {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
