import { LitElement, html, nothing, type PropertyValues } from "lit";
import { drawerStyles } from "./styles";
import type { DrawerFilter, DrawerThread, DrawerThreadRenderer } from "./types";

/** Public pricing page the upsell CTA links to. */
export const COPILOTKIT_PRICING_URL = "https://copilotkit.ai/pricing";

/**
 * Module-level body-scroll-lock refcount, shared across every drawer instance
 * on the page. The real baseline `document.body.style.overflow` is captured
 * exactly once on the 0->1 transition and restored exactly once on the 1->0
 * transition, so multiple overlay drawers (or re-locks after external script
 * mutation) cannot leave the body permanently `hidden`.
 */
let bodyScrollLockCount = 0;

/** The body overflow value captured when the lock count went 0 -> 1. */
let bodyOverflowBaseline = "";

/** Increment the shared scroll-lock refcount, locking body scroll. */
function acquireBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  if (bodyScrollLockCount === 0) {
    bodyOverflowBaseline = document.body.style.overflow;
  }
  bodyScrollLockCount += 1;
  document.body.style.overflow = "hidden";
}

/** Decrement the shared scroll-lock refcount, restoring scroll at zero. */
function releaseBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  if (bodyScrollLockCount === 0) return;
  bodyScrollLockCount -= 1;
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = bodyOverflowBaseline;
    bodyOverflowBaseline = "";
  }
}

/** Custom element tag name for the drawer. */
export const COPILOTKIT_DRAWER_TAG = "copilotkit-drawer";

/**
 * Controlled, framework-agnostic threads drawer custom element.
 *
 * All state flows IN as properties/attributes (`threads`, `activeThreadId`,
 * `filter`, `open`, `collapsed`, `overlay`, `licensed`, `loading`, `error`).
 * All user intent flows OUT as typed DOM `CustomEvent`s — the element never
 * mutates its own thread data. Consumers (React/Angular/Vue wrappers or plain
 * DOM) listen for events and update the inbound props.
 *
 * The interactive view-state properties (`open`, `filter`, `collapsed`) are
 * updated optimistically in-place AND reported via their matching change event
 * (`open-change`, `filter-change`, `collapse-change`). A controlling consumer
 * may override the optimistic value by pushing its own value back in through
 * the corresponding property; because every change is observable, the consumer
 * can always reassert control.
 *
 * Emitted events: `thread-selected`, `archive`, `unarchive`, `delete`,
 * `new-thread`, `filter-change`, `open-change`, `collapse-change`. All bubble
 * and are composed so they cross the shadow boundary.
 *
 * @fires thread-selected - A thread row was activated. `detail: { id }`.
 * @fires archive - Archive requested for a thread. `detail: { id }`.
 * @fires unarchive - Unarchive requested for a thread. `detail: { id }`.
 * @fires delete - Delete confirmed for a thread. `detail: { id }`.
 * @fires new-thread - New-thread affordance activated. `detail: undefined`.
 * @fires filter-change - Active/All filter toggled. `detail: { filter }`.
 * @fires open-change - Overlay open state changed (toggle/backdrop/Escape).
 * @fires collapse-change - Desktop rail collapse toggled. `detail: { collapsed }`.
 */
export class CopilotkitDrawer extends LitElement {
  static styles = drawerStyles;

  static properties = {
    threads: { attribute: false },
    activeThreadId: { attribute: "active-thread-id", reflect: false },
    filter: { reflect: true },
    open: { type: Boolean, reflect: true },
    collapsed: { type: Boolean, reflect: true },
    overlay: { type: Boolean, reflect: true },
    licensed: { type: Boolean },
    loading: { type: Boolean },
    error: {},
    renderThread: { attribute: false },
    _pendingDeleteId: { state: true },
    _hasMemories: { state: true },
  };

  /** Inbound thread list. The element renders a filtered, read-only view. */
  threads: DrawerThread[] = [];

  /** Currently active thread id, used to highlight the matching row. */
  activeThreadId: string | null = null;

  /** Active/All filter. `active` hides archived threads. */
  filter: DrawerFilter = "active";

  /** Overlay open state (mobile/off-canvas). Ignored in in-flow desktop mode. */
  open = false;

  /** Desktop collapse-to-rail state. */
  collapsed = false;

  /** When true, render as a mobile off-canvas overlay with a backdrop. */
  overlay = false;

  /** Whether the consumer holds a valid license. When false, shows upsell. */
  licensed = true;

  /** Loading flag — replaces the list with a spinner state. */
  loading = false;

  /** Error message — replaces the list with an error state when truthy. */
  error: string | null = null;

  /** Optional per-row render hook for practical framework parity. */
  renderThread?: DrawerThreadRenderer;

  /** Id of the thread awaiting delete confirmation, if any. */
  private _pendingDeleteId: string | null = null;

  /**
   * Whether the `memories` slot currently has assigned, non-whitespace content.
   * Tracked reactively from the slot's `slotchange` event rather than queried
   * during `render()`, so a coalesced initial `slotchange` cannot leave the
   * region permanently hidden.
   */
  private _hasMemories = false;

  private readonly _onKeydown = (event: KeyboardEvent): void => {
    // Only act on Escape while the overlay is actually open. Deliberately do
    // NOT call stopPropagation: a drawer is an embedded component and must not
    // starve other Escape handlers on the page (modals, menus, the host app's
    // own global handler). The event is allowed to continue propagating.
    if (event.key === "Escape" && this.overlay && this.open) {
      this._setOpen(false);
    }
  };

  /**
   * Emit a typed, bubbling, composed CustomEvent.
   *
   * @param type - Event name.
   * @param detail - Event detail payload.
   */
  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Bubble phase (not capture) so other listeners see Escape first.
    document.addEventListener("keydown", this._onKeydown);
    this.syncScrollLock();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this._onKeydown);
    this.releaseScrollLock();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Cancel any in-flight delete confirmation whenever the set of visible
    // threads may have shifted out from under it: a different active thread, a
    // filter flip, or a new inbound `threads` array. Reconcile against the
    // currently visible set so a confirm can never point at a row that is no
    // longer shown (which would otherwise resurface mid-confirm if the row
    // re-entered the visible set). Done in `willUpdate` (pre-render) so the
    // clear folds into the same render pass instead of scheduling a second
    // update cycle (which `updated()` would).
    if (
      this._pendingDeleteId &&
      (changed.has("activeThreadId") ||
        changed.has("filter") ||
        changed.has("threads")) &&
      !this.visibleThreads().some(
        (thread) => thread.id === this._pendingDeleteId,
      )
    ) {
      this._pendingDeleteId = null;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("open") || changed.has("overlay")) {
      this.syncScrollLock();
      if (this.overlay && this.open) {
        this.trapInitialFocus();
      }
    }
  }

  /** Whether THIS instance currently holds a slot in the shared refcount. */
  private _holdsScrollLock = false;

  /** Lock body scroll while the overlay is open; restore otherwise. */
  private syncScrollLock(): void {
    if (this.overlay && this.open) {
      if (!this._holdsScrollLock) {
        this._holdsScrollLock = true;
        acquireBodyScrollLock();
      }
    } else {
      this.releaseScrollLock();
    }
  }

  /** Release this instance's hold on the shared body scroll lock, if any. */
  private releaseScrollLock(): void {
    if (this._holdsScrollLock) {
      this._holdsScrollLock = false;
      releaseBodyScrollLock();
    }
  }

  /** Move focus into the panel when the overlay opens (focus trap entry). */
  private trapInitialFocus(): void {
    void this.updateComplete.then(() => {
      const first = this.firstFocusable();
      if (first) first.focus();
    });
  }

  /** Selector matching natively/explicitly tabbable elements. */
  private static readonly FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  /**
   * All tabbable elements inside the panel, in DOM order, including focusables
   * projected through the element's slots (light-DOM content lives outside the
   * shadow tree, so it must be collected from each slot's assigned elements).
   */
  private focusableElements(): HTMLElement[] {
    const panel = this.renderRoot.querySelector<HTMLElement>(".panel");
    if (!panel) return [];
    const selector = CopilotkitDrawer.FOCUSABLE_SELECTOR;
    // Note: visibility is not filtered via layout (offsetParent/getClientRects)
    // because hidden regions are removed from the template entirely in the
    // states where focus management matters, and layout APIs are unreliable
    // under headless/jsdom test environments.
    const collected: HTMLElement[] = [];
    // Walk the panel subtree in DOM order. Shadow-DOM focusables are matched
    // directly; <slot> elements are expanded into their assigned light-DOM
    // focusables (the slotted node itself if it matches, plus its descendants).
    const walker = panel.querySelectorAll<HTMLElement>(`${selector},slot`);
    for (const node of Array.from(walker)) {
      if (node instanceof HTMLSlotElement) {
        for (const assigned of node.assignedElements()) {
          if (!(assigned instanceof HTMLElement)) continue;
          if (assigned.matches(selector)) collected.push(assigned);
          collected.push(
            ...Array.from(assigned.querySelectorAll<HTMLElement>(selector)),
          );
        }
      } else {
        collected.push(node);
      }
    }
    return collected.filter(
      (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
    );
  }

  /**
   * The deepest currently-focused element, descending through nested shadow
   * roots so focus inside a slotted custom element or nested shadow tree
   * resolves to the actual focused control rather than a host/slot.
   */
  private deepActiveElement(): HTMLElement | null {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active instanceof HTMLElement ? active : null;
  }

  private firstFocusable(): HTMLElement | undefined {
    return this.focusableElements()[0];
  }

  /**
   * Whether `el` is contained within the open panel, following the *composed*
   * (flattened) tree. `panel.contains()` alone misses slotted light-DOM
   * focusables: slotted nodes are children of the host element, not DOM
   * descendants of the in-shadow `.panel`. So an element counts as inside when
   * it is either a shadow descendant of the panel OR a light-DOM descendant of
   * the host (which is what `<slot>` projects into the panel).
   */
  private panelContains(el: HTMLElement | null): boolean {
    if (!el) return false;
    const panel = this.renderRoot.querySelector<HTMLElement>(".panel");
    if (panel?.contains(el)) return true;
    return this.contains(el);
  }

  /** Cycle Tab/Shift+Tab focus within the panel while the overlay is open. */
  private readonly _onTabTrap = (event: KeyboardEvent): void => {
    if (!this.overlay || !this.open || event.key !== "Tab") return;
    const focusable = this.focusableElements();
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const activeEl = this.deepActiveElement();
    // Containment is decided by the panel's composed subtree, NOT by membership
    // in the tabbable set. Focus can legitimately rest inside the panel on an
    // element that `focusableElements()` filters out (e.g. slotted content the
    // consumer made programmatically focusable while keeping `tabindex="-1"`);
    // such focus must be left alone. We only pull focus back when it has truly
    // escaped the panel — i.e. the deep active element is not contained by it.
    const focusEscaped = !this.panelContains(activeEl);
    if (event.shiftKey && (activeEl === first || focusEscaped)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (activeEl === last || focusEscaped)) {
      event.preventDefault();
      first.focus();
    }
  };

  private _setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.emit("open-change", { open });
  }

  private _setFilter(filter: DrawerFilter): void {
    if (this.filter === filter) return;
    this.filter = filter;
    this.emit("filter-change", { filter });
  }

  /**
   * Toggle the desktop collapse-to-rail state. Emits `collapse-change` so a
   * controlling consumer can observe and own the `collapsed` property,
   * mirroring how `open` is reported via `open-change`. The optimistic local
   * update keeps the rail responsive; a controlled consumer may push its own
   * value back in via the `collapsed` property.
   */
  private _setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    this.emit("collapse-change", { collapsed });
  }

  private _selectThread(id: string): void {
    this.emit("thread-selected", { id });
  }

  private _archive(id: string): void {
    this.emit("archive", { id });
  }

  private _unarchive(id: string): void {
    this.emit("unarchive", { id });
  }

  private _requestDelete(id: string): void {
    this._pendingDeleteId = id;
  }

  private _confirmDelete(id: string): void {
    this._pendingDeleteId = null;
    this.emit("delete", { id });
  }

  private _cancelDelete(): void {
    this._pendingDeleteId = null;
  }

  /** Threads passing the current filter. */
  private visibleThreads(): DrawerThread[] {
    if (this.filter === "all") return this.threads;
    return this.threads.filter((thread) => !thread.archived);
  }

  private renderHeader() {
    return html`
      <div class="header" part="header">
        <button
          class="icon-button"
          part="toggle-button"
          type="button"
          aria-label=${this.overlay ? "Close drawer" : "Toggle drawer"}
          aria-expanded=${
            this.overlay ? String(this.open) : String(!this.collapsed)
          }
          @click=${() =>
            this.overlay
              ? this._setOpen(!this.open)
              : this._setCollapsed(!this.collapsed)}
        >
          ☰
        </button>
        <span class="title" part="title"><slot name="header">Threads</slot></span>
      </div>
    `;
  }

  private renderFilters() {
    return html`
      <div class="filters" part="filters" role="group" aria-label="Thread filter">
        <button
          class="filter-button"
          part="filter-active"
          type="button"
          aria-pressed=${this.filter === "active"}
          @click=${() => this._setFilter("active")}
        >
          Active
        </button>
        <button
          class="filter-button"
          part="filter-all"
          type="button"
          aria-pressed=${this.filter === "all"}
          @click=${() => this._setFilter("all")}
        >
          All
        </button>
      </div>
    `;
  }

  private renderThreadRow(thread: DrawerThread) {
    const active = thread.id === this.activeThreadId;
    const isPendingDelete = this._pendingDeleteId === thread.id;
    const label =
      thread.name && thread.name.trim().length > 0
        ? thread.name
        : "Untitled thread";
    const meta = thread.lastRunAt ?? thread.updatedAt ?? thread.createdAt ?? "";

    const body = this.renderThread
      ? this.renderThread(thread, { active })
      : html`
          <span class="thread-name" part="thread-name">${label}</span>
          ${
            meta
              ? html`<span class="thread-meta" part="thread-meta">${meta}</span>`
              : nothing
          }
        `;

    return html`
      <li
        class="thread-row"
        part="thread-row"
        data-thread-id=${thread.id}
        data-active=${String(active)}
        data-archived=${String(Boolean(thread.archived))}
      >
        <button
          class="thread-main"
          part="thread-button"
          type="button"
          aria-current=${active ? "true" : nothing}
          @click=${() => this._selectThread(thread.id)}
        >
          ${body}
        </button>
        ${
          isPendingDelete
            ? html`
              <span class="confirm" part="confirm-delete" role="group">
                <span>Delete?</span>
                <button
                  class="confirm-button confirm-yes"
                  part="confirm-delete-yes"
                  type="button"
                  @click=${() => this._confirmDelete(thread.id)}
                >
                  Yes
                </button>
                <button
                  class="confirm-button confirm-no"
                  part="confirm-delete-no"
                  type="button"
                  @click=${() => this._cancelDelete()}
                >
                  No
                </button>
              </span>
            `
            : html`
              <span class="row-actions" part="row-actions">
                ${
                  thread.archived
                    ? html`<button
                      class="icon-button"
                      part="unarchive-button"
                      type="button"
                      aria-label="Unarchive thread"
                      @click=${() => this._unarchive(thread.id)}
                    >
                      ↺
                    </button>`
                    : html`<button
                      class="icon-button"
                      part="archive-button"
                      type="button"
                      aria-label="Archive thread"
                      @click=${() => this._archive(thread.id)}
                    >
                      ▢
                    </button>`
                }
                <button
                  class="icon-button danger"
                  part="delete-button"
                  type="button"
                  aria-label="Delete thread"
                  @click=${() => this._requestDelete(thread.id)}
                >
                  🗑
                </button>
              </span>
            `
        }
      </li>
    `;
  }

  private renderBody() {
    if (!this.licensed) {
      return html`
        <div class="upsell" part="upsell" data-testid="drawer-upsell">
          <slot name="upsell">
            <strong>Upgrade to unlock threads</strong>
            <span class="state"
              >Persistent threads are a CopilotKit premium feature.</span
            >
          </slot>
          <a
            class="upsell-cta"
            part="upsell-cta"
            href=${COPILOTKIT_PRICING_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            View pricing
          </a>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="state error" part="error" role="alert" data-testid="drawer-error">
          ${this.error}
        </div>
      `;
    }

    if (this.loading) {
      return html`
        <div class="state" part="loading" data-testid="drawer-loading" aria-busy="true">
          <span class="spinner" aria-hidden="true"></span>
          <div>Loading threads…</div>
        </div>
      `;
    }

    const visible = this.visibleThreads();
    if (visible.length === 0) {
      return html`
        <div class="state" part="empty" data-testid="drawer-empty">
          <slot name="empty">No threads yet.</slot>
        </div>
      `;
    }

    // Plain semantic list of action rows. A `listbox` role is intentionally
    // NOT used: each row carries multiple independent controls (select,
    // archive/unarchive, delete), which is structurally invalid inside a
    // single `option`, and a listbox would also obligate roving-tabindex
    // arrow-key navigation the button rows do not implement. A native
    // `<ul>`/`<li>` list of buttons is a valid, self-consistent pattern.
    return html`
      <ul class="thread-list" part="thread-list">
        ${visible.map((thread) => this.renderThreadRow(thread))}
      </ul>
    `;
  }

  override render() {
    const showListControls = this.licensed;
    // A closed off-canvas overlay panel is removed from the tab order and the
    // accessibility tree: its controls are off-screen and must not be reachable
    // by keyboard or announced by screen readers. `inert` covers focus + AT in
    // supporting engines; `aria-hidden` is the AT fallback (styles also apply
    // `visibility: hidden`). In-flow (non-overlay) drawers are always live.
    const panelInert = this.overlay && !this.open;
    return html`
      ${
        this.overlay
          ? html`<div
            class="backdrop"
            part="backdrop"
            data-testid="drawer-backdrop"
            @click=${() => this._setOpen(false)}
          ></div>`
          : nothing
      }
      <nav
        class="panel"
        part="panel"
        aria-label="Threads"
        aria-hidden=${panelInert ? "true" : nothing}
        ?inert=${panelInert}
        @keydown=${this._onTabTrap}
      >
        ${this.renderHeader()}
        ${
          showListControls
            ? html`
              <button
                class="new-thread"
                part="new-thread"
                type="button"
                @click=${() => this.emit("new-thread", undefined)}
              >
                + New thread
              </button>
              ${this.renderFilters()}
            `
            : nothing
        }
        ${this.renderBody()}
        <div class="footer" part="footer"><slot name="footer"></slot></div>
        <div
          class="memories"
          part="memories"
          data-testid="drawer-memories"
          ?hidden=${!this._hasMemories}
        >
          <slot
            name="memories"
            @slotchange=${this._onMemoriesSlotChange}
          ></slot>
        </div>
      </nav>
    `;
  }

  /**
   * Recompute `_hasMemories` from the memories slot's currently assigned nodes.
   * Bound to the slot's `slotchange` so the reveal is driven by reactive state
   * updated AFTER the slot is committed — never by querying the render root
   * mid-`render()`, which could observe a not-yet-committed (or coalesced) slot
   * and leave the region permanently hidden.
   *
   * @param event - The slot's `slotchange` event.
   */
  private readonly _onMemoriesSlotChange = (event: Event): void => {
    const slot = event.target as HTMLSlotElement;
    const assigned = slot.assignedNodes({ flatten: true });
    this._hasMemories = assigned.some((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) return true;
      return Boolean(node.textContent && node.textContent.trim().length > 0);
    });
  };
}
