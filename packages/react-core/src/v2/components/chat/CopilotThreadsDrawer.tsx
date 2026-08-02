"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  defineCopilotKitThreadsDrawer,
  COPILOTKIT_THREADS_DRAWER_TAG,
} from "@copilotkit/web-components/threads-drawer";
import type {
  CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement,
  DrawerThread,
  ThreadSelectedDetail,
  ArchiveDetail,
  UnarchiveDetail,
  DeleteDetail,
  OpenChangeDetail,
  RetryDetail,
} from "@copilotkit/web-components/threads-drawer";
// TODO(ENT-1051): import `CollapseChangeDetail` from
// "@copilotkit/web-components/threads-drawer" once the parallel element PR that
// adds the collapse feature (property `collapsible` + event `collapse-change`)
// lands and is published; declared locally here because the built element types
// in this worktree predate it.
type CollapseChangeDetail = { collapsed: boolean };
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useThreads } from "../../hooks/use-threads";
import type { Thread } from "../../hooks/use-threads";
import { useLicenseContext } from "../../providers/CopilotKitProvider";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";

/**
 * Per-row content render function. Receives a thread and returns the React
 * node to project into the element's `slot="row:{id}"`. Returning `null`
 * (or omitting the prop) falls back to the element's built-in row name.
 */
export type CopilotThreadsDrawerRowRenderer = (
  thread: Thread,
) => React.ReactNode;

/**
 * Props for {@link CopilotThreadsDrawer}.
 *
 * The drawer is a thin controller around the framework-agnostic
 * `<copilotkit-threads-drawer>` custom element. It feeds the element domain data
 * (threads/loading/error from {@link useThreads}, the active thread from the
 * chat configuration) and routes the element's outbound DOM events back into
 * core thread operations and chat-configuration changes.
 */
export interface CopilotThreadsDrawerProps {
  /**
   * The agent whose threads to list and manage. Defaults to the agent of the
   * surrounding chat configuration, or the platform default when none is set.
   */
  agentId?: string;
  /**
   * Optional escape-hatch called when the user picks a thread row. The wrapper
   * additionally focuses the chat input. When omitted, the wrapper drives the
   * surrounding chat configuration directly (`setActiveThreadId`), so a bare
   * `<CopilotThreadsDrawer>` switches the rendered thread with no host wiring. Provide
   * this only to take control of the active thread yourself (e.g. a v1
   * `setThreadId`); when provided it is preferred over the provider.
   */
  onThreadSelect?: (threadId: string) => void;
  /**
   * Optional escape-hatch called when the user starts a new thread (the
   * element's "+ New" button). The wrapper always resets the core thread store
   * to a fresh, non-explicit client-side thread (`startNewThread`). When this
   * is omitted, the wrapper also resets the surrounding chat configuration to a
   * fresh non-explicit thread (`startNewThread`) so the welcome screen shows
   * with no host wiring. Provide this only to clear your own active thread;
   * when provided it is preferred over the provider.
   */
  onNewThread?: () => void;
  /** Called when the Upgrade CTA is clicked. */
  onLicensed?: () => void;
  /**
   * Destination the locked view's Upgrade CTA opens in a new tab. Defaults to
   * the element's built-in CopilotKit Intelligence docs URL when omitted. Set
   * to an empty string to suppress the default navigation and handle the click
   * yourself via `onLicensed`.
   */
  licenseUrl?: string;
  /**
   * Optional per-row content. Rendered as light-DOM children with
   * `slot="row:{id}"` so the element projects them in place of the default
   * row name. Return `null` for a given row to keep the element's default.
   */
  renderRow?: CopilotThreadsDrawerRowRenderer;
  /**
   * Accessible + default-header label for the drawer region. Sets the custom
   * element's `aria-label` and the default header text (shown when no
   * `slot="header"` content is projected). Defaults to the element's built-in
   * `"Threads"` when omitted.
   */
  label?: string;
  /**
   * Heading for the "Recent Conversations" section above the thread list. Sets
   * the custom element's `recent-label` attribute. Defaults to the element's
   * built-in `"Recent Conversations"` when omitted.
   */
  recentLabel?: string;
  /**
   * Whether the drawer offers a collapse toggle. Sets the custom element's
   * `collapsible` PROPERTY. When `false`, the drawer has no collapse toggle and
   * is always expanded. Defaults to the element's built-in `true` when omitted.
   */
  collapsible?: boolean;
  /**
   * Called when the drawer's collapsed state changes (via the element's collapse
   * toggle), with the new collapsed state. Mirrors the element's
   * `collapse-change` event.
   */
  onCollapseChange?: (collapsed: boolean) => void;
  /**
   * Overrides the thread page size. The default is 50 threads per page.
   * Cursor pagination stays active when this is omitted: `nextCursor` controls
   * whether the drawer shows a "Load more" control.
   */
  limit?: number;
  /**
   * `data-testid` set on the underlying custom element (handy in tests and for
   * targeting from a host page). Defaults to `"copilot-threads-drawer"`.
   */
  "data-testid"?: string;
}

/**
 * Maps a {@link Thread} from {@link useThreads} to the element's
 * {@link DrawerThread} view shape. The shapes are structurally compatible; this
 * narrows to exactly the fields the element renders so the element never sees
 * platform-internal fields.
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

/** The chat input textarea's documented `data-testid`. */
const CHAT_INPUT_TESTID = "copilot-chat-textarea";
/** The chat view container's documented `data-testid`. */
const CHAT_CONTAINER_TESTID = "copilot-chat";

/**
 * Returns the chat input element for focus-return after a thread is selected.
 *
 * Best-effort and SCOPED: walks up from the drawer element looking for an
 * ancestor that contains a chat-view container (`data-testid="copilot-chat"`),
 * then returns the chat input within that subtree. This avoids focusing the
 * wrong composer on a page hosting more than one chat (multi-chat dashboards),
 * where a document-global lookup would grab whichever input appears first in
 * DOM order rather than the one this drawer drives.
 *
 * Falls back to a document-global lookup when no scoping ancestor is found
 * (e.g. the drawer and chat share no common container, or headless usage),
 * and returns `null` when there is no chat input at all.
 *
 * @param origin - The drawer element to scope the search from.
 */
function findChatInput(origin: Element | null): HTMLElement | null {
  if (typeof document === "undefined") return null;

  // The drawer lives inside (or alongside) its own chat-view container. Find the
  // nearest such container with `closest` and scope the input lookup to it, so a
  // page hosting multiple chats focuses THIS drawer's composer rather than
  // whichever input appears first in DOM order. Walking up by "ancestor that
  // *contains* a chat" would instead climb past the drawer's own container (which
  // holds no nested chat) to the shared root and grab the first chat on the page.
  const container = origin?.closest?.(
    `[data-testid="${CHAT_CONTAINER_TESTID}"]`,
  );
  if (container) {
    const scoped = container.querySelector<HTMLElement>(
      `[data-testid="${CHAT_INPUT_TESTID}"]`,
    );
    if (scoped) return scoped;
  }

  // No scoping container found (drawer and chat share no common container, or
  // headless usage): fall back to a document-global lookup.
  return document.querySelector<HTMLElement>(
    `[data-testid="${CHAT_INPUT_TESTID}"]`,
  );
}

/**
 * React wrapper for the shadow-DOM `<copilotkit-threads-drawer>` threads drawer.
 *
 * Responsibilities:
 * - Registers the custom element on the client (SSR-safe; nothing renders
 *   during prerender to avoid hydration mismatch).
 * - Feeds the element domain data: `threads`, `loading`, `error`,
 *   `activeThreadId`, `licensed`, fetch-more state.
 * - Routes the element's outbound events to core thread operations
 *   ({@link useThreads}) and chat-configuration changes.
 * - Registers with the surrounding chat configuration so the header
 *   thread-list launcher appears, and binds the element `open` state to the
 *   configuration's `drawerOpen`.
 *
 * License gating is two-pronged: the locked view shows when no license is configured
 * (the runtime reported no license status) OR the `threads` feature is
 * explicitly unlicensed. While unlicensed, the thread fetch is skipped entirely
 * so an unlicensed drawer issues no network requests.
 *
 * Thread switching needs no host wiring: when `onThreadSelect`/`onNewThread`
 * are omitted, the wrapper drives the surrounding chat configuration directly
 * ({@link CopilotChatConfigurationValue.setActiveThreadId} /
 * {@link CopilotChatConfigurationValue.startNewThread}), so a bare drawer
 * connects to the picked thread and shows the welcome screen on "+ New". Pass
 * the callbacks only to take control yourself.
 *
 * @example
 * ```tsx
 * // Callback-free: the drawer drives the chat configuration itself.
 * <CopilotKitProvider runtimeUrl="/api/copilotkit" publicLicenseKey="ck_pub_...">
 *   <CopilotChat />
 *   <CopilotThreadsDrawer />
 * </CopilotKitProvider>
 * ```
 */
export function CopilotThreadsDrawer({
  agentId,
  onThreadSelect,
  onNewThread,
  onLicensed,
  licenseUrl,
  renderRow,
  label,
  recentLabel,
  collapsible,
  onCollapseChange,
  limit,
  "data-testid": dataTestId = "copilot-threads-drawer",
}: CopilotThreadsDrawerProps): React.ReactElement | null {
  const configuration = useCopilotChatConfiguration();
  const { status, checkFeature } = useLicenseContext();

  // Two-pronged license gate. `checkFeature` fails OPEN (returns true) when no
  // license is configured, so it cannot by itself detect the no-license case.
  // We therefore also require a positive license-present signal from the
  // runtime-reported status. Only a "valid" or "expiring" license is treated
  // as present; a resolved "none"/"expired"/"invalid" status gates the drawer
  // to the locked view.
  const licensePresent = status === "valid" || status === "expiring";
  const featureLicensed = checkFeature("threads");
  const licensed = licensePresent && featureLicensed;

  // The runtime reports license status asynchronously: `status` is null until
  // the first /info response lands. Treat that pending window as "not yet
  // unlicensed" — show the loading state, never the locked view — so a licensed
  // drawer doesn't flash the upgrade CTA before its license resolves (and never
  // strands the CTA on screen when the status is slow or fails to arrive). Only
  // a RESOLVED-negative status (`none`/`expired`/`invalid`, or a present license
  // missing the `threads` feature) surfaces the locked view.
  const licensePending = status === null;

  const resolvedAgentId = agentId ?? configuration?.agentId ?? DEFAULT_AGENT_ID;
  const activeThreadId = configuration?.threadId ?? null;

  // While unlicensed, skip the thread fetch entirely: the element shows only
  // its locked view and no `/threads` request is issued.
  const {
    threads,
    isLoading,
    listError,
    fetchMoreError,
    hasMoreThreads,
    isFetchingMoreThreads,
    archiveThread,
    unarchiveThread,
    deleteThread,
    fetchMoreThreads,
    refetchThreads,
    startNewThread,
  } = useThreads({
    agentId: resolvedAgentId,
    includeArchived: true,
    enabled: licensed,
    ...(limit !== undefined ? { limit } : {}),
  });

  const drawerThreads = useMemo(() => threads.map(toDrawerThread), [threads]);

  const elementRef = useRef<CopilotKitThreadsDrawerElement | null>(null);

  // Register the custom element on the client only. `customElements` is absent
  // during SSR/prerender; gating the render below on `mounted` keeps the server
  // output empty so there is no hydration mismatch or layout shift.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    defineCopilotKitThreadsDrawer();
    setMounted(true);
  }, []);

  // Announce presence to the surrounding chat configuration so the header
  // launcher renders; de-register on unmount. Depend on the stable
  // `registerDrawer` callback, NOT the whole `configuration` object — the
  // object's identity changes on every drawer/modal/label update, which would
  // otherwise churn register/de-register each render and momentarily drop
  // `drawerRegistered` (flickering the header launcher).
  const registerDrawer = configuration?.registerDrawer;
  useEffect(() => {
    if (!registerDrawer) return;
    return registerDrawer();
  }, [registerDrawer]);

  // Drive the chat configuration's drawerOpen from the element's open-change
  // event, and reflect drawerOpen back onto the element below.
  //
  // Provider-less fallback: without a surrounding chat configuration there is no
  // shared open-state to bind to, so the wrapper keeps its own local open-state.
  // It starts CLOSED — matching the provider's own `ownDrawerOpen` default of
  // `false` — so a bare `<CopilotThreadsDrawer>` does not render stuck-open and the
  // element's open-change events still toggle it.
  const [localDrawerOpen, setLocalDrawerOpen] = useState(false);
  const drawerOpen = configuration ? configuration.drawerOpen : localDrawerOpen;
  const setDrawerOpen = configuration
    ? configuration.setDrawerOpen
    : setLocalDrawerOpen;

  // --- Event handlers (stable via refs to the latest closures) -------------
  // The element is imperatively wired with addEventListener once; we keep the
  // latest handler implementations in a ref so listeners need not be re-bound
  // every render (which would churn on each thread/loading change).

  // Prefer the host callbacks when provided; otherwise drive the surrounding
  // chat configuration directly so a bare `<CopilotThreadsDrawer>` works callback-free.
  const setActiveThreadId = configuration?.setActiveThreadId;
  const startNewThreadConfig = configuration?.startNewThread;

  const handleThreadSelected = useCallback(
    (threadId: string) => {
      if (onThreadSelect) {
        onThreadSelect(threadId);
      } else {
        // Selecting a row is an explicit, caller-driven thread choice: connect
        // the chat to that backend thread (suppresses the welcome screen).
        setActiveThreadId?.(threadId, { explicit: true });
      }
      // Return focus to the chat input so keyboard users land in the composer.
      // Scope the lookup to this drawer's own chat (not document-global).
      findChatInput(elementRef.current)?.focus();
    },
    [onThreadSelect, setActiveThreadId],
  );

  const handleNewThread = useCallback(() => {
    // Reset the core thread store to a fresh, non-explicit client-side thread
    // (clears any stale error so the welcome screen can render cleanly).
    startNewThread();
    if (onNewThread) {
      onNewThread();
    } else {
      // No host callback: reset the surrounding chat configuration to a fresh,
      // non-explicit thread so the welcome screen shows with no host wiring.
      startNewThreadConfig?.();
    }
  }, [startNewThread, onNewThread, startNewThreadConfig]);

  const handleArchive = useCallback(
    (threadId: string) => {
      void archiveThread(threadId).catch((err) => {
        console.error("CopilotThreadsDrawer: archiveThread failed", err);
      });
    },
    [archiveThread],
  );

  const handleUnarchive = useCallback(
    (threadId: string) => {
      void unarchiveThread(threadId).catch((err) => {
        console.error("CopilotThreadsDrawer: unarchiveThread failed", err);
      });
    },
    [unarchiveThread],
  );

  const handleDelete = useCallback(
    (threadId: string) => {
      // Deleting the active thread resets to a fresh, non-explicit thread so the
      // user is not stranded on a now-gone conversation. Archiving the active
      // thread keeps the user viewing it.
      const isActive = threadId === activeThreadId;
      // The core thread store performs the optimistic removal (and rollback on
      // failure) in its own reducer, so the wrapper holds no removal bookkeeping
      // of its own — it simply renders the threads the store hands it.
      void deleteThread(threadId)
        .then(() => {
          if (isActive) {
            startNewThread();
            if (onNewThread) {
              onNewThread();
            } else {
              startNewThreadConfig?.();
            }
          }
        })
        .catch((err) => {
          console.error("CopilotThreadsDrawer: deleteThread failed", err);
        });
    },
    [
      deleteThread,
      activeThreadId,
      startNewThread,
      onNewThread,
      startNewThreadConfig,
    ],
  );

  const handleFilterChange = useCallback(() => {
    // The element owns the Active/All filter; on change we refetch so the list
    // reflects the server.
    refetchThreads();
  }, [refetchThreads]);

  const handleRetry = useCallback(
    (scope: RetryDetail["scope"]) => {
      if (scope === "fetch-more") {
        fetchMoreThreads();
      } else {
        refetchThreads();
      }
    },
    [fetchMoreThreads, refetchThreads],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setDrawerOpen(open);
    },
    [setDrawerOpen],
  );

  const handleLicensed = useCallback(() => {
    onLicensed?.();
  }, [onLicensed]);

  const handleLoadMore = useCallback(() => {
    // Advance pagination. No-op when there is no next page; the element only
    // surfaces the "Load more" control while `hasMore` is true.
    fetchMoreThreads();
  }, [fetchMoreThreads]);

  const handleCollapseChange = useCallback(
    (collapsed: boolean) => {
      onCollapseChange?.(collapsed);
    },
    [onCollapseChange],
  );

  // Keep a ref to the live handlers so the addEventListener effect can stay
  // stable (bind once) while still calling the freshest closures.
  const handlersRef = useRef({
    handleThreadSelected,
    handleNewThread,
    handleArchive,
    handleUnarchive,
    handleDelete,
    handleFilterChange,
    handleRetry,
    handleOpenChange,
    handleLicensed,
    handleLoadMore,
    handleCollapseChange,
  });
  handlersRef.current = {
    handleThreadSelected,
    handleNewThread,
    handleArchive,
    handleUnarchive,
    handleDelete,
    handleFilterChange,
    handleRetry,
    handleOpenChange,
    handleLicensed,
    handleLoadMore,
    handleCollapseChange,
  };

  // Bind the outbound DOM events once the element exists. Listeners are
  // bound a single time and cleaned up on unmount; they dispatch through the
  // handlers ref so they always invoke the latest closures.
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const onThreadSelected = (event: Event) => {
      const detail = (event as CustomEvent<ThreadSelectedDetail>).detail;
      handlersRef.current.handleThreadSelected(detail.threadId);
    };
    const onNewThreadEvent = () => handlersRef.current.handleNewThread();
    const onArchive = (event: Event) => {
      const detail = (event as CustomEvent<ArchiveDetail>).detail;
      handlersRef.current.handleArchive(detail.threadId);
    };
    const onUnarchive = (event: Event) => {
      const detail = (event as CustomEvent<UnarchiveDetail>).detail;
      handlersRef.current.handleUnarchive(detail.threadId);
    };
    const onDelete = (event: Event) => {
      const detail = (event as CustomEvent<DeleteDetail>).detail;
      handlersRef.current.handleDelete(detail.threadId);
    };
    const onFilterChange = (_event: Event) => {
      handlersRef.current.handleFilterChange();
    };
    const onOpenChangeEvent = (event: Event) => {
      const detail = (event as CustomEvent<OpenChangeDetail>).detail;
      handlersRef.current.handleOpenChange(detail.open);
    };
    const onRetry = (event: Event) => {
      const detail = (event as CustomEvent<RetryDetail>).detail;
      handlersRef.current.handleRetry(detail.scope);
    };
    const onLicensedEvent = () => handlersRef.current.handleLicensed();
    const onLoadMore = () => handlersRef.current.handleLoadMore();
    const onCollapseChangeEvent = (event: Event) => {
      const detail = (event as CustomEvent<CollapseChangeDetail>).detail;
      handlersRef.current.handleCollapseChange(detail.collapsed);
    };

    el.addEventListener("thread-selected", onThreadSelected);
    el.addEventListener("new-thread", onNewThreadEvent);
    el.addEventListener("archive", onArchive);
    el.addEventListener("unarchive", onUnarchive);
    el.addEventListener("delete", onDelete);
    el.addEventListener("filter-change", onFilterChange);
    el.addEventListener("open-change", onOpenChangeEvent);
    el.addEventListener("retry", onRetry);
    el.addEventListener("licensed", onLicensedEvent);
    el.addEventListener("load-more", onLoadMore);
    el.addEventListener("collapse-change", onCollapseChangeEvent);

    return () => {
      el.removeEventListener("thread-selected", onThreadSelected);
      el.removeEventListener("new-thread", onNewThreadEvent);
      el.removeEventListener("archive", onArchive);
      el.removeEventListener("unarchive", onUnarchive);
      el.removeEventListener("delete", onDelete);
      el.removeEventListener("filter-change", onFilterChange);
      el.removeEventListener("open-change", onOpenChangeEvent);
      el.removeEventListener("retry", onRetry);
      el.removeEventListener("licensed", onLicensedEvent);
      el.removeEventListener("load-more", onLoadMore);
      el.removeEventListener("collapse-change", onCollapseChangeEvent);
    };
    // Re-bind only after the first client mount (deps: [mounted]); the element
    // ref is stable thereafter.
  }, [mounted]);

  // Assign object/array/boolean PROPERTIES imperatively. React would otherwise
  // set these as string attributes, which a custom element cannot accept for
  // arrays/objects. Setting them as instance properties is the correct interop.
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    el.threads = drawerThreads;
  }, [drawerThreads, mounted]);

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    // While the license is still resolving, force the loading state so the
    // element shows its spinner instead of an empty/unlicensed body.
    el.loading = isLoading || licensePending;
    // Only genuine list-load/mutation errors reach the end user. Developer/
    // config errors (missing runtime URL, runtime without thread endpoints) are
    // excluded via `listError` so they never leak into the drawer's error UI.
    el.error = listError ? listError.message : null;
    el.activeThreadId = activeThreadId;
    // Pending counts as licensed for rendering: `_renderBody` shows the locked view
    // only when `licensed` is false, so keeping it true until the status
    // resolves prevents the locked view from flashing (or sticking) mid-resolution.
    el.licensed = licensed || licensePending;
    el.hasMore = hasMoreThreads;
    el.fetchingMore = isFetchingMoreThreads;
    // Dedicated fetch-more error channel: drives the element's inline
    // "couldn't load more — retry" panel without disturbing the loaded list or
    // the initial-list `error`. The `retry{scope:"fetch-more"}` handler
    // becomes reachable once this panel renders.
    el.fetchMoreError = fetchMoreError ? fetchMoreError.message : null;
  }, [
    isLoading,
    listError,
    fetchMoreError,
    activeThreadId,
    licensed,
    licensePending,
    hasMoreThreads,
    isFetchingMoreThreads,
    mounted,
  ]);

  // Bind the element's controlled `open` to the chat configuration's
  // drawerOpen, so the header launcher and the element stay in sync.
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    el.open = drawerOpen;
  }, [drawerOpen, mounted]);

  // Mirror the optional `label` onto the element (its accessible + default
  // header text). Leave the element's built-in default ("Threads") in place
  // when the prop is omitted, rather than clobbering it with undefined.
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    if (label !== undefined) el.label = label;
  }, [label, mounted]);

  // Mirror the optional `licenseUrl` onto the element (the locked view's
  // Upgrade CTA destination). Leave the element's built-in default in place
  // when the prop is omitted, rather than clobbering it with undefined.
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    if (licenseUrl !== undefined) el.licenseUrl = licenseUrl;
  }, [licenseUrl, mounted]);

  // Mirror the optional `collapsible` onto the element as a PROPERTY (a
  // default-true boolean, exactly like `licensed` — a string attribute cannot
  // represent it since any non-empty value is truthy). Leave the element's
  // built-in default (`true`) in place when the prop is omitted, rather than
  // clobbering it with undefined.
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    if (collapsible !== undefined) {
      // TODO(ENT-1051): drop the intersection cast once the published element
      // type declares `collapsible` (see the local CollapseChangeDetail note).
      (
        el as CopilotKitThreadsDrawerElement & { collapsible: boolean }
      ).collapsible = collapsible;
    }
  }, [collapsible, mounted]);

  // Per-row light-DOM children projected via `slot="row:{id}"`.
  const rowChildren = useMemo(() => {
    if (!renderRow) return null;
    return drawerThreads.map((drawerThread) => {
      const fullThread = threads.find((t) => t.id === drawerThread.id);
      if (!fullThread) return null;
      const content = renderRow(fullThread);
      if (content === null || content === undefined) return null;
      return (
        <div key={drawerThread.id} slot={`row:${drawerThread.id}`}>
          {content}
        </div>
      );
    });
  }, [renderRow, drawerThreads, threads]);

  // SSR / pre-mount: render nothing so the server output matches the initial
  // client render (the element is not yet registered), avoiding hydration
  // mismatch and layout shift.
  if (!mounted) return null;

  return React.createElement(
    COPILOTKIT_THREADS_DRAWER_TAG,
    {
      ref: elementRef,
      "data-testid": dataTestId,
      // Pass the section heading label as an attribute; omit it entirely when
      // unset so the element keeps its built-in default rather than receiving
      // an `undefined` that would clobber it.
      ...(recentLabel !== undefined ? { "recent-label": recentLabel } : {}),
    },
    rowChildren,
  );
}

CopilotThreadsDrawer.displayName = "CopilotThreadsDrawer";

export default CopilotThreadsDrawer;
