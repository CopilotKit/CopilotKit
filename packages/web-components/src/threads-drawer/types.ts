/**
 * Public type surface for the `<copilotkit-threads-drawer>` custom element.
 *
 * The element is a pure VIEW: domain data flows IN as properties and user
 * intent flows OUT as DOM `CustomEvent`s. These types intentionally do NOT
 * import from `@copilotkit/core` or any framework — the element is
 * framework-agnostic and self-contained. The thread shape mirrors the fields
 * the drawer needs to render and is structurally compatible with core's thread
 * record (`id`, `name`, `archived`, timestamps).
 */

/**
 * Minimal thread record the drawer renders. A `null` name signals an
 * as-yet-unnamed thread and is rendered as a "New thread" placeholder until the
 * async name arrives.
 */
export interface DrawerThread {
  /** Stable thread identifier; drives row keying and slot reconciliation. */
  readonly id: string;
  /** Display name, or `null` when not yet named. */
  readonly name: string | null;
  /** Whether the thread is archived (affects styling + available actions). */
  readonly archived: boolean;
  /** ISO timestamp the thread was created. */
  readonly createdAt: string;
  /** ISO timestamp the thread was last updated. */
  readonly updatedAt: string;
  /** ISO timestamp of the most recent run, if any. */
  readonly lastRunAt?: string;
}

/** The Active/All filter the element owns authoritatively. */
export type DrawerFilter = "active" | "all";

/** `detail` for the `thread-selected` event. */
export interface ThreadSelectedDetail {
  readonly threadId: string;
}

/** `detail` for the `archive` event. */
export interface ArchiveDetail {
  readonly threadId: string;
}

/** `detail` for the `unarchive` event. */
export interface UnarchiveDetail {
  readonly threadId: string;
}

/** `detail` for the `delete` event (fired only after in-element confirm). */
export interface DeleteDetail {
  readonly threadId: string;
}

/** `detail` for the `filter-change` event. */
export interface FilterChangeDetail {
  readonly filter: DrawerFilter;
}

/** `detail` for the `open-change` event. */
export interface OpenChangeDetail {
  readonly open: boolean;
}

/** `detail` for the `collapse-change` event (user-driven collapse toggle). */
export interface CollapseChangeDetail {
  readonly collapsed: boolean;
}

/**
 * `detail` for the `retry` event, emitted from the actionable error state so a
 * wrapper can back it with a core refetch. `scope` distinguishes an initial
 * fetch retry from a fetch-more retry.
 */
export interface RetryDetail {
  readonly scope: "initial" | "fetch-more";
}

/** `detail` for the `new-thread` event. */
export type NewThreadDetail = Record<string, never>;

/**
 * `detail` for the `licensed` event (Upgrade CTA click). Carries the
 * `licenseUrl` the element will open in a new tab. The event is cancelable:
 * a host that calls `preventDefault()` suppresses the default navigation and
 * takes over (e.g. to route in-app or fire its own telemetry).
 */
export interface LicensedDetail {
  readonly licenseUrl: string | null;
}

/** `detail` for the `load-more` event (advance pagination; no payload). */
export type LoadMoreDetail = Record<string, never>;

/**
 * Strongly-typed event map for `<copilotkit-threads-drawer>`. Consumers can use this to
 * type `addEventListener` callbacks. All events bubble and are composed so they
 * cross the shadow boundary.
 */
export interface CopilotKitThreadsDrawerEventMap {
  "thread-selected": CustomEvent<ThreadSelectedDetail>;
  archive: CustomEvent<ArchiveDetail>;
  unarchive: CustomEvent<UnarchiveDetail>;
  delete: CustomEvent<DeleteDetail>;
  "new-thread": CustomEvent<NewThreadDetail>;
  "filter-change": CustomEvent<FilterChangeDetail>;
  "open-change": CustomEvent<OpenChangeDetail>;
  "collapse-change": CustomEvent<CollapseChangeDetail>;
  retry: CustomEvent<RetryDetail>;
  licensed: CustomEvent<LicensedDetail>;
  "load-more": CustomEvent<LoadMoreDetail>;
}
