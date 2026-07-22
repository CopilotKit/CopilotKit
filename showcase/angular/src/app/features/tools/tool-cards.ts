import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import type { AngularToolCall } from "@copilotkit/angular";

@Component({
  selector: "showcase-weather-tool-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="showcase-tool-card weather" data-testid="weather-card">
      <span>Weather</span>
      <strong>{{ location() }}</strong>
      <p>
        {{ statusText() }}
        @if (temperature() !== undefined) {
          <span data-testid="weather-temperature">{{ temperature() }}°</span>
        }
      </p>
    </article>
  `,
})
export class WeatherToolCard {
  readonly toolCall =
    input.required<AngularToolCall<{ location?: string; city?: string }>>();
  protected readonly location = computed(
    () => this.toolCall().args.location ?? this.toolCall().args.city ?? "Tokyo",
  );
  protected readonly statusText = computed(() =>
    this.toolCall().status === "complete"
      ? "Forecast ready"
      : "Loading forecast…",
  );
  protected readonly temperature = computed(() => {
    const result = this.toolCall().result;
    if (result === undefined) return undefined;

    try {
      const parsed = JSON.parse(result) as { temperature?: unknown };
      return typeof parsed.temperature === "number"
        ? parsed.temperature
        : undefined;
    } catch {
      return undefined;
    }
  });
}

@Component({
  selector: "showcase-flight-tool-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="showcase-tool-card" data-testid="flight-list-card">
      <span>Flights</span>
      <strong>{{ route() }}</strong>
      <p>Matching flights are ready.</p>
    </article>
  `,
})
export class FlightToolCard {
  readonly toolCall = input.required<
    AngularToolCall<{
      origin?: string;
      destination?: string;
      from?: string;
      to?: string;
    }>
  >();
  protected readonly route = computed(() => {
    const args = this.toolCall().args;
    return `${args.origin ?? args.from ?? "SFO"} → ${args.destination ?? args.to ?? "JFK"}`;
  });
}

@Component({
  selector: "showcase-wildcard-tool-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="showcase-tool-card"
      data-testid="custom-wildcard-card"
      [attr.data-tool-name]="toolCall().name ?? 'unknown'"
    >
      <span>Custom wildcard renderer</span>
      <strong>{{ toolCall().name ?? "Unknown tool" }}</strong>
      <p>{{ statusLabel() }}</p>
    </article>
  `,
})
export class ShowcaseWildcardToolCard {
  readonly toolCall = input.required<AngularToolCall>();
  protected readonly statusLabel = computed(() =>
    this.toolCall().status === "complete" ? "Complete" : "Running",
  );
}

@Component({
  selector: "showcase-reasoning-catchall-tool-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="showcase-tool-card"
      data-testid="custom-catchall-card"
      [attr.data-tool-name]="toolCall().name ?? 'unknown'"
    >
      <span>Reasoning-chain catchall renderer</span>
      <strong>{{ toolCall().name ?? "Unknown tool" }}</strong>
      <p>{{ statusLabel() }}</p>
    </article>
  `,
})
export class ReasoningCatchallToolCard {
  readonly toolCall = input.required<AngularToolCall>();
  protected readonly statusLabel = computed(() =>
    this.toolCall().status === "complete" ? "Complete" : "Running",
  );
}

@Component({
  selector: "showcase-haiku-tool-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="showcase-tool-card haiku" data-testid="haiku-card">
      <span>Generated haiku</span>
      <p data-testid="haiku-japanese-line">古池や</p>
      <p data-testid="haiku-english-line">Still water holds the sky.</p>
    </article>
  `,
})
export class HaikuToolCard {
  readonly toolCall = input.required<AngularToolCall>();
}

@Component({
  selector: "showcase-pie-chart-tool-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="showcase-tool-card" data-testid="gen-ui-component">
      <span>Revenue pie chart</span>
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label="Revenue by category pie chart"
      >
        <circle cx="50" cy="50" r="40" fill="#dbeafe" />
        <path d="M50 50 L50 10 A40 40 0 0 1 84.6 70 Z" fill="#2563eb" />
        <path d="M50 50 L84.6 70 A40 40 0 1 1 50 10 Z" fill="#60a5fa" />
      </svg>
    </article>
  `,
})
export class PieChartToolCard {
  readonly toolCall = input.required<AngularToolCall>();
}

interface NoteResult {
  id: string;
  title: string;
}

@Component({
  selector: "showcase-notes-tool-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="showcase-tool-card" data-testid="notes-card">
      <span>Notes</span>
      @if (notes().length > 0) {
        <ul data-testid="notes-list">
          @for (note of notes(); track note.id) {
            <li [attr.data-testid]="'note-' + note.id">{{ note.title }}</li>
          }
        </ul>
      } @else if (toolCall().status === "complete") {
        <p>No notes matched</p>
      } @else {
        <p>Searching notes…</p>
      }
    </article>
  `,
})
export class NotesToolCard {
  readonly toolCall = input.required<AngularToolCall<{ query?: string }>>();
  protected readonly notes = computed(() => parseNotes(this.toolCall().result));
}

@Component({
  selector: "showcase-thread-tool-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="showcase-tool-card" data-testid="ent-658-tool-card">
      <strong>testFrontendToolCalling</strong>
      <p>label: {{ toolCall().args.label ?? "pending" }}</p>
      <p>result: {{ toolCall().result ?? "pending" }}</p>
    </article>
  `,
})
export class ThreadToolCard {
  readonly toolCall = input.required<AngularToolCall<{ label?: string }>>();
}

function parseNotes(result: unknown): NoteResult[] {
  if (typeof result !== "string") return [];
  try {
    const value: unknown = JSON.parse(result);
    if (!Array.isArray(value)) return [];
    return value.flatMap((candidate, index) => {
      if (typeof candidate !== "object" || candidate === null) return [];
      const note = candidate as { id?: unknown; title?: unknown };
      if (typeof note.title !== "string") return [];
      return [
        {
          id: typeof note.id === "string" ? note.id : `result-${index}`,
          title: note.title,
        },
      ];
    });
  } catch {
    return [];
  }
}
