import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { Memory } from "@copilotkit/core";

import { PortableLitElement } from "./portable-lit-element.js";
import {
  maxRecallScore,
  normalizeRelevance,
  relevanceBarWidth,
} from "../lib/memory-recall.js";

/** Memory kind values including the "all" sentinel used by the filter UI. */
type MemoryKindFilter = "all" | "topical" | "episodic" | "operational";

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

  /** Ordered (newest-first) list of memories supplied by the parent. */
  memories: Memory[] = [];
  /** Semantic-recall results. `null` = no recall run (section hidden); `[]` = ran, no matches. */
  recallResults: Memory[] | null = null;
  /** True while a recall request is in flight. */
  recallLoading = false;
  /** Error message from the most recent recall attempt, or null. */
  recallError: string | null = null;
  /** The recall input text (owned by the parent). */
  recallQueryText = "";
  private search = "";
  private kind: MemoryKindFilter = "all";

  static styles = css`
    @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");

    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .cpk-ml {
      font-family: "Plus Jakarta Sans", sans-serif;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background: #f7f7f9;
    }

    /* ── Search ── */
    .cpk-ml__search {
      padding: 10px 12px;
      border-bottom: 1px solid #dbdbe5;
      flex-shrink: 0;
    }

    .cpk-ml__search-input {
      width: 100%;
      box-sizing: border-box;
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px;
      padding: 7px 10px;
      border-radius: 7px;
      border: 1px solid #dbdbe5;
      background: #ffffff;
      color: #010507;
      outline: none;
      transition: border-color 0.15s;
    }

    .cpk-ml__search-input:focus {
      border-color: #bec2ff;
    }

    /* ── Kind filter ── */
    .cpk-ml__filter {
      display: flex;
      gap: 4px;
      padding: 8px 12px;
      border-bottom: 1px solid #dbdbe5;
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .cpk-ml__filter-seg {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 11px;
      font-weight: 500;
      padding: 3px 9px;
      border-radius: 6px;
      border: 1px solid #dbdbe5;
      background: #ffffff;
      color: #57575b;
      cursor: pointer;
      transition:
        background 0.1s,
        border-color 0.1s,
        color 0.1s;
      user-select: none;
    }

    .cpk-ml__filter-seg:hover {
      background: #f0f0f5;
    }

    .cpk-ml__filter-seg--active {
      background: #bec2ff1a;
      border-color: #bec2ff;
      color: #010507;
    }

    .cpk-ml__filter-count {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      margin-left: 4px;
      color: #68686e;
    }

    /* ── List ── */
    .cpk-ml__list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* ── Card ── */
    .cpk-ml__card {
      background: #ffffff;
      border: 1px solid #e9e9ef;
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .cpk-ml__card-badges {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }

    /* Kind badge — color per kind */
    .cpk-ml__kind-badge {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      padding: 1px 7px;
      border-radius: 5px;
      text-transform: uppercase;
      font-weight: 500;
      white-space: nowrap;
    }

    .cpk-ml__kind-badge--topical {
      background: #eee6fe;
      color: #57575b;
    }

    .cpk-ml__kind-badge--episodic {
      background: #e6f4fe;
      color: #2d5f80;
    }

    .cpk-ml__kind-badge--operational {
      background: #e6feee;
      color: #2d6645;
    }

    /* Scope badge */
    .cpk-ml__scope-badge {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      padding: 1px 7px;
      border-radius: 5px;
      text-transform: uppercase;
      font-weight: 500;
      white-space: nowrap;
      background: #f0f0f5;
      color: #68686e;
    }

    /* Content */
    .cpk-ml__content {
      font-size: 12px;
      color: #010507;
      line-height: 1.5;
      word-break: break-word;
    }

    /* Footer */
    .cpk-ml__footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 2px;
    }

    .cpk-ml__footer-threads {
      font-size: 10px;
      color: #68686e;
    }

    .cpk-ml__footer-id {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      color: #c0c0c8;
    }

    /* ── Empty state ── */
    .cpk-ml__empty {
      padding: 32px 16px;
      text-align: center;
      color: #68686e;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .cpk-ml__empty-icon {
      color: #c0c0c8;
    }

    /* ── Recall ── */
    .cpk-ml__recall {
      display: flex;
      gap: 6px;
      padding: 10px 12px;
      border-bottom: 1px solid #dbdbe5;
      flex-shrink: 0;
    }
    .cpk-ml__recall-input {
      flex: 1;
      box-sizing: border-box;
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px;
      padding: 7px 10px;
      border-radius: 7px;
      border: 1px solid #dbdbe5;
      background: #fff;
      color: #010507;
      outline: none;
      transition: border-color 0.15s;
    }
    .cpk-ml__recall-input:focus {
      border-color: #bec2ff;
    }
    .cpk-ml__recall-btn {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px;
      font-weight: 500;
      padding: 7px 12px;
      border-radius: 7px;
      border: 1px solid #dbdbe5;
      background: #fff;
      color: #010507;
      cursor: pointer;
      transition: background 0.1s;
    }
    .cpk-ml__recall-btn:hover:not(:disabled) {
      background: #f0f0f5;
    }
    .cpk-ml__recall-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .cpk-ml__recall-section {
      flex-shrink: 0;
      max-height: 45%;
      overflow-y: auto;
      padding: 8px 12px;
      border-bottom: 1px solid #dbdbe5;
      background: #fbfbfd;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .cpk-ml__recall-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .cpk-ml__recall-title {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px;
      font-weight: 600;
      color: #010507;
    }
    .cpk-ml__recall-clear {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 10px;
      color: #68686e;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
    }
    .cpk-ml__recall-clear:hover {
      color: #010507;
    }
    .cpk-ml__recall-msg {
      font-size: 11px;
      color: #68686e;
      line-height: 1.45;
    }
    .cpk-ml__recall-msg--error {
      color: #c0333a;
    }

    /* ── Relevance bar ── */
    .cpk-ml__relevance {
      height: 4px;
      width: 100%;
      overflow: hidden;
      border-radius: 9999px;
      background: #f0f0f5;
    }
    .cpk-ml__relevance-fill {
      height: 100%;
      border-radius: 9999px;
      background: #6366f1;
    }

    /* ── Scope badge variants ── */
    .cpk-ml__scope-badge--user {
      background: #f0f0f5;
      color: #68686e;
    }
    .cpk-ml__scope-badge--project {
      background: #fef3c7;
      color: #92660c;
    }

    :host([data-color-scheme="dark"]) {
      color-scheme: dark;
    }

    :host([data-color-scheme="dark"]) .cpk-ml {
      background: #15171e;
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__search,
    :host([data-color-scheme="dark"]) .cpk-ml__filter,
    :host([data-color-scheme="dark"]) .cpk-ml__recall,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-section,
    :host([data-color-scheme="dark"]) .cpk-ml__card {
      border-color: #343742;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__search-input,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-input,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-btn,
    :host([data-color-scheme="dark"]) .cpk-ml__filter-seg,
    :host([data-color-scheme="dark"]) .cpk-ml__card {
      border-color: #464957;
      background: #191c24;
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__recall-section {
      background: #171a22;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__filter-seg:hover,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-btn:hover:not(:disabled) {
      background: #20232d;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__filter-seg--active {
      border-color: #777aae;
      background: #292b43;
      color: #d8d9ff;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__content,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-title {
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__filter-count,
    :host([data-color-scheme="dark"]) .cpk-ml__footer-threads,
    :host([data-color-scheme="dark"]) .cpk-ml__footer-id,
    :host([data-color-scheme="dark"]) .cpk-ml__empty,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-clear,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-msg {
      color: #aeb1bd;
    }
  `;

  /** Memories that pass the current text search (before kind filter). */
  private get searchFiltered(): Memory[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.memories;
    return this.memories.filter((m) => m.content.toLowerCase().includes(q));
  }

  /** Memories that pass both search and kind filter. */
  private get filtered(): Memory[] {
    const searched = this.searchFiltered;
    if (this.kind === "all") return searched;
    return searched.filter((m) => m.kind === this.kind);
  }

  /** Count of search-filtered memories for a given kind (for segment labels). */
  private countForKind(kind: Exclude<MemoryKindFilter, "all">): number {
    return this.searchFiltered.filter((m) => m.kind === kind).length;
  }

  private onSearchInput = (event: Event): void => {
    this.search = (event.target as HTMLInputElement).value;
  };

  private onKindClick = (event: Event): void => {
    const seg = (event.target as HTMLElement).closest("[data-kind]");
    if (!seg) return;
    const k = (seg as HTMLElement).dataset["kind"] as MemoryKindFilter;
    this.kind = k;
  };

  /** Truncate an id to first-4…last-4 characters. */
  private shortId(id: string): string {
    if (id.length <= 12) return id;
    return `${id.slice(0, 4)}…${id.slice(-4)}`;
  }

  private renderKindBadge(kind: string): TemplateResult {
    return html`<span class="cpk-ml__kind-badge cpk-ml__kind-badge--${kind}"
      >${kind}</span
    >`;
  }

  private renderScopeBadge(scope: string): TemplateResult {
    const variant = scope === "project" ? "project" : "user";
    return html`<span
      class="cpk-ml__scope-badge cpk-ml__scope-badge--${variant}"
      >${scope}</span
    >`;
  }

  /**
   * Renders one memory card. `relevance` (0..1) is supplied only for recall
   * results — when present a relevance bar is drawn; the full list omits it.
   */
  private renderCard(m: Memory, relevance?: number): TemplateResult {
    const threads = m.sourceThreadIds.length;
    return html`
      <div class="cpk-ml__card">
        <div class="cpk-ml__card-badges">
          ${this.renderKindBadge(m.kind)}${this.renderScopeBadge(m.scope)}
        </div>
        <div class="cpk-ml__content">${m.content}</div>
        ${
          relevance !== undefined
            ? html`<div class="cpk-ml__relevance">
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
          <span class="cpk-ml__footer-id">${this.shortId(m.id)}</span>
        </div>
      </div>
    `;
  }

  private onRecallInput = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value;
    this.recallQueryText = value;
    this.dispatchEvent(
      new CustomEvent<string>("recallQueryChanged", {
        detail: value,
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
            ? html`<p class="cpk-ml__recall-msg cpk-ml__recall-msg--error">
              Recall failed: ${this.recallError}
            </p>`
            : results.length === 0
              ? html`
                  <p class="cpk-ml__recall-msg">No learning records matched that query.</p>
                `
              : results.map((m) =>
                  this.renderCard(m, normalizeRelevance(m.score, max)),
                )
        }
      </section>
    `;
  }

  private renderEmpty(): TemplateResult {
    const q = this.search.trim();
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
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          No learning records yet — tell the agent a durable fact and watch it appear.
        </div>
      `;
    }
    if (q) {
      return html`
        <div class="cpk-ml__empty">
          No learning records match &ldquo;${q}&rdquo;.
        </div>
      `;
    }
    return html`
      <div class="cpk-ml__empty">No ${this.kind} learning records yet.</div>
    `;
  }

  render() {
    const filtered = this.filtered;
    const kinds: Array<Exclude<MemoryKindFilter, "all">> = [
      "topical",
      "episodic",
      "operational",
    ];

    return html`
      <div class="cpk-ml">
        <!-- Semantic recall -->
        ${this.renderRecallForm()} ${this.renderRecallSection()}

        <!-- Search -->
        <div class="cpk-ml__search">
          <input
            type="text"
            placeholder="Search learning…"
            .value=${this.search}
            @input=${this.onSearchInput}
            class="cpk-ml__search-input"
          />
        </div>

        <!-- Kind filter -->
        <div class="cpk-ml__filter" @click=${this.onKindClick}>
          <button
            class="cpk-ml__filter-seg ${
              this.kind === "all" ? "cpk-ml__filter-seg--active" : ""
            }"
            data-kind="all"
          >
            All<span class="cpk-ml__filter-count"
              >${this.searchFiltered.length}</span
            >
          </button>
          ${kinds.map(
            (k) => html`
              <button
                class="cpk-ml__filter-seg ${
                  this.kind === k ? "cpk-ml__filter-seg--active" : ""
                }"
                data-kind="${k}"
              >
                ${k}<span class="cpk-ml__filter-count"
                  >${this.countForKind(k)}</span
                >
              </button>
            `,
          )}
        </div>

        <!-- Memory list -->
        <div class="cpk-ml__list">
          ${filtered.map((m) => this.renderCard(m))}
          ${filtered.length === 0 ? this.renderEmpty() : nothing}
        </div>
      </div>
    `;
  }
}
