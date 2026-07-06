import { LitElement, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { classMap } from "lit/directives/class-map.js";
import { drawerStyles } from "./styles";
import type { DrawerFilter, DrawerThread, LicensedDetail } from "./types";

/** Tag name the element registers under. */
export const COPILOTKIT_THREADS_DRAWER_TAG =
  "copilotkit-threads-drawer" as const;

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
 * Header / control icons for the redesigned drawer chrome (ENT-1051). Inlined
 * lucide glyphs (`search`, `panel-left`, `square-plus`, `filter`,
 * `ellipsis-vertical`) drawn with `currentColor` so they inherit the button's
 * themed color — the element cannot depend on a React icon library.
 */
const iconSearch = html`
  <svg
    class="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
`;
const iconSidebar = html`
  <svg
    class="icon"
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
  </svg>
`;
const iconPlusSquare = html`
  <svg
    class="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M8 12h8" />
    <path d="M12 8v8" />
  </svg>
`;
const iconFunnel = html`
  <svg
    class="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M3 4h18l-7 8v6l-4 2v-8Z" />
  </svg>
`;
const iconKebab = html`
  <svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="12" cy="19" r="1.6" />
  </svg>
`;

/**
 * `<copilotkit-threads-drawer>` — a public, self-contained, controlled, framework-agnostic
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
export class CopilotKitThreadsDrawer extends LitElement {
  static styles = drawerStyles;

  static properties = {
    // Inbound domain properties.
    threads: { attribute: false },
    loading: { type: Boolean },
    error: { type: String },
    activeThreadId: { attribute: "active-thread-id", type: String },
    licensed: { type: Boolean },
    licenseUrl: { attribute: "license-url", type: String },
    hasMore: { attribute: "has-more", type: Boolean },
    fetchingMore: { attribute: "fetching-more", type: Boolean },
    fetchMoreError: { attribute: "fetch-more-error", type: String },
    // Inbound: configurable label for the drawer region and default header.
    label: { type: String },
    // Inbound: configurable "Recent Conversations" section heading text.
    recentLabel: { attribute: "recent-label", type: String },
    // Externally-controllable VIEW state.
    open: { type: Boolean, reflect: true },
    collapsed: { type: Boolean, reflect: true },
    // Internal VIEW state.
    _filter: { state: true },
    _confirmingDeleteId: { state: true },
    _viewportIsMobile: { state: true },
    _hasMemories: { state: true },
    _hasFooter: { state: true },
    _searchOpen: { state: true },
    _searchQuery: { state: true },
    _filterOpen: { state: true },
    _openMenuId: { state: true },
  };

  /**
   * Inbound: accessible + default-header label for the drawer region (screen-reader
   * region name + listbox name + the default header text). Override the visible
   * header independently via the `header` slot. Defaults to `"Threads"`.
   */
  label = "Threads";

  /**
   * Inbound: text for the "Recent Conversations" section heading above the list.
   * Attribute: `recent-label`. Defaults to `"Recent Conversations"`.
   */
  recentLabel = "Recent Conversations";

  /** Inbound: thread records to render. The element re-orders/filters them. */
  threads: DrawerThread[] = [];
  /** Inbound: initial-fetch loading flag. */
  loading = false;
  /** Inbound: initial-fetch error message (actionable Retry shown when set). */
  error: string | null = null;
  /** Inbound: currently-open thread id (drives row selection highlight). */
  activeThreadId: string | null = null;
  /** Inbound: whether the org is licensed for threads; `false` shows the locked view. */
  licensed = true;
  /**
   * Inbound: destination the Upgrade CTA opens (new tab) when the locked view's
   * default button is clicked. Defaults to the CopilotKit Intelligence docs.
   * Set to an empty string to suppress the default navigation and rely solely
   * on the `licensed` event.
   */
  licenseUrl = "https://docs.copilotkit.ai/intelligence";
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
  /** Whether the search input is revealed. */
  private _searchOpen = false;
  /** Current client-side search query (case-insensitive name substring). */
  private _searchQuery = "";
  /** Whether the funnel filter popover (Active/All) is open. */
  private _filterOpen = false;
  /** Id of the row whose kebab actions menu is open (only one at a time). */
  private _openMenuId: string | null = null;

  private _mediaQuery: MediaQueryList | null = null;
  private readonly _onMediaChange = (event: MediaQueryListEvent) => {
    this._viewportIsMobile = event.matches;
  };
  private readonly _onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (this._openMenuId !== null) {
        this._openMenuId = null;
        event.stopPropagation();
        return;
      }
      if (this._filterOpen) {
        this._filterOpen = false;
        event.stopPropagation();
        return;
      }
      if (this._confirmingDeleteId !== null) {
        this._confirmingDeleteId = null;
        event.stopPropagation();
        return;
      }
      if (this._searchOpen) {
        this._searchQuery = "";
        this._searchOpen = false;
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

      // Same reconciliation for an open row-actions menu: if the row whose
      // kebab menu is open is no longer visible (removed/archived/filtered
      // away), close the menu so it cannot linger detached from any row.
      if (this._openMenuId !== null) {
        const stillVisible = this._visibleThreads().some(
          (t) => t.id === this._openMenuId,
        );
        if (!stillVisible) this._openMenuId = null;
      }
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    // Scroll-lock is a mobile-modal concern only.
    if (
      changed.has("open") ||
      changed.has("_viewportIsMobile" as keyof CopilotKitThreadsDrawer)
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

    this._syncNameClipping();
  }

  /**
   * Marks each row whose name text is truncated with `name-clipped`, so the CSS
   * shows the name tooltip ONLY when the full name isn't already visible (an
   * always-on bubble over every row on hover would be noise). Measured after
   * render because truncation depends on the laid-out width.
   */
  private _syncNameClipping(): void {
    const names = this.renderRoot.querySelectorAll<HTMLElement>(".row-name");
    names.forEach((name) => {
      const text = name.querySelector<HTMLElement>(".row-name-text");
      const clipped = !!text && text.scrollWidth > text.clientWidth;
      name.classList.toggle("name-clipped", clipped);
      // The z-index lift in styles.ts (`.row.name-clipped:hover`) targets the
      // `.row` stacking context — each row creates its own via `transform`, so a
      // tooltip anchored on `.row-name` is trapped inside it and paints under
      // later rows unless the row itself is re-floated. Stamp the flag on the
      // owning row too so that rule matches; the tooltip bubble stays scoped to
      // `.row-name:hover`, so hovering a row-action never surfaces it.
      name
        .closest<HTMLElement>(".row")
        ?.classList.toggle("name-clipped", clipped);
    });
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
    // Client-side search: additionally filter the archived-filtered set by a
    // case-insensitive substring of the thread name, BEFORE sorting. A
    // null-named (placeholder) thread has no searchable text, so it matches only
    // the empty query.
    const q = this._searchQuery.trim().toLowerCase();
    const searched =
      q === ""
        ? filtered
        : filtered.filter((t) => (t.name ?? "").toLowerCase().includes(q));
    // Parse to a timestamp; a malformed/absent value yields `null` (NOT epoch 0)
    // so bad data is never silently treated as 1970. Threads with a valid
    // timestamp sort most-recent-first; threads with no parseable timestamp
    // keep their incoming relative order and sort after the dated ones.
    const ts = (t: DrawerThread): number | null => {
      const raw = t.lastRunAt ?? t.updatedAt ?? t.createdAt;
      const parsed = Date.parse(raw);
      return Number.isNaN(parsed) ? null : parsed;
    };
    return [...searched]
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
        aria-label=${this.label}
      >
        ${
          // Collapsed desktop rail: replace the full body with a compact
          // floating cluster (expand + new-conversation). Mobile keeps the
          // modal/launcher path and never collapses to a cluster.
          this.collapsed && !this._viewportIsMobile
            ? html`<div class="collapsed-cluster" part="collapsed-cluster">
                <button
                  class="icon-btn"
                  aria-label="Expand threads"
                  @click=${() => (this.collapsed = false)}
                >
                  ${iconSidebar}
                </button>
                <button
                  class="icon-btn"
                  aria-label="New thread"
                  @click=${() => this._emit("new-thread", {})}
                >
                  ${iconPlusSquare}
                </button>
              </div>`
            : html`${this._renderHeader()} ${this._renderBody()}
              ${this._renderMemories()} ${this._renderFooter()}
              ${this._renderConfirmDialog()}`
        }
      </div>
    `;
  }

  private _renderHeader() {
    return html`
      <div class="header" part="header">
        <button
          class="icon-btn"
          part="search-toggle"
          aria-label="Search threads"
          aria-pressed=${this._searchOpen}
          @click=${() => this._toggleSearch()}
        >
          ${iconSearch}
        </button>
        <button
          class="icon-btn"
          part="collapse-toggle"
          aria-label="Collapse threads"
          @click=${() => (this.collapsed = !this.collapsed)}
        >
          ${iconSidebar}
        </button>
      </div>
      ${this._renderSearch()} ${this._renderNewConversation()}
      ${this._renderSectionHeading()}
    `;
  }

  /** Toggles the search input open/closed. */
  private _toggleSearch() {
    this._searchOpen = !this._searchOpen;
  }

  /**
   * Client-side search input, revealed by the header search toggle. Filtering is
   * applied in `_visibleThreads()`; each keystroke also emits the `search` event
   * so a consumer can observe the query (e.g. for server-side augmentation).
   */
  private _renderSearch() {
    if (!this._searchOpen) return nothing;
    return html`
      <div class="search">
        <input
          class="search-input"
          part="search-input"
          type="search"
          placeholder="Search conversations"
          .value=${this._searchQuery}
          aria-label="Search conversations"
          @input=${(e: Event) =>
            this._onSearchInput((e.target as HTMLInputElement).value)}
        />
      </div>
    `;
  }

  private _onSearchInput(next: string) {
    this._searchQuery = next;
    this._emit("search", { query: next });
  }

  /**
   * Dedicated full-width "New Conversation" row. Keeps `part="new-thread-button"`
   * and fires the existing `new-thread` event, so wrappers/themes that hook the
   * old header pill are unaffected.
   */
  private _renderNewConversation() {
    return html`
      <button
        class="new-conversation"
        part="new-thread-button"
        @click=${() => this._emit("new-thread", {})}
      >
        ${iconPlusSquare}
        <span>New Conversation</span>
      </button>
    `;
  }

  /**
   * "Recent Conversations" section heading with a funnel button that opens the
   * Active/All filter popover. Only shown when the list region is shown
   * (licensed, and not the full-panel error/empty-before-load) — mirrors the
   * old filters gate. The popover options keep `part="filter-active"` /
   * `part="filter-all"` and still emit `filter-change` via `_setFilter`.
   */
  private _renderSectionHeading() {
    if (
      !this.licensed ||
      (hasErrorMessage(this.error) && this.threads.length === 0)
    ) {
      return nothing;
    }
    return html`
      <div class="section-heading" part="section-heading">
        <span class="section-title">${this.recentLabel}</span>
        <button
          class="icon-btn small"
          part="filter-toggle"
          aria-label="Filter threads"
          aria-expanded=${this._filterOpen}
          @click=${() => (this._filterOpen = !this._filterOpen)}
        >
          ${iconFunnel}
        </button>
        ${
          this._filterOpen
            ? html`<div
              class="filter-popover"
              part="filters"
              role="group"
              aria-label="Filter threads"
            >
              <button
                class="filter-opt"
                part="filter-active"
                aria-pressed=${this._filter === "active"}
                @click=${() => {
                  this._setFilter("active");
                  this._filterOpen = false;
                }}
              >
                Active
              </button>
              <button
                class="filter-opt"
                part="filter-all"
                aria-pressed=${this._filter === "all"}
                @click=${() => {
                  this._setFilter("all");
                  this._filterOpen = false;
                }}
              >
                All
              </button>
            </div>`
            : nothing
        }
      </div>
    `;
  }

  private _renderBody() {
    // The locked view beats error: an unlicensed org always sees it, never the
    // initial-fetch error.
    if (!this.licensed) return this._renderLicensed();
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

  /**
   * Handles the Upgrade CTA click in the locked view. Dispatches a cancelable
   * `licensed` event carrying the resolved `licenseUrl`; unless a host calls
   * `preventDefault()`, opens that URL in a new tab. A blank `licenseUrl`
   * suppresses navigation so the event alone drives host behavior.
   */
  private _onLicensedCta(): void {
    const proceed = this.dispatchEvent(
      new CustomEvent("licensed", {
        detail: { licenseUrl: this.licenseUrl } satisfies LicensedDetail,
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    if (proceed && this.licenseUrl && typeof window !== "undefined") {
      window.open(this.licenseUrl, "_blank", "noopener,noreferrer");
    }
  }

  private _renderLicensed() {
    return html`
      <div class="licensed" part="licensed" data-testid="drawer-licensed">
        <slot name="licensed">
          <p>Threads are a CopilotKit Intelligence feature.</p>
          <button
            class="primary"
            part="licensed-cta"
            @click=${() => this._onLicensedCta()}
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
      <ul class="list" part="list" role="listbox" aria-label=${this.label}>
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

    const menuOpen = this._openMenuId === thread.id;

    const rowClasses = {
      row: true,
      active: isActive,
      archived: thread.archived,
      "menu-open": menuOpen,
    };
    const nameClasses = {
      "row-name": true,
      placeholder: !hasName,
      revealed: justRevealed,
    };
    const slotName = rowSlotName(thread.id);
    // A long thread name is clipped with an ellipsis. The full name is exposed
    // via a tooltip styled to match the row-action tooltips (an instant primary
    // bubble, NOT the native `title`), shown only when the name is actually
    // truncated (`name-clipped`, toggled in `_syncNameClipping`). The name text
    // lives in an inner span that owns the ellipsis, so the outer `.row-name`
    // can host the tooltip pseudo-element without its own `overflow: hidden`
    // clipping it.
    const nameSpan = html`<span
      class=${classMap(nameClasses)}
      part="row-name"
      data-tooltip=${hasName ? thread.name : nothing}
    >
      <span class="row-name-text"
        >${hasName ? thread.name : "New thread"}</span
      >
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
        <button
          class="row-menu"
          part="row-menu"
          aria-label=${`Actions for ${thread.name ?? "New thread"}`}
          aria-haspopup="menu"
          aria-expanded=${menuOpen}
          @click=${(e: Event) => {
            e.stopPropagation();
            this._openMenuId = menuOpen ? null : thread.id;
          }}
        >
          ${iconKebab}
        </button>
        ${
          menuOpen
            ? html`<div
              class="row-menu-popover"
              part="row-menu-popover"
              role="menu"
            >
              ${
                thread.archived
                  ? html`<button
                    class="row-menu-item"
                    part="row-unarchive"
                    role="menuitem"
                    aria-label=${`Unarchive thread ${thread.name ?? "New thread"}`}
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this._openMenuId = null;
                      this._emit("unarchive", { threadId: thread.id });
                    }}
                  >
                    ${iconUnarchive}<span>Unarchive</span>
                  </button>`
                  : html`<button
                    class="row-menu-item"
                    part="row-archive"
                    role="menuitem"
                    aria-label=${`Archive thread ${thread.name ?? "New thread"}`}
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this._openMenuId = null;
                      this._emit("archive", { threadId: thread.id });
                    }}
                  >
                    ${iconArchive}<span>Archive</span>
                  </button>`
              }
              <button
                class="row-menu-item danger"
                part="row-delete"
                role="menuitem"
                aria-label=${`Delete thread ${thread.name ?? "New thread"}`}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._openMenuId = null;
                  this._confirmingDeleteId = thread.id;
                }}
              >
                ${iconDelete}<span>Delete</span>
              </button>
            </div>`
            : nothing
        }
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
    if (this.hasMore) {
      return html`
        <button
          class="load-more"
          part="load-more"
          @click=${() => this._emit("load-more", {})}
        >
          Load more
        </button>
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
