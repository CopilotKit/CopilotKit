import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";

import { toggleValue } from "./state-model";

export const TIMEZONES = [
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

export const ACTIVITIES = [
  "Viewed the pricing page",
  "Added 'Pro Plan' to cart",
  "Watched the product demo video",
  "Started the 14-day free trial",
  "Invited a teammate",
] as const;

@Component({
  selector: "showcase-context-panel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="context-card" aria-labelledby="context-title">
      <header>
        <p>Read-only Agent Context · connectAgentContext</p>
        <h2 id="context-title">Agent Context Inspector</h2>
        <p>
          Edit these frontend-owned values and ask the agent what it knows about
          you.
        </p>
      </header>

      <article>
        <h3>Identity <span>live</span></h3>
        <label for="ctx-name-input">Name</label>
        <input
          id="ctx-name-input"
          data-testid="ctx-name"
          type="text"
          [value]="userName()"
          (input)="nameChange.emit(valueOf($event))"
        />
        <label for="ctx-tz-select">Timezone</label>
        <select
          id="ctx-tz-select"
          data-testid="ctx-timezone"
          [value]="timezone()"
          (change)="timezoneChange.emit(valueOf($event))"
        >
          @for (zone of timezones; track zone) {
            <option [value]="zone">{{ zone }}</option>
          }
        </select>
        <div class="identity">
          <span data-testid="identity-avatar">{{ avatar() }}</span>
          <div>
            <strong data-testid="identity-name">{{
              userName() || "Anonymous"
            }}</strong
            ><small data-testid="identity-timezone">{{ timezone() }}</small>
          </div>
        </div>
      </article>

      <article class="activity-card">
        <h3>
          Recent Activity <span>{{ recentActivity().length }} selected</span>
        </h3>
        <div class="activity-grid">
          @for (activity of activities; track activity) {
            <label
              [attr.data-testid]="activityTestId(activity)"
              [class.selected]="recentActivity().includes(activity)"
            >
              <input
                type="checkbox"
                [checked]="recentActivity().includes(activity)"
                (change)="
                  activityChange.emit(toggleValue(recentActivity(), activity))
                "
              />
              <span
                ><strong>{{ activity }}</strong
                ><small>{{
                  recentActivity().includes(activity)
                    ? "Visible to the agent"
                    : "Hidden from the agent"
                }}</small></span
              >
            </label>
          }
        </div>
      </article>

      <article class="published">
        <h3>Published Context <span>read-only · streamed</span></h3>
        <pre data-testid="ctx-state-json">{{ stateJson() }}</pre>
      </article>
    </section>
  `,
  styles: `
    section {
      display: grid;
      grid-template-columns: minmax(14rem, 0.7fr) minmax(20rem, 1.3fr);
      gap: 1rem;
    }
    section > header,
    .published {
      grid-column: 1 / -1;
    }
    header p,
    header h2 {
      margin: 0;
    }
    header > p:first-child {
      color: #1d4ed8;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    header h2 {
      margin-top: 0.35rem;
      font-size: clamp(1.6rem, 3vw, 2.3rem);
    }
    header > p:last-child {
      margin-top: 0.5rem;
      color: #52637a;
    }
    article {
      display: grid;
      align-content: start;
      gap: 0.7rem;
      padding: 1rem;
      border: 1px solid #dbe3eb;
      background: #fff;
    }
    h3 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin: 0;
      font-size: 0.95rem;
    }
    h3 span {
      color: #52637a;
      font-size: 0.67rem;
      font-weight: 600;
    }
    article > label {
      color: #31465e;
      font-size: 0.76rem;
      font-weight: 700;
    }
    article > input,
    article > select {
      min-height: 2.5rem;
      padding: 0.55rem 0.7rem;
      border: 1px solid #9fb3c8;
      border-radius: 0.35rem;
      background: #fff;
      font: inherit;
    }
    :is(input, select):focus-visible {
      outline: 3px solid #2563eb;
      outline-offset: 2px;
    }
    .identity {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      margin-top: 0.5rem;
      padding: 0.8rem;
      background: #f8fafc;
    }
    .identity > span {
      display: grid;
      width: 3rem;
      height: 3rem;
      place-items: center;
      border-radius: 50%;
      color: #1e40af;
      background: #dbeafe;
      font-size: 1.25rem;
      font-weight: 700;
    }
    .identity div {
      display: grid;
      gap: 0.2rem;
    }
    .identity small {
      color: #64748b;
    }
    .activity-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.55rem;
    }
    .activity-grid label {
      display: flex;
      align-items: start;
      gap: 0.55rem;
      padding: 0.7rem;
      border: 1px solid #e2e8f0;
      cursor: pointer;
    }
    .activity-grid label.selected {
      border-color: #93c5fd;
      background: #eff6ff;
    }
    .activity-grid label > span {
      display: grid;
      gap: 0.2rem;
    }
    .activity-grid small {
      color: #64748b;
    }
    pre {
      margin: 0;
      padding: 1rem;
      overflow: auto;
      color: #f8fafc;
      background: #172033;
      font-size: 0.75rem;
    }
    @media (max-width: 48rem) {
      section,
      .activity-grid {
        grid-template-columns: 1fr;
      }
      section > header,
      .published {
        grid-column: auto;
      }
    }
  `,
})
export class ContextPanelComponent {
  readonly userName = input.required<string>();
  readonly timezone = input.required<string>();
  readonly recentActivity = input.required<readonly string[]>();
  readonly nameChange = output<string>();
  readonly timezoneChange = output<string>();
  readonly activityChange = output<string[]>();
  protected readonly timezones = TIMEZONES;
  protected readonly activities = ACTIVITIES;
  protected readonly toggleValue = toggleValue;

  protected avatar(): string {
    return this.userName().charAt(0).toUpperCase() || "?";
  }

  protected stateJson(): string {
    return JSON.stringify(
      {
        name: this.userName(),
        timezone: this.timezone(),
        recentActivity: this.recentActivity(),
      },
      null,
      2,
    );
  }

  protected activityTestId(activity: string): string {
    return `activity-${activity
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
