import type { ɵThread } from "@copilotkit/core";
import { html, nothing } from "lit";
import { PortableLitElement } from "../../../ui/portable-lit-element.js";
import { threadListStyles } from "./thread-list.styles.js";

type ExampleThread = ɵThread & { isExample: true };

export class CpkThreadList extends PortableLitElement {
  static properties = {
    threads: { attribute: false },
    selectedThreadId: { attribute: false },
    inAppThreadId: { attribute: false },
    errorMessage: { attribute: false },
    suppressEmptyState: { attribute: false },
    _query: { state: true },
  };
  threads: ɵThread[] = [];
  selectedThreadId: string | null = null;
  inAppThreadId: string | null = null;
  /**
   * Non-null when the underlying thread store reported a load error
   * (REST list rejection, Phoenix subscribe failure, retry exhaustion).
   * Surfaced inline so users see a real error state instead of stale or
   * empty data with no indication of what went wrong.
   */
  errorMessage: string | null = null;
  suppressEmptyState = false;
  private _query = "";

  static styles = threadListStyles;

  private relativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
  }

  private get filtered(): ɵThread[] {
    const q = this._query.toLowerCase();
    if (!q) return this.threads;
    return this.threads.filter(
      (t) =>
        (t.name?.toLowerCase().includes(q) ?? false) ||
        t.agentId.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q),
    );
  }

  private onThreadClick(threadId: string): void {
    this.dispatchEvent(
      new CustomEvent("threadSelected", {
        detail: threadId,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onSearchInput = (event: Event): void => {
    this._query = (event.target as HTMLInputElement).value;
  };

  render() {
    const filtered = this.filtered;
    return html`
      <div class="cpk-tl">
        <!-- Search -->
        <div class="cpk-tl__search">
          <input
            type="text"
            placeholder="Search threads…"
            .value=${this._query}
            @input=${this.onSearchInput}
            class="cpk-tl__search-input"
          />
        </div>

        <!-- Thread list -->
        <div class="cpk-tl__list">
          ${filtered.map(
            (thread) => html`
              <button
                type="button"
                aria-current=${
                  this.selectedThreadId === thread.id ? "true" : nothing
                }
                class="cpk-tl__item ${
                  this.selectedThreadId === thread.id
                    ? "cpk-tl__item--active"
                    : ""
                }"
                @click=${() => this.onThreadClick(thread.id)}
              >
                <span class="cpk-tl__row1">
                  <span
                    class="cpk-tl__name ${
                      !thread.name ? "cpk-tl__name--unnamed" : ""
                    }"
                    >${thread.name ?? "Untitled"}</span
                  >
                  <span class="cpk-tl__time"
                    >${this.relativeTime(thread.updatedAt)}</span
                  >
                </span>
                <span class="cpk-tl__meta">
                  <span class="cpk-tl__pill">${thread.agentId}</span>
                  ${
                    (thread as Partial<ExampleThread>).isExample
                      ? html`
                          <span class="cpk-tl__pill cpk-tl__pill--example">Example</span>
                        `
                      : nothing
                  }
                  ${
                    this.inAppThreadId === thread.id
                      ? html`
                          <span class="cpk-tl__pill cpk-tl__pill--in-app">In app</span>
                        `
                      : nothing
                  }
                </span>
              </button>
            `,
          )}
          ${
            filtered.length === 0 && !this.suppressEmptyState
              ? html`
                <div class="cpk-tl__empty">
                  ${
                    this.errorMessage
                      ? html`
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="cpk-tl__empty-icon"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <div>
                          Failed to load threads
                          <div
                            style="font-size:11px;margin-top:4px;color:#c0333a;"
                          >
                            ${this.errorMessage}
                          </div>
                        </div>
                      `
                      : this.threads.length === 0
                        ? html`
                            <svg
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.5"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              class="cpk-tl__empty-icon"
                            >
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            No threads yet
                          `
                        : html`
                            No threads match your search.
                          `
                  }
                </div>
              `
              : nothing
          }
        </div>
      </div>
    `;
  }
}
