import type { TemplateResult } from "lit";

/**
 * A single thread row's data, as supplied to the controlled drawer.
 *
 * Mirrors the shape of the SDK's thread record (`@copilotkit/core` `ɵThread`)
 * but is intentionally minimal and decoupled: the element is framework- and
 * transport-agnostic and only reads the fields it renders.
 */
export interface DrawerThread {
  /** Stable thread identifier. Emitted back out on row intents. */
  id: string;
  /** Human-readable thread name; `null`/empty falls back to a placeholder. */
  name?: string | null;
  /** Whether the thread is archived. Drives Active/All filtering. */
  archived?: boolean;
  /** ISO timestamp of creation, used for the secondary row label. */
  createdAt?: string;
  /** ISO timestamp of last update. */
  updatedAt?: string;
  /** ISO timestamp of last run, preferred for recency sorting/labels. */
  lastRunAt?: string | null;
}

/**
 * The Active/All filter applied to the thread list.
 *
 * - `active`: only non-archived threads are shown.
 * - `all`: every thread is shown regardless of archived state.
 */
export type DrawerFilter = "active" | "all";

/**
 * Render hook for a single thread row.
 *
 * When provided, the element delegates the row body to this function for
 * practical render parity with framework forks. The returned template is
 * projected into the row; the element still owns the row container, selection
 * affordance, and per-row action buttons.
 */
export type DrawerThreadRenderer = (
  thread: DrawerThread,
  context: { active: boolean },
) => TemplateResult | string;

/**
 * `detail` payload for the `thread-selected` event.
 */
export interface ThreadSelectedDetail {
  id: string;
}

/**
 * `detail` payload for the `archive` event.
 */
export interface ArchiveDetail {
  id: string;
}

/**
 * `detail` payload for the `unarchive` event.
 */
export interface UnarchiveDetail {
  id: string;
}

/**
 * `detail` payload for the `delete` event, emitted only after the in-element
 * confirm-delete flow is confirmed.
 */
export interface DeleteDetail {
  id: string;
}

/**
 * `detail` payload for the `filter-change` event.
 */
export interface FilterChangeDetail {
  filter: DrawerFilter;
}

/**
 * `detail` payload for the `open-change` event.
 */
export interface OpenChangeDetail {
  open: boolean;
}

/**
 * `detail` payload for the `collapse-change` event, emitted when the desktop
 * collapse-to-rail state is toggled.
 */
export interface CollapseChangeDetail {
  collapsed: boolean;
}

/**
 * Map of every custom event the drawer emits to its `detail` payload type.
 * Useful for typed `addEventListener` consumers and framework wrappers.
 */
export interface DrawerEventMap {
  "thread-selected": CustomEvent<ThreadSelectedDetail>;
  archive: CustomEvent<ArchiveDetail>;
  unarchive: CustomEvent<UnarchiveDetail>;
  delete: CustomEvent<DeleteDetail>;
  "new-thread": CustomEvent<undefined>;
  "filter-change": CustomEvent<FilterChangeDetail>;
  "open-change": CustomEvent<OpenChangeDetail>;
  "collapse-change": CustomEvent<CollapseChangeDetail>;
}

declare global {
  /**
   * Augment the global event map so `addEventListener` on any element (including
   * `<copilotkit-drawer>`) narrows the listener's event to the drawer's typed
   * `CustomEvent<…Detail>`. This makes `el.addEventListener("thread-selected", e
   * => e.detail.id)` type-check the `detail` payload without a cast, delivering
   * the typed-listener ergonomics that `DrawerEventMap` advertises.
   */
  interface HTMLElementEventMap extends DrawerEventMap {}
}
