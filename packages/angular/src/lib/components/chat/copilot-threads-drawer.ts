import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  EventEmitter,
  Output,
  TemplateRef,
  computed,
  contentChild,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import {
  DEFAULT_AGENT_ID,
  createLicenseContextValue,
} from "@copilotkit/shared";
import { defineCopilotKitThreadsDrawer } from "@copilotkit/web-components/threads-drawer";
import type {
  ArchiveDetail,
  DeleteDetail,
  DrawerThread,
  OpenChangeDetail,
  RetryDetail,
  ThreadSelectedDetail,
  UnarchiveDetail,
  CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement,
} from "@copilotkit/web-components/threads-drawer";
// TODO(ENT-1051): import `CollapseChangeDetail` from
// "@copilotkit/web-components/threads-drawer" once the parallel element PR that
// adds the collapse feature (property `collapsible` + event `collapse-change`)
// lands and is published; declared locally here because the built element types
// in this worktree predate it.
type CollapseChangeDetail = { collapsed: boolean };
import { COPILOT_CHAT_CONFIGURATION } from "../../chat-configuration";
import { CopilotKit } from "../../copilotkit";
import { injectThreads } from "../../threads";
import type { Thread } from "../../threads";

/**
 * Maps a {@link Thread} from the platform store onto the minimal
 * {@link DrawerThread} shape the `<copilotkit-threads-drawer>` element accepts.
 *
 * `lastRunAt` is spread conditionally so the key is absent (rather than
 * `undefined`) when the source thread has never been run — matching the
 * element's optional typing and avoiding spurious property pollution.
 */
function toDrawerThread(thread: Thread): DrawerThread {
  return {
    id: thread.id,
    name: thread.name,
    archived: thread.archived,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    ...(thread.lastRunAt !== undefined ? { lastRunAt: thread.lastRunAt } : {}),
  };
}

/**
 * The Angular chat view container's element selector. Used to scope the
 * focus-return lookup so a multi-chat page focuses THIS drawer's composer.
 */
const CHAT_CONTAINER_SELECTOR = "copilot-chat-view";
/**
 * The Angular chat input's element selector (`<textarea copilotChatTextarea>`).
 * Note: this is the Angular chat input, NOT React's `copilot-chat-textarea` or
 * Vue's `copilot-chat-input-textarea` `data-testid` — the Angular chat
 * components identify by element/attribute selector rather than `data-testid`.
 */
const CHAT_INPUT_SELECTOR = "textarea[copilotChatTextarea]";

/**
 * Returns the chat input element for focus-return after a thread is selected.
 *
 * Best-effort and SCOPED: walks up from the drawer element looking for an
 * ancestor chat-view container ({@link CHAT_CONTAINER_SELECTOR}), then returns
 * the chat input ({@link CHAT_INPUT_SELECTOR}) within that subtree. This avoids
 * focusing the wrong composer on a page hosting more than one chat, where a
 * document-global lookup would grab whichever input appears first in DOM order.
 *
 * Falls back to a document-global lookup when no scoping ancestor is found
 * (e.g. the drawer and chat share no common container, or headless usage), and
 * returns `null` when there is no chat input at all. Mirrors the React and Vue
 * wrappers' `findChatInput`, scoped to the Angular chat selectors.
 *
 * @param origin - The drawer element to scope the search from.
 */
function findChatInput(origin: Element | null): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const container = origin?.closest?.(CHAT_CONTAINER_SELECTOR);
  if (container) {
    const scoped = container.querySelector<HTMLElement>(CHAT_INPUT_SELECTOR);
    if (scoped) return scoped;
  }
  return document.querySelector<HTMLElement>(CHAT_INPUT_SELECTOR);
}

/**
 * Structural directive that captures a per-row template for projection into
 * the `<copilotkit-threads-drawer>` element as light-DOM children with
 * `slot="row:{id}"`.
 *
 * Apply it to an `<ng-template>` that is a direct child of `<copilot-threads-drawer>`.
 * The implicit context variable (`let-t`) receives the full {@link Thread}
 * record for that row.
 *
 * @example
 * ```html
 * <copilot-threads-drawer>
 *   <ng-template copilotThreadsDrawerRow let-t>
 *     <span>{{ t.name }}</span>
 *   </ng-template>
 * </copilot-threads-drawer>
 * ```
 */
@Directive({ selector: "[copilotThreadsDrawerRow]", standalone: true })
export class CopilotThreadsDrawerRow {
  /** The captured template reference for the per-row content. */
  readonly template = inject(TemplateRef);
}

/**
 * Angular wrapper around the `<copilotkit-threads-drawer>` Lit web component.
 *
 * Registers the custom element on construction (idempotent; SSR-guarded
 * internally by {@link defineCopilotKitThreadsDrawer}) and projects it into the DOM
 * via the `CUSTOM_ELEMENTS_SCHEMA`-enabled template.
 *
 * Thread list state is fetched from the Intelligence platform via
 * {@link injectThreads} and pushed onto the element's JS properties via an
 * `effect`, following the imperative property-assignment pattern used elsewhere
 * in this package (see `CopilotA2UIActivityRenderer`).
 *
 * DOM events emitted by the element are routed back to the chat configuration
 * and thread mutation methods via declarative Angular event bindings.
 *
 * @example
 * ```html
 * <copilot-threads-drawer data-testid="my-drawer" />
 * ```
 */
@Component({
  selector: "copilot-threads-drawer",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [NgTemplateOutlet],
  template: `
    <copilotkit-threads-drawer
      #drawer
      [attr.data-testid]="dataTestId()"
      [attr.recent-label]="recentLabel() ?? null"
      (thread-selected)="onThreadSelected($event)"
      (new-thread)="onNewThread()"
      (archive)="onArchive($event)"
      (unarchive)="onUnarchive($event)"
      (delete)="onDelete($event)"
      (filter-change)="onFilterChange()"
      (collapse-change)="onCollapseChange($event)"
      (retry)="onRetry($event)"
      (load-more)="onLoadMore()"
      (open-change)="onOpenChange($event)"
      (licensed)="onLicensed()"
      ><ng-content></ng-content>
      @if (rowDirective(); as row) {
        @for (t of threads.threads(); track t.id) {
          <div [attr.slot]="'row:' + t.id">
            <ng-container
              [ngTemplateOutlet]="row.template"
              [ngTemplateOutletContext]="{ $implicit: t }"
            ></ng-container>
          </div>
        }
      }
    </copilotkit-threads-drawer>
  `,
})
export class CopilotThreadsDrawer {
  /**
   * Optional agent id whose threads this drawer lists/manages. Scopes the
   * {@link injectThreads} store (via the resolved-agent precedence: this input
   * → ambient config's `agentId` → {@link DEFAULT_AGENT_ID}). NOT forwarded to
   * the element (the element has no `agentId` property).
   */
  readonly agentId = input<string | undefined>();

  /**
   * Value applied as the `data-testid` attribute on the inner
   * `<copilotkit-threads-drawer>` element. Defaults to `"copilot-threads-drawer"`.
   */
  readonly dataTestId = input<string>("copilot-threads-drawer", {
    alias: "data-testid",
  });

  /**
   * Optional accessible/region + default-header label forwarded to the element's
   * `label` property; defaults to the element's own `"Threads"` when unset.
   */
  readonly label = input<string | undefined>();

  /**
   * Optional heading for the "Recent Conversations" section, forwarded to the
   * element's `recent-label` attribute; defaults to the element's own
   * `"Recent Conversations"` when unset.
   */
  readonly recentLabel = input<string | undefined>();

  /**
   * Whether the drawer offers a collapse toggle. Pushed onto the element's
   * `collapsible` PROPERTY (a default-true boolean, exactly like `licensed` — a
   * string attribute cannot represent it since any non-empty value is truthy).
   * When `false`, the drawer has no collapse toggle and is always expanded.
   * Defaults to the element's own `true` when unset.
   */
  readonly collapsible = input<boolean | undefined>();

  /**
   * Emits the new collapsed state whenever the drawer's collapsed state changes
   * (mirrors the element's `collapse-change` event).
   */
  @Output() readonly collapseChange = new EventEmitter<boolean>();

  /**
   * Optional host override for the thread-select action.
   *
   * When provided, this callback is invoked instead of driving
   * `config.setActiveThreadId`. Bound via `[onThreadSelect]="fn"`.
   */
  readonly threadSelectHandler = input<
    ((threadId: string) => void) | undefined
  >(undefined, {
    alias: "onThreadSelect",
  });

  /**
   * Optional host override for the new-thread action.
   *
   * When provided, this callback is invoked instead of driving
   * `config.startNewThread`. The core `threads.startNewThread()` reset is
   * always called regardless. Bound via `[onNewThread]="fn"`.
   */
  readonly newThreadHandler = input<(() => void) | undefined>(undefined, {
    alias: "onNewThread",
  });

  /**
   * Page size for thread pagination. When set, threads load in pages of this
   * size and the element shows a "Load more" control while more remain. When
   * unset, the full list loads at once and no pagination control shows.
   */
  readonly limit = input<number | undefined>();

  /**
   * Destination the locked view's Upgrade CTA opens in a new tab. Forwarded to
   * the element's `licenseUrl` property; defaults to the element's built-in
   * CopilotKit Intelligence docs URL when unset. Set to an empty string to
   * suppress the default navigation and handle the click via `onLicensed`.
   */
  readonly licenseUrl = input<string | undefined>();

  /**
   * Optional host hook fired when the locked view's Upgrade CTA is clicked. The
   * element still performs its default navigation unless `licenseUrl` is blank;
   * use this for telemetry or to drive your own upgrade flow. Bound via
   * `[onLicensed]="fn"`.
   */
  readonly licensedHandler = input<(() => void) | undefined>(undefined, {
    alias: "onLicensed",
  });

  private readonly config = inject(COPILOT_CHAT_CONFIGURATION, {
    optional: true,
  });

  private readonly copilotkit = inject(CopilotKit);

  private readonly drawerRef = viewChild<
    unknown,
    ElementRef<CopilotKitThreadsDrawerElement>
  >("drawer", {
    read: ElementRef,
  });

  /**
   * Optional per-row template directive projected as a direct child of this
   * component. When present, a `<div slot="row:{id}">` is rendered inside the
   * `<copilotkit-threads-drawer>` element for each thread, allowing the host to inject
   * custom light-DOM content into each row slot.
   */
  protected readonly rowDirective = contentChild(CopilotThreadsDrawerRow);

  /**
   * The resolved agent id for the threads store. Precedence:
   * 1. `agentId` input prop.
   * 2. Ambient `CopilotChatConfiguration.agentId`.
   * 3. {@link DEFAULT_AGENT_ID}.
   */
  protected readonly resolvedAgentId = computed(
    () => this.agentId() ?? this.config?.agentId() ?? DEFAULT_AGENT_ID,
  );

  /**
   * Normalized license context derived from Core's structured and legacy
   * Runtime authority, with the same precedence as the React provider.
   */
  private readonly licenseContext = computed(() => {
    const runtimeLicenseStatus = this.copilotkit.licenseStatus();
    const runtimeEntitlements = this.copilotkit.runtimeEntitlements?.();
    const retryableRuntimeEntitlementFailure =
      runtimeEntitlements?.status !== "ready" &&
      runtimeEntitlements?.error.retryable === true;
    const hasNonReadyRuntimeEntitlement =
      runtimeEntitlements !== undefined &&
      runtimeEntitlements.status !== "ready";
    const hasLegacyRuntimeEntitlementFallback =
      runtimeLicenseStatus === "valid" || runtimeLicenseStatus === "expiring";
    const runtimeEntitlementRetryInProgress =
      retryableRuntimeEntitlementFailure &&
      (this.copilotkit.runtimeEntitlementRetryPending?.() ?? false) &&
      !hasLegacyRuntimeEntitlementFallback;
    const runtimeEntitlementFailureSettled =
      hasNonReadyRuntimeEntitlement &&
      !runtimeEntitlementRetryInProgress &&
      !hasLegacyRuntimeEntitlementFallback;
    const runtimeLicenseContext = createLicenseContextValue(
      runtimeEntitlementRetryInProgress ? undefined : runtimeLicenseStatus,
      runtimeEntitlements,
    );

    if (!runtimeEntitlementFailureSettled) {
      return runtimeLicenseContext;
    }

    return {
      ...runtimeLicenseContext,
      checkFeature: () => false,
      getLimit: () => null,
    };
  });

  /**
   * Two-pronged license gate, mirroring the React wrapper. `checkFeature` fails
   * OPEN (returns true) when no license is configured, so it cannot by itself
   * detect the no-license case; we therefore also require a positive
   * license-present signal. Only a resolved `valid`/`expiring` status counts as
   * present — a resolved `none`/`expired`/`invalid` gates the drawer to the
   * locked view.
   */
  protected readonly licensed = computed(() => {
    const ctx = this.licenseContext();
    const licensePresent = ctx.status === "valid" || ctx.status === "expiring";
    return licensePresent && ctx.checkFeature("threads");
  });

  /**
   * Whether the runtime has not yet reported a license status. The status is
   * `null` until the first `/info` response lands; treat that window as
   * "not yet unlicensed" — show the loading state, never the locked view — so a
   * licensed drawer never flashes (or strands) the Upgrade CTA mid-resolution.
   */
  protected readonly licensePending = computed(
    () => this.licenseContext().status === null,
  );

  /** Live thread list from the Intelligence platform for the resolved agent. */
  protected readonly threads = injectThreads({
    agentId: this.resolvedAgentId,
    includeArchived: true,
    limit: this.limit,
    // While unlicensed, skip the thread fetch entirely: the element shows only
    // its locked view and no `/threads` request is issued.
    enabled: this.licensed,
  });

  /** Thread records mapped to the element's {@link DrawerThread} shape. */
  protected readonly drawerThreads = computed(() =>
    this.threads.threads().map(toDrawerThread),
  );

  /**
   * User-facing error message from the filtered list error signal, or `null`
   * when there is no error. Uses `listError` (not `error`) so developer/config
   * errors (missing runtime URL, runtime without thread endpoints) are excluded
   * and never displayed to end users.
   */
  protected readonly errorMessage = computed(
    () => this.threads.listError()?.message ?? null,
  );

  /**
   * The currently-active thread id, sourced from the ambient chat
   * configuration, or `null` when no configuration is present.
   */
  protected readonly activeThreadId = computed(
    () => this.config?.threadId() ?? null,
  );

  /**
   * User-facing fetch-more error message from the dedicated fetch-more error
   * signal, or `null`. Drives the element's inline "couldn't load more — retry"
   * panel without disturbing the loaded list or the initial-list `error`.
   */
  protected readonly fetchMoreErrorMessage = computed(
    () => this.threads.fetchMoreError()?.message ?? null,
  );

  private readonly destroyRef = inject(DestroyRef);

  /**
   * Provider-less fallback open-state. Without a surrounding chat configuration
   * there is no shared open-state to bind to, so the wrapper keeps its own
   * local state. Starts CLOSED — matching the configuration's own default — so
   * the element does not spring open (and scroll-lock the page on mobile) on
   * load, and the element's `open-change` events still toggle it.
   */
  private readonly localDrawerOpen = signal(false);

  /**
   * The effective drawer open-state: the ambient chat configuration's
   * `drawerOpen` when present, else the provider-less {@link localDrawerOpen}.
   * Pushed onto the element's controlled `open` property in the effect below.
   */
  protected readonly drawerOpen = computed(() =>
    this.config ? this.config.drawerOpen() : this.localDrawerOpen(),
  );

  constructor() {
    defineCopilotKitThreadsDrawer();

    // Announce drawer presence to the surrounding chat configuration so a
    // future header launcher can render, and de-register on destroy. Mirrors
    // the React (`registerDrawer()` effect) and Vue (`onScopeDispose`) wrappers.
    const unregisterDrawer = this.config?.registerDrawer();
    if (unregisterDrawer) {
      this.destroyRef.onDestroy(unregisterDrawer);
    }

    // Push signal-derived values onto the element's JS properties every time
    // any reactive dependency changes. Using an effect (rather than template
    // bindings) is required because Lit elements accept object/boolean domains
    // only as JS properties, not as HTML attributes.
    effect(() => {
      const el = this.drawerRef()?.nativeElement;
      if (!el) return;
      el.threads = this.drawerThreads();
      // While the license is still resolving, force the loading state so the
      // element shows its spinner instead of an empty/locked body.
      el.loading = this.threads.isLoading() || this.licensePending();
      el.error = this.errorMessage();
      el.fetchMoreError = this.fetchMoreErrorMessage();
      el.activeThreadId = this.activeThreadId();
      el.hasMore = this.threads.hasMoreThreads();
      el.fetchingMore = this.threads.isFetchingMoreThreads();
      // Drive the element's controlled `open` from the (config-backed or local)
      // open-state so the element does not default open=true on load.
      el.open = this.drawerOpen();
      // Pending counts as licensed for rendering: the element shows the locked
      // view only when `licensed` is false, so keeping it true until the status
      // resolves prevents the locked view from flashing mid-resolution.
      el.licensed = this.licensed() || this.licensePending();
      if (this.label() !== undefined) el.label = this.label() as string;
      const licenseUrl = this.licenseUrl();
      if (licenseUrl !== undefined) el.licenseUrl = licenseUrl;
      // `collapsible` is a default-true boolean PROPERTY (like `licensed`);
      // leave the element's own default in place when the input is unset.
      const collapsible = this.collapsible();
      if (collapsible !== undefined) {
        // TODO(ENT-1051): drop the intersection cast once the published element
        // type declares `collapsible` (see the local CollapseChangeDetail note).
        (
          el as CopilotKitThreadsDrawerElement & { collapsible: boolean }
        ).collapsible = collapsible;
      }
    });
  }

  /**
   * Handles the `thread-selected` event from the drawer element.
   *
   * When a `threadSelectHandler` override is provided by the host, it is called
   * exclusively. Otherwise, the ambient chat configuration is driven directly so
   * a bare `<copilot-threads-drawer>` works without any host wiring.
   *
   * @param event - The raw DOM event; cast to `CustomEvent<ThreadSelectedDetail>` to extract `threadId`.
   */
  protected onThreadSelected(event: Event): void {
    const { threadId } = (event as CustomEvent<ThreadSelectedDetail>).detail;
    const handler = this.threadSelectHandler();
    if (handler) {
      handler(threadId);
    } else {
      this.config?.setActiveThreadId(threadId, { explicit: true });
    }
    // Return focus to the chat input so keyboard users land in the composer.
    // Scope the lookup to this drawer's own chat (not document-global). Mirrors
    // the React (`findChatInput(...).focus()`) and Vue (`focusChatInput()`)
    // wrappers.
    findChatInput(this.drawerRef()?.nativeElement ?? null)?.focus();
  }

  /**
   * Handles the `open-change` event from the drawer element.
   *
   * Drives the ambient chat configuration's `setDrawerOpen` when present, else
   * the provider-less {@link localDrawerOpen} fallback — mirroring the React
   * and Vue wrappers so the element's open-state stays coordinated.
   *
   * @param event - The raw DOM event; cast to `CustomEvent<OpenChangeDetail>` to extract `open`.
   */
  protected onOpenChange(event: Event): void {
    const { open } = (event as CustomEvent<OpenChangeDetail>).detail;
    if (this.config) {
      this.config.setDrawerOpen(open);
    } else {
      this.localDrawerOpen.set(open);
    }
  }

  /**
   * Handles the `new-thread` event from the drawer element.
   *
   * Always resets the core thread store to a fresh, non-explicit client-side
   * thread first. When a `newThreadHandler` override is provided by the host,
   * it is called exclusively. Otherwise, the ambient chat configuration is
   * driven directly so a bare `<copilot-threads-drawer>` works without any host wiring.
   */
  protected onNewThread(): void {
    this.threads.startNewThread();
    const handler = this.newThreadHandler();
    if (handler) {
      handler();
    } else {
      this.config?.startNewThread();
    }
  }

  /**
   * Handles the `archive` event from the drawer element.
   *
   * Delegates to the threads mutation and logs any failure to the console.
   *
   * @param event - The raw DOM event; cast to `CustomEvent<ArchiveDetail>` to extract `threadId`.
   */
  protected onArchive(event: Event): void {
    const { threadId } = (event as CustomEvent<ArchiveDetail>).detail;
    this.threads.archiveThread(threadId).catch((err) => {
      console.error("CopilotThreadsDrawer: archiveThread failed", err);
    });
  }

  /**
   * Handles the `unarchive` event from the drawer element.
   *
   * Delegates to the threads mutation and logs any failure to the console.
   *
   * @param event - The raw DOM event; cast to `CustomEvent<UnarchiveDetail>` to extract `threadId`.
   */
  protected onUnarchive(event: Event): void {
    const { threadId } = (event as CustomEvent<UnarchiveDetail>).detail;
    this.threads.unarchiveThread(threadId).catch((err) => {
      console.error("CopilotThreadsDrawer: unarchiveThread failed", err);
    });
  }

  /**
   * Handles the `delete` event from the drawer element.
   *
   * Deleting the active thread resets to a fresh, non-explicit thread so the
   * user is not stranded on a now-gone conversation. Archiving the active
   * thread keeps the user viewing it.
   *
   * The core `threads.startNewThread()` reset is always called when the deleted
   * thread was active. When a `newThreadHandler` override is provided by the
   * host, it is called exclusively; otherwise the ambient chat configuration is
   * driven directly.
   *
   * @param event - The raw DOM event; cast to `CustomEvent<DeleteDetail>` to extract `threadId`.
   */
  protected onDelete(event: Event): void {
    const { threadId } = (event as CustomEvent<DeleteDetail>).detail;
    const wasActive = threadId === this.activeThreadId();
    this.threads
      .deleteThread(threadId)
      .then(() => {
        if (wasActive) {
          this.threads.startNewThread();
          const handler = this.newThreadHandler();
          if (handler) {
            handler();
          } else {
            this.config?.startNewThread();
          }
        }
      })
      .catch((err) => {
        console.error("CopilotThreadsDrawer: deleteThread failed", err);
      });
  }

  /**
   * Handles the `filter-change` event from the drawer element.
   *
   * The element owns the Active/All filter; on change we refetch so the list
   * reflects the server.
   */
  protected onFilterChange(): void {
    this.threads.refetchThreads();
  }

  /**
   * Handles the `collapse-change` event from the drawer element — re-emits the
   * new collapsed state through the component's `collapseChange` output so hosts
   * can observe (or persist) the drawer's collapsed state.
   *
   * @param event - The raw DOM event; cast to `CustomEvent<CollapseChangeDetail>` to extract `collapsed`.
   */
  protected onCollapseChange(event: Event): void {
    const { collapsed } = (event as CustomEvent<CollapseChangeDetail>).detail;
    this.collapseChange.emit(collapsed);
  }

  /**
   * Handles the `retry` event from the drawer element.
   *
   * `scope` distinguishes an initial fetch retry from a fetch-more retry so
   * the correct pagination operation is invoked.
   *
   * @param event - The raw DOM event; cast to `CustomEvent<RetryDetail>` to extract `scope`.
   */
  protected onRetry(event: Event): void {
    const { scope } = (event as CustomEvent<RetryDetail>).detail;
    if (scope === "fetch-more") {
      this.threads.fetchMoreThreads();
    } else {
      this.threads.refetchThreads();
    }
  }

  /**
   * Handles the `load-more` event from the drawer element — advances pagination
   * by fetching the next page. No-op when there is no next page (the element
   * only surfaces the "Load more" control while `hasMoreThreads` is true).
   */
  protected onLoadMore(): void {
    this.threads.fetchMoreThreads();
  }

  /**
   * Handles the `licensed` event from the drawer element (Upgrade CTA click).
   *
   * The element performs its own default navigation to `licenseUrl`; this hook
   * lets the host observe the click (e.g. for telemetry) or drive a custom
   * upgrade flow when provided via `[onLicensed]`.
   */
  protected onLicensed(): void {
    this.licensedHandler()?.();
  }
}
