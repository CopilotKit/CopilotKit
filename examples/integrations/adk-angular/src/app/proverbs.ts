import { Component, computed, effect } from "@angular/core";
import { injectAgentStore } from "@copilotkit/angular";
import { AGENT_ID } from "./app.config";
import type { AgentState } from "./agent-state";

@Component({
  selector: "app-proverbs",
  standalone: true,
  template: `
    <div class="card">
      <h1>Proverbs</h1>
      <p class="subtitle">
        This is a demonstrative page, but it could be anything you want! 🪁
      </p>
      <hr />
      <div class="list">
        @for (proverb of proverbs(); track $index) {
          <div class="proverb">
            <p>{{ proverb }}</p>
            <button (click)="remove($index)" aria-label="Remove proverb">✕</button>
          </div>
        }
      </div>
      @if (proverbs().length === 0) {
        <p class="empty">No proverbs yet. Ask the assistant to add some!</p>
      }
    </div>
  `,
  styles: [
    `
      .card {
        background: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(12px);
        padding: 2rem;
        border-radius: 1rem;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
        max-width: 42rem;
        width: 100%;
        color: #fff;
      }
      h1 {
        font-size: 2.25rem;
        font-weight: 700;
        text-align: center;
        margin: 0 0 0.5rem;
      }
      .subtitle {
        text-align: center;
        font-style: italic;
        opacity: 0.85;
        margin: 0 0 1.5rem;
      }
      hr {
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
        margin: 1.5rem 0;
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .proverb {
        position: relative;
        background: rgba(255, 255, 255, 0.15);
        padding: 1rem;
        border-radius: 0.75rem;
      }
      .proverb p {
        margin: 0;
        padding-right: 2rem;
      }
      .proverb button {
        position: absolute;
        right: 0.75rem;
        top: 0.75rem;
        height: 1.5rem;
        width: 1.5rem;
        border: none;
        border-radius: 9999px;
        background: #ef4444;
        color: #fff;
        cursor: pointer;
      }
      .empty {
        text-align: center;
        font-style: italic;
        opacity: 0.8;
        margin: 2rem 0;
      }
    `,
  ],
})
export class Proverbs {
  readonly #store = injectAgentStore(AGENT_ID);

  protected readonly proverbs = computed<string[]>(
    () => (this.#store().state() as AgentState | undefined)?.proverbs ?? [],
  );

  constructor() {
    // Seed one proverb whenever the agent reports undefined proverbs — the
    // initial thread and every fresh "+ New" thread (mirrors the React
    // page.tsx effect keyed on the agent instance). Once seeded, `proverbs`
    // is defined so the guard stops re-seeding within the thread; a thread the
    // user emptied (`[]`) is left alone.
    effect(() => {
      const state = this.#store().state() as AgentState | undefined;
      if (state?.proverbs === undefined) {
        this.#store().agent.setState({
          proverbs: [
            "CopilotKit may be new, but it's the best thing since sliced bread.",
          ],
        } satisfies AgentState);
      }
    });
  }

  protected remove(index: number): void {
    const next = this.proverbs().filter((_, i) => i !== index);
    this.#store().agent.setState({ proverbs: next } satisfies AgentState);
  }
}
