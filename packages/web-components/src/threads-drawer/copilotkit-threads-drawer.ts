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
// Sidebar/panel glyph (the Figma toggle icon). Used for the desktop collapse
// toggle, the desktop collapsed cluster's expand toggle, the mobile launcher
// (open), and the mobile header dismiss (close) — the toggle glyph is identical
// in every state, matching the Figma.
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

/**
 * Header / control icons for the redesigned drawer chrome (ENT-1051). Inlined
 * lucide glyphs (`square-plus`, `filter`, `ellipsis-vertical`) drawn with
 * `currentColor` so they inherit the button's themed color — the element cannot
 * depend on a React icon library.
 */
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
    <line x1="3" y1="5" x2="21" y2="5" />
    <line x1="6" y1="12" x2="18" y2="12" />
    <line x1="10" y1="19" x2="14" y2="19" />
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
 * VIEW state (open, Active/All filter, confirm-delete dialog, per-row
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
    collapsible: { type: Boolean },
    // Externally-controllable VIEW state.
    open: { type: Boolean, reflect: true },
    collapsed: { type: Boolean, reflect: true },
    // Internal VIEW state.
    _filter: { state: true },
    _confirmingDeleteId: { state: true },
    _viewportIsMobile: { state: true },
    _hasHeader: { state: true },
    _hasMemories: { state: true },
    _hasFooter: { state: true },
    _filterOpen: { state: true },
    _openMenuId: { state: true },
  };

  /**
   * Inbound: accessible label for the drawer region — drives the screen-reader
   * region name (on `.root`) and the listbox name (on `.list`) ONLY. The
   * redesign has no visible title; project visible header chrome via the
   * optional `header` slot instead. Defaults to `"Threads"`.
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

  /**
   * Externally-controllable: whether the drawer is open (mobile coordination).
   * Defaults to `false` so a mobile-width first render does NOT paint the open
   * modal (backdrop + body scroll-lock + focus steal) for one frame before a
   * wrapper's post-mount effect can close it. Desktop is unaffected — only
   * `.root.mobile.open` / `_isMobileModalOpen()` consume `open`.
   */
  open = false;
  /**
   * Externally-controllable: whether the drawer is collapsed to the floating
   * cluster on desktop. Defaults to `false` (expanded). Reflected so hosts can
   * theme on `[collapsed]`. Ignored on mobile, where open/closed governs the
   * off-canvas modal instead.
   */
  collapsed = false;
  /**
   * Inbound: whether the user may collapse the drawer on desktop. Defaults to
   * `true`. When `false` the header omits the collapse toggle and the drawer
   * NEVER renders the collapsed cluster on desktop (it stays expanded even if
   * `collapsed` is set) — mobile off-canvas open/close is independent.
   */
  collapsible = true;

  private _filter: DrawerFilter = "active";
  private _confirmingDeleteId: string | null = null;
  private _viewportIsMobile = false;
  private _hasHeader = false;
  private _hasMemories = false;
  private _hasFooter = false;
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
      // The confirm-delete <dialog> is opened with showModal(): the browser
      // dismisses it natively via the dialog's `cancel` event. But that Escape
      // keydown still bubbles from the modal to this host handler, so we must
      // stop here — otherwise it falls through to the mobile branch below and
      // closes the whole drawer along with the confirmation.
      if (this._confirmingDeleteId !== null) {
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

  /**
   * Dismisses the funnel filter popover and/or an open row-actions menu when a
   * pointerdown lands outside them. Bound to `document` (composed events bubble
   * out of the shadow root), so we discriminate inside vs. outside via
   * `composedPath()` rather than target identity. A click on a popover's own
   * trigger is treated as "inside" so its own `@click` toggle handles the close
   * (avoids a double-toggle that would immediately reopen it).
   */
  private readonly _onDocumentPointerDown = (event: Event) => {
    if (!this._filterOpen && this._openMenuId === null) return;
    const path = event.composedPath();
    if (this._filterOpen) {
      const popover = this.renderRoot.querySelector('[part="filters"]');
      const trigger = this.renderRoot.querySelector('[part="filter-toggle"]');
      const inside =
        (popover && path.includes(popover)) ||
        (trigger && path.includes(trigger));
      if (!inside) this._filterOpen = false;
    }
    if (this._openMenuId !== null) {
      const popover = this.renderRoot.querySelector(
        '[part="row-menu-popover"]',
      );
      const trigger = this.renderRoot.querySelector(
        '.row.menu-open [part="row-menu"]',
      );
      const inside =
        (popover && path.includes(popover)) ||
        (trigger && path.includes(trigger));
      if (!inside) this._openMenuId = null;
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
    if (typeof document !== "undefined") {
      document.addEventListener("pointerdown", this._onDocumentPointerDown);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._mediaQuery?.removeEventListener("change", this._onMediaChange);
    this.removeEventListener("keydown", this._onKeyDown);
    if (typeof document !== "undefined") {
      document.removeEventListener("pointerdown", this._onDocumentPointerDown);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("scroll", this._repositionConfirm, true);
      window.removeEventListener("resize", this._repositionConfirm);
    }
    // Release the reserved-width override we may have set on the document root.
    if (typeof document !== "undefined") {
      document.documentElement.style.removeProperty(
        "--cpk-drawer-reserved-width",
      );
    }
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

    // Reclaim the reserved layout column when the desktop collapse state (or the
    // viewport) changes.
    if (
      changed.has("collapsed") ||
      changed.has("collapsible") ||
      changed.has("_viewportIsMobile" as keyof CopilotKitThreadsDrawer)
    ) {
      this._syncReservedWidth();
    }

    // Drive the native top-layer <dialog> from the confirm state. Opening with
    // showModal() places it in the browser top layer (above every stacking
    // context) so it is never clipped; we then re-center it over the drawer
    // panel via _positionConfirmDialog(). Feature-detect showModal/close because
    // jsdom implements neither — fall back to toggling the `open` attribute so
    // unit tests still observe the open/closed state.
    const dialog = this.renderRoot.querySelector("dialog");
    if (dialog) {
      const id = this._confirmingDeleteId;
      if (id !== null && !dialog.open) {
        typeof dialog.showModal === "function"
          ? dialog.showModal()
          : dialog.setAttribute("open", "");
        this._positionConfirmDialog();
        window.addEventListener("scroll", this._repositionConfirm, true);
        window.addEventListener("resize", this._repositionConfirm);
      } else if (id === null && dialog.open) {
        typeof dialog.close === "function"
          ? dialog.close()
          : dialog.removeAttribute("open");
        window.removeEventListener("scroll", this._repositionConfirm, true);
        window.removeEventListener("resize", this._repositionConfirm);
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

  private _setCollapsed(next: boolean): void {
    if (this.collapsed === next) return;
    this.collapsed = next;
    this._emit("collapse-change", { collapsed: next });
  }

  /**
   * Signal the drawer's reserved layout width to the host so a desktop collapse
   * reclaims the column instead of leaving an empty gap. On desktop-collapse we
   * set `--cpk-drawer-reserved-width: 0px` on the document root; a host whose
   * grid reads `grid-template-columns: var(--cpk-drawer-reserved-width, 320px) …`
   * inherits it and collapses the track (with its own transition). Expanded/mobile
   * clears the override so the host's fallback width applies — which also means
   * the default (expanded) render never sets it, so there is no hydration flicker.
   *
   * It is set on `document.documentElement` (not `parentElement`) BECAUSE the
   * element is nested inside a framework wrapper host, so its parent is the
   * wrapper — not the grid container, which is an ancestor a child's custom
   * property can't reach. `:root` inheritance reaches the grid regardless of
   * wrapper nesting. Best-effort + namespaced, single-drawer-per-document; a host
   * with multiple drawers or a custom layout should instead react to the
   * `collapse-change` event.
   */
  private _syncReservedWidth(): void {
    if (typeof document === "undefined") return;
    const desktopCollapsed =
      this.collapsible && this.collapsed && !this._viewportIsMobile;
    const root = document.documentElement;
    if (desktopCollapsed) {
      root.style.setProperty("--cpk-drawer-reserved-width", "0px");
    } else {
      root.style.removeProperty("--cpk-drawer-reserved-width");
    }
  }

  /**
   * Center the confirm-delete <dialog> over the drawer PANEL's on-screen box
   * (not the viewport). The dialog stays a top-layer `showModal()` element so it
   * is never clipped, but we drive its center via `--confirm-cx/cy` measured
   * from the visible `.root` rect — so it reads as "inside the drawer" per the
   * ENT-1051 design while keeping the top-layer robustness. Falls back to
   * viewport-center (the CSS default) when the panel isn't measurable
   * (SSR/jsdom).
   */
  private _positionConfirmDialog(): void {
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>("dialog");
    const root = this.renderRoot.querySelector<HTMLElement>(".root");
    if (!dialog) return;
    const rect = root?.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      dialog.style.removeProperty("--confirm-cx");
      dialog.style.removeProperty("--confirm-cy");
      return;
    }
    // Center over the drawer's VISIBLE box (its rect intersected with the
    // viewport), not the raw rect: a host grid that doesn't bound the drawer's
    // row lets `.root` grow to content height, so a raw-rect center would land
    // far down the page. Intersecting with the viewport keeps the modal centered
    // in the on-screen drawer band regardless of how the host sizes the panel.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visLeft = Math.max(rect.left, 0);
    const visRight = Math.min(rect.right, vw);
    const visTop = Math.max(rect.top, 0);
    const visBottom = Math.min(rect.bottom, vh);
    dialog.style.setProperty("--confirm-cx", `${(visLeft + visRight) / 2}px`);
    dialog.style.setProperty("--confirm-cy", `${(visTop + visBottom) / 2}px`);
  }

  /** Bound reposition handler for scroll/resize while the confirm dialog is open. */
  private _repositionConfirm = () => this._positionConfirmDialog();

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
    // Collapsed to the floating cluster on desktop (gated on `collapsible`), OR
    // closed on mobile — both show the same launcher cluster and hide the panel
    // body. Mobile keeps the body rendered (off-canvas, ready to slide in);
    // desktop-collapsed omits it entirely so the reserved column can reclaim.
    const desktopCollapsed =
      this.collapsible && this.collapsed && !this._viewportIsMobile;
    const mobileClosed = this._viewportIsMobile && !this.open;
    const showCluster = desktopCollapsed || mobileClosed;
    const rootClasses = {
      root: true,
      mobile: this._viewportIsMobile,
      open: this.open,
      collapsed: desktopCollapsed,
    };

    return html`
      ${showCluster ? this._renderCluster() : nothing}
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
        aria-hidden=${desktopCollapsed ? "true" : nothing}
        aria-label=${this.label}
      >
        ${
          desktopCollapsed
            ? nothing
            : html`${this._renderHeader()} ${this._renderBody()}
              ${this._renderMemories()} ${this._renderFooter()}
              ${this._renderConfirmDialog()}`
        }
      </div>
    `;
  }

  /**
   * Floating launcher cluster from the Figma "closed" mockup: a sidebar-glyph
   * toggle + a "New Conversation" (+) icon button. Shown in TWO states — the
   * mobile closed state (toggle opens the off-canvas modal) and the desktop
   * collapsed state (toggle expands the sidebar). The primary toggle keeps
   * `part="launcher"` for mobile-launcher theme compat; the new-thread button is
   * suppressed in the locked/unlicensed view, mirroring the New Conversation row.
   */
  private _renderCluster() {
    const onToggle = this._viewportIsMobile
      ? () => this._setOpen(true)
      : () => this._setCollapsed(false);
    const toggleLabel = this._viewportIsMobile
      ? "Open threads"
      : "Expand threads";
    return html`
      <div class="launcher-cluster" part="launcher-cluster">
        <button
          class="launcher"
          part="launcher"
          aria-label=${toggleLabel}
          @click=${onToggle}
        >
          <slot name="launcher-icon">${iconSidebar}</slot>
        </button>
        ${
          this.licensed
            ? html`<button
                class="launcher launcher-new-thread"
                part="launcher-new-thread"
                aria-label="New Conversation"
                @click=${() => this._emit("new-thread", {})}
              >
                ${iconPlusSquare}
              </button>`
            : nothing
        }
      </div>
    `;
  }

  private _renderHeader() {
    // The header is a reserved consumer-projection surface with no built-in
    // controls (search and the desktop collapse toggle were both removed), so
    // it stays hidden until a consumer projects `slot="header"` content — a
    // `slotchange` listener drives `_hasHeader`, mirroring the memories/footer
    // gating. Without this gate the empty padded header bar would render above
    // the "New Conversation" row. The "New Conversation" row is suppressed in
    // the locked/unlicensed view (only the Upgrade panel shows), mirroring the
    // section-heading gating.
    // On mobile the drawer is an off-canvas modal, so it needs an in-header
    // close affordance (desktop is a persistent sidebar — nothing to close).
    // The header therefore also renders when the mobile modal is open, even
    // with no projected `slot="header"` content.
    const showMobileClose = this._viewportIsMobile && this.open;
    // Desktop collapse toggle: always available on desktop when collapsing is
    // permitted, so the header renders on desktop even with no projected
    // `slot="header"` content. Mobile uses the launcher/close affordances.
    const showCollapseToggle = this.collapsible && !this._viewportIsMobile;
    return html`
      <div
        class="header"
        part="header"
        ?hidden=${!this._hasHeader && !showMobileClose && !showCollapseToggle}
      >
        <slot
          name="header"
          @slotchange=${(e: Event) => {
            const slot = e.target as HTMLSlotElement;
            this._hasHeader = slot.assignedElements().length > 0;
          }}
        ></slot>
        ${
          // Toggle sits at the END so it right-aligns (the projected header slot
          // has flex:1 and pushes it over) — matching the mobile close button.
          showCollapseToggle
            ? html`<button
              class="icon-btn"
              part="collapse-toggle"
              aria-label="Collapse threads"
              @click=${() => this._setCollapsed(true)}
            >
              ${iconSidebar}
            </button>`
            : nothing
        }
        ${
          showMobileClose
            ? html`<button
              class="icon-btn"
              part="close-toggle"
              aria-label="Close threads"
              @click=${() => this._setOpen(false)}
            >
              ${iconSidebar}
            </button>`
            : nothing
        }
      </div>
      ${this.licensed ? this._renderNewConversation() : nothing}
      ${this._renderSectionHeading()}
    `;
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
          ${
            // "Filter applied" indicator dot — shown whenever the active filter
            // is not the default ("active"), matching the Figma's archived view.
            this._filter !== "active"
              ? html`
                  <span class="filter-dot" part="filter-indicator"></span>
                `
              : nothing
          }
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
      <div
        class="state error"
        part="error"
        role="alert"
        data-testid="drawer-error"
      >
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
      <ul
        class=${this._openMenuId !== null ? "list menu-open" : "list"}
        part="list"
        role="listbox"
        aria-label=${this.label}
      >
        ${repeat(
          visible,
          (thread) => thread.id,
          (thread, index) => this._renderRow(thread, index, visible.length),
        )}
      </ul>
      ${this._renderFetchMore()}
    `;
  }

  private _renderRow(thread: DrawerThread, index = 0, total = 1) {
    const isActive = thread.id === this.activeThreadId;
    const hasName = thread.name !== null && thread.name !== "";
    // Shared display-name fallback: an empty-string (or null) name reads as
    // "New thread" for BOTH the visible label and every row-action aria-label,
    // so a screen reader never announces "Actions for " / "Archive thread ".
    const displayName = hasName ? (thread.name as string) : "New thread";
    const justRevealed = this._justRevealed.has(thread.id);

    const menuOpen = this._openMenuId === thread.id;
    // The kebab popover opens downward by default (`top: 100%`). For rows in the
    // lower portion of the list, a downward menu would be clipped by the list's
    // `overflow-y: auto` scroll box (which also clips the x-axis). Flip those
    // rows' menu to open UPWARD (toward the list interior) via `menu-up`, so the
    // popover for bottom rows is never lost behind the list's bottom edge.
    const menuUp = menuOpen && total > 1 && index >= total / 2;

    const rowClasses = {
      row: true,
      active: isActive,
      archived: thread.archived,
      "menu-open": menuOpen,
      "menu-up": menuUp,
    };
    const nameClasses = {
      "row-name": true,
      placeholder: !hasName,
      revealed: justRevealed,
    };
    const slotName = rowSlotName(thread.id);
    // A long thread name is clipped with an ellipsis (no hover tooltip — the
    // designer opted against name bubbles). The name text lives in an inner span
    // that owns the ellipsis truncation.
    const nameSpan = html`<span class=${classMap(nameClasses)} part="row-name">
      <span class="row-name-text">${displayName}</span>
    </span>`;

    return html`
      <li
        class=${classMap(rowClasses)}
        part=${isActive ? "row row-active" : "row"}
        role="option"
        aria-selected=${isActive ? "true" : "false"}
        tabindex="0"
        data-thread-id=${thread.id}
        @click=${() => {
          // Selecting a row dismisses any open kebab menu (it belongs to a row,
          // not the selection) before emitting the selection intent.
          this._openMenuId = null;
          this._emit("thread-selected", { threadId: thread.id });
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this._openMenuId = null;
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
          aria-label=${`Actions for ${displayName}`}
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
                    aria-label=${`Unarchive thread ${displayName}`}
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
                    aria-label=${`Archive thread ${displayName}`}
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
                aria-label=${`Delete thread ${displayName}`}
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

  /**
   * Confirm-delete dialog, rendered as a native `<dialog>` that is ALWAYS
   * present in the shadow DOM so `updated()` can drive `showModal()`/`close()`
   * against it. Opening with `showModal()` puts it in the browser TOP LAYER, so
   * it can never be painted under other UI — the previous CSS-positioned overlay
   * was trapped in the drawer host's stacking context and appeared under the
   * chat's welcome view (ENT-1051). The `::backdrop` pseudo-element (styled in
   * styles.ts) provides the scrim natively.
   *
   * The actionable content (message + Cancel/Delete, bound to the captured id)
   * renders only while confirming, so a closed dialog holds nothing stale.
   * Native dismissal is wired via `@cancel` (Escape) and a backdrop-click check.
   */
  private _renderConfirmDialog() {
    const id = this._confirmingDeleteId;
    return html`
      <dialog
        class="dialog"
        part="confirm-dialog"
        role="alertdialog"
        aria-label="Confirm delete"
        data-testid="drawer-confirm-delete"
        @cancel=${(event: Event) => {
          // Native Escape dismissal: prevent the default close (we drive open
          // state from `_confirmingDeleteId` in `updated()`) and reset it.
          event.preventDefault();
          this._confirmingDeleteId = null;
        }}
        @click=${(event: MouseEvent) => {
          // A click whose target is the <dialog> itself (not the inner card)
          // landed on the ::backdrop — dismiss, mirroring a scrim click.
          if (event.target === event.currentTarget) {
            this._confirmingDeleteId = null;
          }
        }}
      >
        ${
          id !== null
            ? html`
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
              `
            : nothing
        }
      </dialog>
    `;
  }
}
