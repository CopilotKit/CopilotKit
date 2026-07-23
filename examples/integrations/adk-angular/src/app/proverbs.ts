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
    // Seed one proverb ONCE per agent instance (mirrors the React page.tsx
    // effect keyed on `[agent]`). Keying the one-shot on the agent — not on the
    // state value — is what keeps a transient `undefined` state (mid-run, or
    // while a thread's persisted state loads) from re-seeding and fighting the
    // agent. A fresh thread that brings a new agent instance seeds once; an
    // agent whose thread the user emptied (`[]`) is left alone (`[]` is defined).
    let seededAgent: unknown;
    effect(() => {
      const store = this.#store();
      const agent = store.agent;
      if (agent === seededAgent) return;
      // Mark this agent handled UP FRONT (not only when we seed) so the effect
      // is a true one-shot per agent instance. Otherwise a first snapshot whose
      // proverbs are already defined leaves the latch unset, the effect stays
      // subscribed to state(), and a later transient `undefined` re-seeds and
      // clobbers live state. (A brand-new agent whose persisted thread is still
      // hydrating can still be seeded on its first `undefined` snapshot — the
      // same inherent race the React `[agent]` reference has; acceptable here.)
      seededAgent = agent;
      const state = store.state() as AgentState | undefined;
      if (state?.proverbs === undefined) {
        // Spread existing state — setState is a full replace (see remove()).
        // Spreading `undefined` is a no-op, so no empty-object fallback needed.
        agent.setState({
          ...state,
          proverbs: [
            "CopilotKit may be new, but it's the best thing since sliced bread.",
          ],
        } satisfies AgentState);
      }
    });
  }

  protected remove(index: number): void {
    // Spread the existing state — agent.setState is a full replace, so dropping
    // the spread would wipe any non-proverbs state the agent carries (matches
    // the React reference's `setState({ ...state, proverbs })`).
    const state = (this.#store().state() as AgentState | undefined) ?? {};
    const next = this.proverbs().filter((_, i) => i !== index);
    this.#store().agent.setState({
      ...state,
      proverbs: next,
    } satisfies AgentState);
  }
}
