import { LitElement, html, nothing, type PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { classMap } from "lit/directives/class-map.js";
import { drawerStyles } from "./styles";
import type { DrawerFilter, DrawerThread } from "./types";

/** Tag name the element registers under. */
export const COPILOTKIT_DRAWER_TAG = "copilotkit-drawer" as const;

/** Mobile breakpoint (px). At or below this width the drawer is a modal overlay. */
const MOBILE_BREAKPOINT = 768;

/**
 * Whether an inbound error message should surface an error state. Only a
 * non-empty, non-whitespace string counts — `null`, `""`, and whitespace-only
 * strings are treated as "no error" so an empty error never conflates with a
 * real one (and never blanks the list behind an empty error panel).
 */
function hasErrorMessage(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

/**
 * Builds the per-row slot name (`row:<id>`) used for consumer projection, but
 * only when the thread id is safe to embed in a slot `name` / `slot` attribute
 * token. A slot name is matched character-for-character against the consumer's
 * `slot="..."` attribute; whitespace splits attribute tokens and quotes/angle
 * brackets can break attribute serialization, so an id containing any of those
 * would silently fail projection. For such an id we return `null` and the row
 * renders its default name span (no per-row slot), which is the safe fallback.
 */
function rowSlotName(id: string): string | null {
  // Reject whitespace and characters that are unsafe in an HTML attribute token.
  if (id.length === 0 || /[\s"'<>=]/.test(id)) return null;
  return `row:${id}`;
}

/**
 * Inline row-action icons. The element is framework-agnostic Lit, so it cannot
 * depend on a React icon library — these are the lucide `archive`,
 * `archive-restore`, and `trash-2` glyphs inlined as SVG, drawn with
 * `currentColor` so they inherit the button's themed color.
 */
const iconArchive = html`
  <svg
    class="row-action-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </svg>
`;
const iconUnarchive = html`
  <svg
    class="row-action-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h2" />
    <path d="M20 8v11a2 2 0 0 1-2 2h-2" />
    <path d="m9 15 3-3 3 3" />
    <path d="M12 12v9" />
  </svg>
`;
const iconDelete = html`
  <svg
    class="row-action-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M3 6h18" />
    <path
      d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
    />
    <line x1="10" x2="10" y1="11" y2="17" />
    <line x1="14" x2="14" y1="11" y2="17" />
  </svg>
`;
const iconLauncher = html`
  <svg
    class="launcher-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d="m14 9 3 3-3 3" />
  </svg>
`;

/**
 * `<copilotkit-drawer>` — a public, self-contained, controlled, framework-agnostic
 * threads drawer rendered into a shadow root.
 *
 * Pure VIEW: domain data (threads/loading/error/etc.) comes IN as properties and
 * user intent goes OUT as bubbling+composed DOM `CustomEvent`s. The element owns
 * VIEW state (open/collapsed, Active/All filter, confirm-delete dialog, per-row
 * animations) while the consumer owns DOMAIN state. `open` is additionally
 * externally controllable via the `open` property + `open-change` event so a
 * host can coordinate mobile open/close.
 *
 * The element is AUTHORITATIVE over row order and the Active/All filter.
 */
export class CopilotKitDrawer extends LitElement {
  static styles = drawerStyles;

  static properties = {
    // Inbound domain properties.
    threads: { attribute: false },
    loading: { type: Boolean },
    error: { type: String },
    activeThreadId: { attribute: "active-thread-id", type: String },
    licensed: { type: Boolean },
    hasMore: { attribute: "has-more", type: Boolean },
    fetchingMore: { attribute: "fetching-more", type: Boolean },
    fetchMoreError: { attribute: "fetch-more-error", type: String },
    // Externally-controllable VIEW state.
    open: { type: Boolean, reflect: true },
    collapsed: { type: Boolean, reflect: true },
    // Internal VIEW state.
    _filter: { state: true },
    _confirmingDeleteId: { state: true },
    _viewportIsMobile: { state: true },
    _hasMemories: { state: true },
    _hasFooter: { state: true },
  };

  /** Inbound: thread records to render. The element re-orders/filters them. */
  threads: DrawerThread[] = [];
  /** Inbound: initial-fetch loading flag. */
  loading = false;
  /** Inbound: initial-fetch error message (actionable Retry shown when set). */
  error: string | null = null;
  /** Inbound: currently-open thread id (drives row selection highlight). */
  activeThreadId: string | null = null;
  /** Inbound: whether the org is licensed for threads; `false` shows upsell. */
  licensed = true;
  /** Inbound: whether more pages are available. */
  hasMore = false;
  /** Inbound: whether a fetch-more is in flight. */
  fetchingMore = false;
  /** Inbound: fetch-more error message (inline, list preserved). */
  fetchMoreError: string | null = null;

  /** Externally-controllable: whether the drawer is open (mobile coordination). */
  open = true;
  /** Externally-controllable: whether the drawer is collapsed to a rail (desktop). */
  collapsed = false;

  private _filter: DrawerFilter = "active";
  private _confirmingDeleteId: string | null = null;
  private _viewportIsMobile = false;
  private _hasMemories = false;
  private _hasFooter = false;

  private _mediaQuery: MediaQueryList | null = null;
  private readonly _onMediaChange = (event: MediaQueryListEvent) => {
    this._viewportIsMobile = event.matches;
  };
  private readonly _onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (this._confirmingDeleteId !== null) {
        this._confirmingDeleteId = null;
        event.stopPropagation();
        return;
      }
      if (this._viewportIsMobile && this.open) {
        this._setOpen(false);
        event.stopPropagation();
      }
      return;
    }
    // Tab focus-trap for the mobile modal. Handled at the HOST (not on `.root`)
    // so it fires wherever focus sits in the shadow root — including the
    // backdrop button, which renders as a sibling OUTSIDE `.root`. A trap bound
    // only to `.root` lets Tab from the backdrop (or any out-of-root node)
    // escape the modal to the page behind it.
    if (event.key === "Tab") {
      this._trapTab(event);
    }
  };

  /** Thread ids previously seen as named, so we can animate the null→named reveal. */
  private readonly _seenNamed = new Set<string>();
  /** Thread ids whose name just transitioned null→named in this update cycle. */
  private _justRevealed = new Set<string>();

  override connectedCallback(): void {
    super.connectedCallback();
    if (typeof window !== "undefined" && window.matchMedia) {
      this._mediaQuery = window.matchMedia(
        `(max-width: ${MOBILE_BREAKPOINT}px)`,
      );
      this._viewportIsMobile = this._mediaQuery.matches;
      this._mediaQuery.addEventListener("change", this._onMediaChange);
    }
    this.addEventListener("keydown", this._onKeyDown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._mediaQuery?.removeEventListener("change", this._onMediaChange);
    this.removeEventListener("keydown", this._onKeyDown);
    this._releaseScrollLock();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Compute the null→named reveal set BEFORE render, so render stays pure.
    if (changed.has("threads")) {
      const presentIds = new Set<string>();
      const revealed = new Set<string>();
      for (const thread of this.threads) {
        presentIds.add(thread.id);
        const hasName = thread.name !== null && thread.name !== "";
        if (hasName && !this._seenNamed.has(thread.id)) {
          revealed.add(thread.id);
        }
        if (hasName) this._seenNamed.add(thread.id);
      }
      // Prune ids no longer present so `_seenNamed` cannot grow without bound
      // across a long-lived, high-churn session.
      for (const id of this._seenNamed) {
        if (!presentIds.has(id)) this._seenNamed.delete(id);
      }
      this._justRevealed = revealed;

      // Auto-dismiss a pending confirm-delete whose target is no longer in the
      // visible threads (the consumer removed/archived/filtered it away while
      // the dialog was open). Without this the dialog could emit `delete` with a
      // stale id. Reconciled against the SAME visible set the user is acting on.
      if (this._confirmingDeleteId !== null) {
        const stillVisible = this._visibleThreads().some(
          (t) => t.id === this._confirmingDeleteId,
        );
        if (!stillVisible) this._confirmingDeleteId = null;
      }
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    // Scroll-lock is a mobile-modal concern only.
    if (
      changed.has("open") ||
      changed.has("_viewportIsMobile" as keyof CopilotKitDrawer)
    ) {
      if (this._isMobileModalOpen()) {
        this._applyScrollLock();
        this._focusFirstFocusable();
      } else {
        this._releaseScrollLock();
      }
    }

    // The reveal animation fires exactly once per real name-arrival. Clearing
    // the set after the render that applied the `revealed` class prevents any
    // later, unrelated re-render from re-adding the class and re-firing the
    // animation. `_justRevealed` is a plain field (not reactive), so resetting
    // it here does not schedule another update.
    if (this._justRevealed.size > 0) {
      this._justRevealed = new Set<string>();
    }
  }

  // --- View-state helpers ----------------------------------------------------

  private _isMobileModalOpen(): boolean {
    return this._viewportIsMobile && this.open;
  }

  private _setOpen(next: boolean): void {
    if (this.open === next) return;
    this.open = next;
    this._emit("open-change", { open: next });
  }

  private _setFilter(next: DrawerFilter): void {
    if (this._filter === next) return;
    this._filter = next;
    this._emit("filter-change", { filter: next });
  }

  /**
   * Element-authoritative ordering + filtering. Active filter hides archived
   * threads; ordering is most-recent-first by `lastRunAt`/`updatedAt`.
   */
  private _visibleThreads(): DrawerThread[] {
    const filtered =
      this._filter === "active"
        ? this.threads.filter((t) => !t.archived)
        : this.threads;
    // Parse to a timestamp; a malformed/absent value yields `null` (NOT epoch 0)
    // so bad data is never silently treated as 1970. Threads with a valid
    // timestamp sort most-recent-first; threads with no parseable timestamp
    // keep their incoming relative order and sort after the dated ones.
    const ts = (t: DrawerThread): number | null => {
      const raw = t.lastRunAt ?? t.updatedAt ?? t.createdAt;
      const parsed = Date.parse(raw);
      return Number.isNaN(parsed) ? null : parsed;
    };
    return [...filtered]
      .map((thread, index) => ({ thread, index, ts: ts(thread) }))
      .sort((a, b) => {
        if (a.ts === null && b.ts === null) return a.index - b.index;
        if (a.ts === null) return 1;
        if (b.ts === null) return -1;
        if (a.ts !== b.ts) return b.ts - a.ts;
        return a.index - b.index;
      })
      .map((entry) => entry.thread);
  }

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  }

  // --- Scroll lock + focus (mobile modal only) -------------------------------

  private _scrollLocked = false;
  private _prevBodyOverflow = "";

  private _applyScrollLock(): void {
    if (this._scrollLocked || typeof document === "undefined") return;
    this._prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    this._scrollLocked = true;
  }

  private _releaseScrollLock(): void {
    if (!this._scrollLocked || typeof document === "undefined") return;
    document.body.style.overflow = this._prevBodyOverflow;
    this._scrollLocked = false;
  }

  /**
   * Returns the focusable elements in the composed/flattened tree of the drawer
   * root, INCLUDING slotted light-DOM content (so a focus trap covers slotted
   * rows). Walks assigned nodes of each `<slot>`.
   */
  private _composedFocusable(): HTMLElement[] {
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const out: HTMLElement[] = [];
    // The backdrop button is a modal-owned focusable rendered as a sibling of
    // `.root`. Include it first (it precedes `.root` in DOM order) so the focus
    // trap treats it as part of the modal's cycle rather than an escape hatch.
    const backdrop = this.renderRoot.querySelector<HTMLElement>(".backdrop");
    if (backdrop) out.push(backdrop);
    const root = this.renderRoot.querySelector(".root");
    if (!root) return out;
    const collect = (node: ParentNode) => {
      node
        .querySelectorAll<HTMLElement>(selector)
        .forEach((el) => out.push(el));
    };
    collect(root);
    root.querySelectorAll("slot").forEach((slot) => {
      (slot as HTMLSlotElement)
        .assignedElements({ flatten: true })
        .forEach((assigned) => {
          if (assigned.matches(selector)) out.push(assigned as HTMLElement);
          collect(assigned);
        });
    });
    return out;
  }

  private _focusFirstFocusable(): void {
    // Defer so the rendered tree exists.
    queueMicrotask(() => {
      const focusable = this._composedFocusable();
      // Prefer the first real control over the backdrop scrim so opening the
      // modal lands focus on actionable content, not the close-on-click overlay
      // (the backdrop is still part of the trap cycle below).
      const backdrop = this.renderRoot.querySelector(".backdrop");
      const target = focusable.find((el) => el !== backdrop) ?? focusable[0];
      target?.focus();
    });
  }

  private readonly _trapTab = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || !this._isMobileModalOpen()) return;
    const focusable = this._composedFocusable();
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active =
      (this.renderRoot as ShadowRoot).activeElement ?? document.activeElement;
    if (event.shiftKey && active === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && active === last) {
      first.focus();
      event.preventDefault();
    }
  };

  // --- Render ----------------------------------------------------------------

  override render() {
    const rootClasses = {
      root: true,
      collapsed: this.collapsed && !this._viewportIsMobile,
      mobile: this._viewportIsMobile,
      open: this.open,
      // Suppresses row-action tooltips while the confirm dialog is open (the
      // clicked trash button keeps :focus-visible/:hover otherwise).
      confirming: this._confirmingDeleteId !== null,
    };

    return html`
      ${
        // Mobile open-affordance: when the drawer is a closed off-canvas modal,
        // render its own floating launcher so there is always a way to open it
        // on phones WITHOUT the host wiring a header button. Desktop (persistent
        // sidebar) and the open state never show it.
        this._viewportIsMobile && !this.open
          ? html`<button
            class="launcher"
            part="launcher"
            aria-label="Open threads"
            @click=${() => this._setOpen(true)}
          >
            <slot name="launcher-icon">${iconLauncher}</slot>
          </button>`
          : nothing
      }
      ${
        this._isMobileModalOpen()
          ? html`<button
            class="backdrop"
            part="backdrop"
            aria-label="Close threads drawer"
            @click=${() => this._setOpen(false)}
          ></button>`
          : nothing
      }
      <div
        class=${classMap(rootClasses)}
        part="root"
        role=${this._isMobileModalOpen() ? "dialog" : "region"}
        aria-modal=${this._isMobileModalOpen() ? "true" : nothing}
        aria-label="Threads"
      >
        ${this._renderHeader()} ${this._renderBody()} ${this._renderMemories()}
        ${this._renderFooter()} ${this._renderConfirmDialog()}
      </div>
    `;
  }

  private _renderHeader() {
    return html`
      <div class="header" part="header">
        <slot name="header"><span>Threads</span></slot>
        <button
          class="primary"
          part="new-thread-button"
          aria-label="New thread"
          @click=${() => this._emit("new-thread", {})}
        >
          + New
        </button>
      </div>
      ${
        this.licensed &&
        (!hasErrorMessage(this.error) || this.threads.length > 0)
          ? html`
            <div class="filters" part="filters" role="group" aria-label="Filter threads">
              <button
                class="filter-btn"
                part="filter-active"
                aria-pressed=${this._filter === "active"}
                @click=${() => this._setFilter("active")}
              >
                Active
              </button>
              <button
                class="filter-btn"
                part="filter-all"
                aria-pressed=${this._filter === "all"}
                @click=${() => this._setFilter("all")}
              >
                All
              </button>
            </div>
          `
          : nothing
      }
    `;
  }

  private _renderBody() {
    // Upsell beats error: an unlicensed org always sees the upsell, never the
    // initial-fetch error.
    if (!this.licensed) return this._renderUpsell();
    // The full-panel error replaces the list ONLY when there is nothing to show
    // (a failed initial fetch). The bound `error` reflects the core store error,
    // which a failed mutation (delete/rename/archive) also sets — a delete
    // rollback restores its row, so when threads are still present we keep the
    // list visible rather than blanking it behind a "couldn't load" panel.
    if (hasErrorMessage(this.error) && this.threads.length === 0) {
      return this._renderError();
    }
    // Full-panel loading only when there is nothing to show yet (initial fetch).
    // A refetch (e.g. filter toggle Active<->All) keeps `loading` true while the
    // list is already populated — keep showing the known threads rather than
    // flashing the loading state over them.
    if (this.loading && this.threads.length === 0) return this._renderLoading();
    return this._renderList();
  }

  private _renderUpsell() {
    return html`
      <div class="upsell" part="upsell" data-testid="drawer-upsell">
        <slot name="upsell">
          <p>Threads are a CopilotKit Intelligence feature.</p>
          <button
            class="primary"
            part="upsell-cta"
            @click=${() => this._emit("upsell", {})}
          >
            Upgrade
          </button>
        </slot>
      </div>
    `;
  }

  private _renderError() {
    return html`
      <div class="state error" part="error" role="alert" data-testid="drawer-error">
        <p>${this.error}</p>
        <button
          class="primary"
          part="retry-button"
          @click=${() => this._emit("retry", { scope: "initial" })}
        >
          Retry
        </button>
      </div>
    `;
  }

  private _renderLoading() {
    return html`
      <div class="state" part="loading" data-testid="drawer-loading" aria-busy="true">
        Loading threads…
      </div>
    `;
  }

  private _renderList() {
    const visible = this._visibleThreads();
    if (visible.length === 0) {
      return html`
        <div class="state" part="empty" data-testid="drawer-empty">
          <slot name="empty">No threads yet.</slot>
        </div>
      `;
    }
    return html`
      <ul class="list" part="list" role="listbox" aria-label="Threads">
        ${repeat(
          visible,
          (thread) => thread.id,
          (thread) => this._renderRow(thread),
        )}
      </ul>
      ${this._renderFetchMore()}
    `;
  }

  private _renderRow(thread: DrawerThread) {
    const isActive = thread.id === this.activeThreadId;
    const hasName = thread.name !== null && thread.name !== "";
    const justRevealed = this._justRevealed.has(thread.id);

    const rowClasses = {
      row: true,
      active: isActive,
      archived: thread.archived,
    };
    const nameClasses = {
      "row-name": true,
      placeholder: !hasName,
      revealed: justRevealed,
    };
    const slotName = rowSlotName(thread.id);
    const nameSpan = html`<span
      class=${classMap(nameClasses)}
      part="row-name"
    >
      ${hasName ? thread.name : "New thread"}
    </span>`;

    return html`
      <li
        class=${classMap(rowClasses)}
        part=${isActive ? "row row-active" : "row"}
        role="option"
        aria-selected=${isActive ? "true" : "false"}
        tabindex="0"
        data-thread-id=${thread.id}
        @click=${() => this._emit("thread-selected", { threadId: thread.id })}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this._emit("thread-selected", { threadId: thread.id });
          }
        }}
      >
        ${
          slotName !== null
            ? html`<slot name=${slotName}>${nameSpan}</slot>`
            : nameSpan
        }
        ${
          thread.archived
            ? html`<button
              class="row-action"
              part="row-unarchive"
              data-tooltip="Unarchive"
              aria-label=${`Unarchive thread ${thread.name ?? "New thread"}`}
              @click=${(e: Event) => {
                e.stopPropagation();
                this._emit("unarchive", { threadId: thread.id });
              }}
            >
              ${iconUnarchive}
            </button>`
            : html`<button
              class="row-action"
              part="row-archive"
              data-tooltip="Archive"
              aria-label=${`Archive thread ${thread.name ?? "New thread"}`}
              @click=${(e: Event) => {
                e.stopPropagation();
                this._emit("archive", { threadId: thread.id });
              }}
            >
              ${iconArchive}
            </button>`
        }
        <button
          class="row-action danger"
          part="row-delete"
          data-tooltip="Delete"
          aria-label=${`Delete thread ${thread.name ?? "New thread"}`}
          @click=${(e: Event) => {
            e.stopPropagation();
            this._confirmingDeleteId = thread.id;
          }}
        >
          ${iconDelete}
        </button>
      </li>
    `;
  }

  private _renderFetchMore() {
    if (hasErrorMessage(this.fetchMoreError)) {
      return html`
        <div class="fetch-more-error" part="fetch-more-error" role="alert">
          Couldn't load more —
          <button
            class="row-action"
            part="fetch-more-retry"
            @click=${() => this._emit("retry", { scope: "fetch-more" })}
          >
            retry
          </button>
        </div>
      `;
    }
    if (this.fetchingMore) {
      return html`
        <div class="state" part="fetching-more" aria-busy="true">Loading more…</div>
      `;
    }
    return nothing;
  }

  private _renderMemories() {
    // Reserved region — hidden until a consumer projects content into the slot.
    // A `slotchange` listener drives `_hasMemories` so light-DOM mutations after
    // first render reactively reveal/hide the region.
    return html`
      <div class="memories" part="memories" ?hidden=${!this._hasMemories}>
        <slot
          name="memories"
          @slotchange=${(e: Event) => {
            const slot = e.target as HTMLSlotElement;
            this._hasMemories = slot.assignedElements().length > 0;
          }}
        ></slot>
      </div>
    `;
  }

  private _renderFooter() {
    // Reserved region — hidden until a consumer projects content into the
    // `footer` slot. Without this gate the footer's top border + padding render
    // as an empty box at the bottom of the drawer. Mirrors `_renderMemories`.
    return html`
      <div class="footer" part="footer" ?hidden=${!this._hasFooter}>
        <slot
          name="footer"
          @slotchange=${(e: Event) => {
            const slot = e.target as HTMLSlotElement;
            this._hasFooter = slot.assignedElements().length > 0;
          }}
        ></slot>
      </div>
    `;
  }

  private _renderConfirmDialog() {
    if (this._confirmingDeleteId === null) return nothing;
    const id = this._confirmingDeleteId;
    return html`
      <div class="dialog-backdrop" part="dialog-backdrop">
        <div
          class="dialog"
          part="confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirm delete"
          data-testid="drawer-confirm-delete"
        >
          <p>Delete this thread? This cannot be undone.</p>
          <div class="dialog-actions">
            <button
              class="row-action"
              part="confirm-cancel"
              @click=${() => (this._confirmingDeleteId = null)}
            >
              Cancel
            </button>
            <button
              class="primary"
              part="confirm-delete"
              @click=${() => {
                this._confirmingDeleteId = null;
                this._emit("delete", { threadId: id });
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
