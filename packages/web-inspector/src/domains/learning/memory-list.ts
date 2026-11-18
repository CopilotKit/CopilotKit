import type { Memory, MemoryKind } from "@copilotkit/core";
import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { PortableLitElement } from "../../ui/portable-lit-element.js";
import { memoryListStyles } from "./memory-list.styles.js";
import {
  maxRecallScore,
  normalizeRelevance,
  relevanceBarWidth,
} from "./recall.js";

type MemoryKindFilter = "all" | MemoryKind;

const MEMORY_KINDS: readonly MemoryKind[] = [
  "topical",
  "episodic",
  "operational",
];

function isMemoryKindFilter(
  value: string | undefined,
): value is MemoryKindFilter {
  return value === "all" || MEMORY_KINDS.some((kind) => kind === value);
}

export class CpkMemoryList extends PortableLitElement {
  static properties = {
    memories: { attribute: false },
    recallResults: { attribute: false },
    recallLoading: { attribute: false },
    recallError: { attribute: false },
    recallQueryText: { attribute: false },
    search: { state: true },
    kind: { state: true },
  };

  static styles = memoryListStyles;

  memories: Memory[] = [];
  recallResults: Memory[] | null = null;
  recallLoading = false;
  recallError: string | null = null;
  recallQueryText = "";
  private search = "";
  private kind: MemoryKindFilter = "all";

  private get searchFiltered(): Memory[] {
    const query = this.search.trim().toLowerCase();
    if (!query) return this.memories;
    return this.memories.filter((memory) =>
      memory.content.toLowerCase().includes(query),
    );
  }

  private get filtered(): Memory[] {
    if (this.kind === "all") return this.searchFiltered;
    return this.searchFiltered.filter((memory) => memory.kind === this.kind);
  }

  private countForKind(kind: MemoryKind): number {
    return this.searchFiltered.filter((memory) => memory.kind === kind).length;
  }

  private isInputElement(
    target: EventTarget | null,
  ): target is HTMLInputElement {
    const InputElement = this.ownerDocument.defaultView?.HTMLInputElement;
    return InputElement !== undefined && target instanceof InputElement;
  }

  private isElement(target: EventTarget | null): target is Element {
    const ElementConstructor = this.ownerDocument.defaultView?.Element;
    return (
      ElementConstructor !== undefined && target instanceof ElementConstructor
    );
  }

  private onSearchInput = (event: Event): void => {
    if (this.isInputElement(event.target)) {
      this.search = event.target.value;
    }
  };

  private onKindClick = (event: Event): void => {
    if (!this.isElement(event.target)) return;
    const segment = event.target.closest<HTMLElement>("[data-kind]");
    const kind = segment?.dataset["kind"];
    if (isMemoryKindFilter(kind)) this.kind = kind;
  };

  private shortId(id: string): string {
    if (id.length <= 12) return id;
    return `${id.slice(0, 4)}…${id.slice(-4)}`;
  }

  private renderKindBadge(kind: MemoryKind): TemplateResult {
    return html`<span class="cpk-ml__kind-badge cpk-ml__kind-badge--${kind}"
      >${kind}</span
    >`;
  }

  private renderScopeBadge(scope: Memory["scope"]): TemplateResult {
    const variant = scope === "project" ? "project" : "user";
    return html`<span
      class="cpk-ml__scope-badge cpk-ml__scope-badge--${variant}"
      >${scope}</span
    >`;
  }

  private renderCard(memory: Memory, relevance?: number): TemplateResult {
    const threads = memory.sourceThreadIds.length;
    return html`
      <article class="cpk-ml__card">
        <div class="cpk-ml__card-badges">
          ${this.renderKindBadge(memory.kind)}${this.renderScopeBadge(
            memory.scope,
          )}
        </div>
        <div class="cpk-ml__content">${memory.content}</div>
        ${
          relevance !== undefined
            ? html`<div class="cpk-ml__relevance" aria-hidden="true">
                <div
                  class="cpk-ml__relevance-fill"
                  style="width:${relevanceBarWidth(relevance)}%;"
                ></div>
              </div>`
            : nothing
        }
        <div class="cpk-ml__footer">
          <span class="cpk-ml__footer-threads"
            >${threads} source thread${threads === 1 ? "" : "s"}</span
          >
          <span class="cpk-ml__footer-id">${this.shortId(memory.id)}</span>
        </div>
      </article>
    `;
  }

  private onRecallInput = (event: Event): void => {
    if (!this.isInputElement(event.target)) return;
    this.recallQueryText = event.target.value;
    this.dispatchEvent(
      new CustomEvent<string>("recallQueryChanged", {
        detail: this.recallQueryText,
        bubbles: true,
        composed: true,
      }),
    );
  };

  private onRecallSubmit = (event: Event): void => {
    event.preventDefault();
    const query = this.recallQueryText.trim();
    if (query.length === 0 || this.recallLoading) return;
    this.dispatchEvent(
      new CustomEvent<string>("recallSubmitted", {
        detail: query,
        bubbles: true,
        composed: true,
      }),
    );
  };

  private onRecallClear = (): void => {
    this.dispatchEvent(
      new CustomEvent("recallCleared", { bubbles: true, composed: true }),
    );
  };

  private renderRecallForm(): TemplateResult {
    const disabled =
      this.recallLoading || this.recallQueryText.trim().length === 0;
    return html`
      <form class="cpk-ml__recall" @submit=${this.onRecallSubmit}>
        <input
          type="text"
          placeholder="Recall by meaning…"
          aria-label="Recall learning records by meaning"
          class="cpk-ml__recall-input"
          .value=${this.recallQueryText}
          @input=${this.onRecallInput}
        />
        <button type="submit" class="cpk-ml__recall-btn" ?disabled=${disabled}>
          ${this.recallLoading ? "…" : "Recall"}
        </button>
      </form>
    `;
  }

  private renderRecallSection(): TemplateResult {
    const results = this.recallResults;
    if (results === null) return html``;
    const max = maxRecallScore(results);
    return html`
      <section
        class="cpk-ml__recall-section"
        aria-label="Semantic recall results"
      >
        <div class="cpk-ml__recall-header">
          <span class="cpk-ml__recall-title"
            >Semantic recall (${results.length})</span
          >
          <button
            type="button"
            class="cpk-ml__recall-clear"
            @click=${this.onRecallClear}
          >
            Clear
          </button>
        </div>
        ${
          this.recallError
            ? html`<p
                class="cpk-ml__recall-msg cpk-ml__recall-msg--error"
                role="alert"
              >
                Recall failed: ${this.recallError}
              </p>`
            : results.length === 0
              ? html`
                  <p class="cpk-ml__recall-msg">No learning records matched that query.</p>
                `
              : results.map((memory) =>
                  this.renderCard(
                    memory,
                    normalizeRelevance(memory.score, max),
                  ),
                )
        }
      </section>
    `;
  }

  private renderEmpty(): TemplateResult {
    const query = this.search.trim();
    if (this.memories.length === 0) {
      return html`
        <div class="cpk-ml__empty">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="cpk-ml__empty-icon"
            aria-hidden="true"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          No learning records yet — tell the agent a durable fact and watch it appear.
        </div>
      `;
    }
    if (query) {
      return html`
        <div class="cpk-ml__empty">
          No learning records match &ldquo;${query}&rdquo;.
        </div>
      `;
    }
    return html`
      <div class="cpk-ml__empty">No ${this.kind} learning records yet.</div>
    `;
  }

  render() {
    const filtered = this.filtered;
    return html`
      <div class="cpk-ml">
        ${this.renderRecallForm()} ${this.renderRecallSection()}
        <div class="cpk-ml__search">
          <input
            type="search"
            placeholder="Search learning…"
            aria-label="Search learning records"
            .value=${this.search}
            @input=${this.onSearchInput}
            class="cpk-ml__search-input"
          />
        </div>
        <div class="cpk-ml__filter" @click=${this.onKindClick}>
          <button
            type="button"
            class="cpk-ml__filter-seg ${
              this.kind === "all" ? "cpk-ml__filter-seg--active" : ""
            }"
            data-kind="all"
            aria-pressed=${this.kind === "all"}
          >
            All<span class="cpk-ml__filter-count"
              >${this.searchFiltered.length}</span
            >
          </button>
          ${MEMORY_KINDS.map(
            (kind) => html`
              <button
                type="button"
                class="cpk-ml__filter-seg ${
                  this.kind === kind ? "cpk-ml__filter-seg--active" : ""
                }"
                data-kind=${kind}
                aria-pressed=${this.kind === kind}
              >
                ${kind}<span class="cpk-ml__filter-count"
                  >${this.countForKind(kind)}</span
                >
              </button>
            `,
          )}
        </div>
        <div class="cpk-ml__list">
          ${filtered.map((memory) => this.renderCard(memory))}
          ${filtered.length === 0 ? this.renderEmpty() : nothing}
        </div>
      </div>
    `;
  }
}
