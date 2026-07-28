import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";

@Component({
  selector: "showcase-notes-panel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "state-card" },
  template: `
    <section data-testid="notes-card" aria-labelledby="notes-title">
      <header>
        <div>
          <h2 id="notes-title">Agent Scratch pad</h2>
          <p>The agent writes here through its <code>set_notes</code> tool.</p>
        </div>
        @if (notes().length > 0) {
          <button
            data-testid="notes-clear-button"
            type="button"
            (click)="clear.emit()"
          >
            Clear
          </button>
        }
      </header>
      @if (notes().length === 0) {
        <div data-testid="notes-empty" class="empty">
          The agent will make observations about you and note them here.
        </div>
      } @else {
        <ol data-testid="notes-list">
          @for (note of notes(); track $index) {
            <li data-testid="note-item">
              <span>{{ ($index + 1).toString().padStart(2, "0") }}</span
              >{{ note }}
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    section {
      height: 100%;
      padding: 1.25rem;
      border: 1px solid #dbe3eb;
      background: #fff;
    }
    header {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 1rem;
    }
    h2,
    p {
      margin: 0;
    }
    p {
      margin-top: 0.45rem;
      color: #52637a;
      font-size: 0.9rem;
    }
    button {
      padding: 0.45rem 0.7rem;
      border: 1px solid #b91c1c;
      border-radius: 0.35rem;
      color: #fff;
      background: #b91c1c;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 3px solid #2563eb;
      outline-offset: 2px;
    }
    .empty {
      display: grid;
      min-height: 10rem;
      margin-top: 1rem;
      place-items: center;
      padding: 1rem;
      border: 1px dashed #cbd5e1;
      color: #64748b;
      text-align: center;
    }
    ol {
      display: grid;
      gap: 0.5rem;
      margin: 1rem 0 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      gap: 0.7rem;
      padding: 0.7rem;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
    }
    li span {
      color: #64748b;
      font:
        0.72rem ui-monospace,
        monospace;
    }
  `,
})
export class NotesPanelComponent {
  readonly notes = input.required<readonly string[]>();
  readonly clear = output<void>();
}
