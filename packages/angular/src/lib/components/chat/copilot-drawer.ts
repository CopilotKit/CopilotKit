import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  TemplateRef,
  computed,
  contentChild,
  effect,
  inject,
  input,
  viewChild,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import {
  CopilotKitDrawer as CopilotKitDrawerElement,
  defineCopilotKitDrawer,
} from "@copilotkit/web-components/drawer";
import type {
  ArchiveDetail,
  DeleteDetail,
  DrawerThread,
  RetryDetail,
  ThreadSelectedDetail,
  UnarchiveDetail,
} from "@copilotkit/web-components/drawer";
import { COPILOT_CHAT_CONFIGURATION } from "../../chat-configuration";
import { injectThreads, type Thread } from "../../threads";

/**
 * Maps a {@link Thread} from the platform store onto the minimal
 * {@link DrawerThread} shape the `<copilotkit-drawer>` element accepts.
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
 * Structural directive that captures a per-row template for projection into
 * the `<copilotkit-drawer>` element as light-DOM children with
 * `slot="row:{id}"`.
 *
 * Apply it to an `<ng-template>` that is a direct child of `<copilot-drawer>`.
 * The implicit context variable (`let-t`) receives the full {@link Thread}
 * record for that row.
 *
 * @example
 * ```html
 * <copilot-drawer>
 *   <ng-template copilotDrawerRow let-t>
 *     <span>{{ t.name }}</span>
 *   </ng-template>
 * </copilot-drawer>
 * ```
 */
@Directive({ selector: "[copilotDrawerRow]", standalone: true })
export class CopilotDrawerRow {
  /** The captured template reference for the per-row content. */
  readonly template = inject(TemplateRef);
}

/**
 * Angular wrapper around the `<copilotkit-drawer>` Lit web component.
 *
 * Registers the custom element on construction (idempotent; SSR-guarded
 * internally by {@link defineCopilotKitDrawer}) and projects it into the DOM
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
 * <copilot-drawer data-testid="my-drawer" />
 * ```
 */
@Component({
  selector: "copilot-drawer",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [NgTemplateOutlet],
  template: `
    <copilotkit-drawer
      #drawer
      [attr.data-testid]="dataTestId()"
      (thread-selected)="onThreadSelected($event)"
      (new-thread)="onNewThread()"
      (archive)="onArchive($event)"
      (unarchive)="onUnarchive($event)"
      (delete)="onDelete($event)"
      (filter-change)="onFilterChange()"
      (retry)="onRetry($event)"
      (load-more)="onLoadMore()"
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
    </copilotkit-drawer>
  `,
})
export class CopilotDrawer {
  /**
   * Optional agent id whose threads this drawer lists/manages. Scopes the
   * {@link injectThreads} store (via the resolved-agent precedence: this input
   * → ambient config's `agentId` → {@link DEFAULT_AGENT_ID}). NOT forwarded to
   * the element (the element has no `agentId` property).
   */
  readonly agentId = input<string | undefined>();

  /**
   * Value applied as the `data-testid` attribute on the inner
   * `<copilotkit-drawer>` element. Defaults to `"copilot-drawer"`.
   */
  readonly dataTestId = input<string>("copilot-drawer", {
    alias: "data-testid",
  });

  /**
   * Optional accessible/region + default-header label forwarded to the element's
   * `label` property; defaults to the element's own `"Threads"` when unset.
   */
  readonly label = input<string | undefined>();

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

  private readonly config = inject(COPILOT_CHAT_CONFIGURATION, {
    optional: true,
  });

  private readonly drawerRef = viewChild<
    unknown,
    ElementRef<CopilotKitDrawerElement>
  >("drawer", {
    read: ElementRef,
  });

  /**
   * Optional per-row template directive projected as a direct child of this
   * component. When present, a `<div slot="row:{id}">` is rendered inside the
   * `<copilotkit-drawer>` element for each thread, allowing the host to inject
   * custom light-DOM content into each row slot.
   */
  protected readonly rowDirective = contentChild(CopilotDrawerRow);

  /**
   * The resolved agent id for the threads store. Precedence:
   * 1. `agentId` input prop.
   * 2. Ambient `CopilotChatConfiguration.agentId`.
   * 3. {@link DEFAULT_AGENT_ID}.
   */
  protected readonly resolvedAgentId = computed(
    () => this.agentId() ?? this.config?.agentId() ?? DEFAULT_AGENT_ID,
  );

  /** Live thread list from the Intelligence platform for the resolved agent. */
  protected readonly threads = injectThreads({
    agentId: this.resolvedAgentId,
    includeArchived: true,
    limit: this.limit,
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

  constructor() {
    defineCopilotKitDrawer();

    // Push signal-derived values onto the element's JS properties every time
    // any reactive dependency changes. Using an effect (rather than template
    // bindings) is required because Lit elements accept object/boolean domains
    // only as JS properties, not as HTML attributes.
    effect(() => {
      const el = this.drawerRef()?.nativeElement;
      if (!el) return;
      el.threads = this.drawerThreads();
      el.loading = this.threads.isLoading();
      el.error = this.errorMessage();
      el.activeThreadId = this.activeThreadId();
      el.hasMore = this.threads.hasMoreThreads();
      el.fetchingMore = this.threads.isFetchingMoreThreads();
      if (this.label() !== undefined) el.label = this.label() as string;
    });
  }

  /**
   * Handles the `thread-selected` event from the drawer element.
   *
   * When a `threadSelectHandler` override is provided by the host, it is called
   * exclusively. Otherwise, the ambient chat configuration is driven directly so
   * a bare `<copilot-drawer>` works without any host wiring.
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
  }

  /**
   * Handles the `new-thread` event from the drawer element.
   *
   * Always resets the core thread store to a fresh, non-explicit client-side
   * thread first. When a `newThreadHandler` override is provided by the host,
   * it is called exclusively. Otherwise, the ambient chat configuration is
   * driven directly so a bare `<copilot-drawer>` works without any host wiring.
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
      console.error("CopilotDrawer: archiveThread failed", err);
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
      console.error("CopilotDrawer: unarchiveThread failed", err);
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
        console.error("CopilotDrawer: deleteThread failed", err);
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
}
