import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";

import type { Preferences, PreferenceTone } from "./state-model";
import { toggleValue } from "./state-model";

const INTERESTS = [
  "Cooking",
  "Travel",
  "Tech",
  "Music",
  "Sports",
  "Books",
  "Movies",
] as const;

@Component({
  selector: "showcase-preferences-panel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "state-card" },
  template: `
    <section data-testid="preferences-card" aria-labelledby="preferences-title">
      <h2 id="preferences-title">Your preferences</h2>
      <p>Written into agent state and read by the agent on every turn.</p>

      <label for="pref-name">Name</label>
      <input
        id="pref-name"
        data-testid="pref-name"
        type="text"
        [value]="value().name"
        placeholder="e.g. Atai"
        (input)="setName($event)"
      />

      <div class="field-grid">
        <div>
          <label for="pref-tone">Tone</label>
          <select
            id="pref-tone"
            data-testid="pref-tone"
            [value]="value().tone"
            (change)="setTone($event)"
          >
            <option value="formal">Formal</option>
            <option value="casual">Casual</option>
            <option value="playful">Playful</option>
          </select>
        </div>
        <div>
          <label for="pref-language">Language</label>
          <select
            id="pref-language"
            data-testid="pref-language"
            [value]="value().language"
            (change)="setLanguage($event)"
          >
            @for (language of languages; track language) {
              <option [value]="language">{{ language }}</option>
            }
          </select>
        </div>
      </div>

      <fieldset>
        <legend>Interests</legend>
        <div class="choice-list">
          @for (interest of interests; track interest) {
            <button
              type="button"
              [class.selected]="value().interests.includes(interest)"
              [attr.aria-pressed]="value().interests.includes(interest)"
              (click)="toggleInterest(interest)"
            >
              {{ interest }}
            </button>
          }
        </div>
      </fieldset>

      <span class="state-label">Shared state</span>
      <pre data-testid="pref-state-json">{{ stateJson() }}</pre>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    section {
      display: grid;
      gap: 0.8rem;
      height: 100%;
      padding: 1.25rem;
      border: 1px solid #dbe3eb;
      background: #fff;
    }
    h2,
    p {
      margin: 0;
    }
    p {
      color: #52637a;
      font-size: 0.9rem;
    }
    label,
    legend {
      color: #31465e;
      font-size: 0.78rem;
      font-weight: 700;
    }
    input,
    select {
      width: 100%;
      min-height: 2.6rem;
      padding: 0.55rem 0.7rem;
      border: 1px solid #9fb3c8;
      border-radius: 0.35rem;
      background: #fff;
      font: inherit;
    }
    .field-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.8rem;
    }
    .field-grid > div {
      display: grid;
      gap: 0.35rem;
    }
    fieldset {
      margin: 0;
      padding: 0;
      border: 0;
    }
    .choice-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      margin-top: 0.45rem;
    }
    button {
      padding: 0.4rem 0.65rem;
      border: 1px solid #9fb3c8;
      border-radius: 999px;
      color: #31465e;
      background: #fff;
      cursor: pointer;
    }
    button.selected {
      color: #fff;
      border-color: #1d4ed8;
      background: #1d4ed8;
    }
    :is(input, select, button):focus-visible {
      outline: 3px solid #2563eb;
      outline-offset: 2px;
    }
    .state-label {
      color: #64748b;
      font-size: 0.67rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    pre {
      min-height: 8rem;
      margin: 0;
      padding: 0.75rem;
      overflow: auto;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      font-size: 0.72rem;
    }
    @media (max-width: 38rem) {
      .field-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class PreferencesPanelComponent {
  readonly value = input.required<Preferences>();
  readonly valueChange = output<Preferences>();
  protected readonly interests = INTERESTS;
  protected readonly languages = [
    "English",
    "Spanish",
    "French",
    "German",
    "Japanese",
  ];

  protected stateJson(): string {
    return JSON.stringify(this.value(), null, 2);
  }

  protected setName(event: Event): void {
    this.patch({ name: (event.target as HTMLInputElement).value });
  }

  protected setTone(event: Event): void {
    this.patch({
      tone: (event.target as HTMLSelectElement).value as PreferenceTone,
    });
  }

  protected setLanguage(event: Event): void {
    this.patch({ language: (event.target as HTMLSelectElement).value });
  }

  protected toggleInterest(interest: string): void {
    this.patch({ interests: toggleValue(this.value().interests, interest) });
  }

  private patch(change: Partial<Preferences>): void {
    this.valueChange.emit({ ...this.value(), ...change });
  }
}
