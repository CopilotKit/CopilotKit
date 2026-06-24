import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
import {
  defineCopilotkitDrawer,
  type DrawerFilter,
  type DrawerThread,
  type DrawerThreadRenderer,
  type ArchiveDetail,
  type DeleteDetail,
  type FilterChangeDetail,
  type OpenChangeDetail,
  type ThreadSelectedDetail,
  type UnarchiveDetail,
  type CopilotkitDrawer as CopilotkitDrawerElement,
} from "@copilotkit/web-components";

import { ThreadsContext } from "../../../context/threads-context";
import { useLicenseContext } from "../../providers/CopilotKitProvider";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { useThreads } from "../../hooks/use-threads";

// Register `<copilotkit-drawer>` with the custom element registry as an
// import side-effect. `defineCopilotkitDrawer()` is idempotent and a no-op in
// non-DOM environments, so calling it at module scope is safe under SSR and in
// repeated imports — the element is guaranteed to exist before React ever
// renders the wrapper below.
defineCopilotkitDrawer();

/**
 * The `licensed` feature key the drawer gates on. Mirrors the
 * `"sidebar"`/`"popup"` per-component convention used elsewhere in v2. The
 * element renders its own built-in upsell state when `licensed` is `false`.
 */
const DRAWER_LICENSE_FEATURE = "threads";

/**
 * Props for {@link CopilotDrawer}.
 *
 * All props are optional. Like every CopilotKit component, the drawer requires
 * a `<CopilotKit>` (i.e. `CopilotKitProvider`) ancestor — it reads the thread
 * list from {@link useThreads} and the license flag from the license context,
 * both of which throw outside that provider. Given that ancestor, a bare
 * `<CopilotDrawer />` self-connects: it reads the active thread from the chat
 * configuration, opens with the chat tri-state, and routes selection back
 * through the platform's `setThreadId`. The only graceful degradation is the
 * absence of a `ThreadsProvider`: active-thread writes become a no-op rather
 * than throwing. The controlled props below are a secondary escape hatch for
 * callers that own thread routing themselves.
 */
export interface CopilotDrawerProps {
  /**
   * Agent whose threads to list. Defaults to the chat configuration's agent
   * (falling back to {@link DEFAULT_AGENT_ID}). Must match the agent the
   * surrounding chat is bound to so the drawer and chat share a thread list.
   */
  agentId?: string;
  /**
   * Controlled active thread id. When supplied, the drawer highlights this
   * thread and does NOT read the active thread from context. You MUST pair it
   * with {@link onThreadSelect} to handle selection: in controlled mode the
   * wrapper never writes the platform `setThreadId` (doing so would mutate the
   * real active thread while the highlight stays frozen on this prop), so a
   * controlled drawer with no `onThreadSelect` treats selection / new-thread as
   * a no-op (and warns in dev). Omit for the default uncontrolled behavior
   * (read from / write to the platform thread state).
   */
  threadId?: string;
  /**
   * Selection handler. Invoked with the chosen thread id on `thread-selected`
   * and with a freshly-minted id on `new-thread`. When omitted, the drawer
   * drives the platform's `setThreadId` itself (uncontrolled default).
   */
  onThreadSelect?: (threadId: string) => void;
  /**
   * Render as a mobile off-canvas overlay (with backdrop + scroll lock) rather
   * than an in-flow desktop panel. Forwarded to the element's `overlay` prop.
   */
  overlay?: boolean;
  /** Optional per-row render hook forwarded to the element. */
  renderThread?: DrawerThreadRenderer;
}

/**
 * The concrete custom-element instance type, narrowed to the inbound property
 * surface the wrapper assigns. Keeping this local (rather than reaching for the
 * global JSX intrinsic) lets us set object/array properties imperatively, which
 * React cannot do declaratively for non-standard custom-element props.
 */
type DrawerElement = CopilotkitDrawerElement;

/**
 * Map a v2 {@link useThreads} record to the element's minimal
 * {@link DrawerThread} view. The element only reads the fields it renders, so
 * this is an intentionally lossy, presentation-only projection.
 *
 * @param thread - A platform thread record from {@link useThreads}.
 * @returns The drawer-facing thread shape.
 */
function toDrawerThread(thread: {
  id: string;
  name: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}): DrawerThread {
  return {
    id: thread.id,
    name: thread.name,
    archived: thread.archived,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastRunAt: thread.lastRunAt ?? null,
  };
}

/**
 * React wrapper around the framework-agnostic `<copilotkit-drawer>` Lit custom
 * element from `@copilotkit/web-components`.
 *
 * The element is fully controlled: state flows IN as element properties and
 * user intent flows OUT as DOM `CustomEvent`s. This wrapper is the React-side
 * controller — it sources the inbound properties from the platform
 * (`useThreads` for the list, the chat configuration for the active thread, the
 * license context for the `licensed` flag, the chat tri-state for `open`) and
 * routes the seven outbound events back to thread mutations and active-thread /
 * modal-state changes.
 *
 * Because React does not assign non-standard properties or bind custom events
 * declaratively, the wrapper holds a `ref` to the element and uses effects to
 * (a) assign object/array/boolean properties and (b) `addEventListener` for
 * each event, cleaning the listeners up on unmount.
 *
 * Coordination with the chat (tri-state from `CopilotChatConfigurationProvider`):
 * the drawer is open when `modalState === "threads"`. Selecting a thread,
 * starting a new thread, or closing the overlay returns the surface to
 * `"chat"`, giving the mobile two-panel mutual exclusivity.
 *
 * @param props - See {@link CopilotDrawerProps}. All optional; a bare
 *   `<CopilotDrawer />` self-connects given a `CopilotKitProvider` ancestor
 *   (required, as for any CopilotKit component).
 * @returns The wrapped `<copilotkit-drawer>` element.
 *
 * @example
 * ```tsx
 * import { CopilotKit, CopilotChat, CopilotDrawer } from "@copilotkit/react-core";
 *
 * function App() {
 *   return (
 *     <CopilotKit runtimeUrl="/api/copilotkit">
 *       <CopilotDrawer />
 *       <CopilotChat />
 *     </CopilotKit>
 *   );
 * }
 * ```
 */
export function CopilotDrawer({
  agentId,
  threadId: controlledThreadId,
  onThreadSelect,
  overlay = false,
  renderThread,
}: CopilotDrawerProps = {}) {
  const elementRef = useRef<DrawerElement | null>(null);

  // --- Active-thread wiring ----------------------------------------------
  // Read the active thread from the chat configuration (what the chat is
  // actually rendering); write it through the platform ThreadsContext setter.
  // Consume ThreadsContext directly (rather than the throwing v1 `useThreads`
  // accessor) so that the *active-thread write path* degrades to a no-op when
  // no `ThreadsProvider` is present, instead of throwing. This is the only part
  // that degrades — the wrapper still requires a `CopilotKitProvider` ancestor
  // (the v2 `useThreads`/license hooks below throw without one).
  const chatConfig = useCopilotChatConfiguration();
  const threadsState = useContext(ThreadsContext);

  const isControlled = controlledThreadId !== undefined;
  const activeThreadId = isControlled
    ? controlledThreadId
    : (chatConfig?.threadId ?? threadsState?.threadId ?? null);

  // Route a thread id to either the controlled callback or the platform setter.
  // In controlled mode (an explicit `threadId` prop is supplied) the wrapper
  // must NOT write the platform `setThreadId`: doing so would mutate the real
  // active thread while the element's highlight stays frozen on the unchanged
  // controlled prop. Controlled callers route selection exclusively through
  // `onThreadSelect`; without it, selection is a no-op (and warns in dev).
  const applyThreadId = useCallback(
    (nextThreadId: string) => {
      if (onThreadSelect) {
        onThreadSelect(nextThreadId);
        return;
      }
      if (isControlled) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            "[CopilotKit] CopilotDrawer: a controlled `threadId` was supplied " +
              "without `onThreadSelect`; thread selection is a no-op. Pass " +
              "`onThreadSelect` to handle selection, or omit `threadId` for " +
              "uncontrolled platform routing.",
          );
        }
        return;
      }
      threadsState?.setThreadId(nextThreadId);
    },
    [onThreadSelect, isControlled, threadsState],
  );

  // --- License gating -----------------------------------------------------
  // Resolved before the list hook so an unlicensed drawer skips the fetch
  // entirely: the element only renders its built-in upsell when unlicensed and
  // never shows the list, so issuing list/subscribe requests would be wasted.
  const { checkFeature } = useLicenseContext();
  const licensed = checkFeature(DRAWER_LICENSE_FEATURE);

  // --- Thread list + mutations -------------------------------------------
  const resolvedAgentId = agentId ?? chatConfig?.agentId ?? DEFAULT_AGENT_ID;
  const {
    threads,
    isLoading,
    error,
    archiveThread,
    unarchiveThread,
    deleteThread,
  } = useThreads({
    agentId: resolvedAgentId,
    includeArchived: true,
    enabled: licensed,
  });

  useEffect(() => {
    if (!licensed) {
      console.warn(
        '[CopilotKit] Warning: "threads" feature is not licensed. Visit copilotkit.ai/pricing',
      );
    }
  }, [licensed]);

  // --- Local filter state (fed back into the element on filter-change) ----
  const [filter, setFilter] = useState<DrawerFilter>("active");

  // --- Open state (tri-state coordination) --------------------------------
  const open = chatConfig?.modalState === "threads";

  // Remember the surface that was showing before the drawer opened, so that
  // dismissing the drawer (`open-change` false) returns there instead of
  // unconditionally forcing the chat panel open. While the threads panel is
  // open the live `modalState` is `"threads"`, so we cannot read the prior
  // surface at close time — we capture it here on every non-threads render.
  // Defaults to `"none"`: a drawer dismissed without a prior chat surface
  // collapses rather than springing the chat open.
  const priorSurfaceRef = useRef<"none" | "chat">("none");
  useEffect(() => {
    if (chatConfig?.modalState === "chat") {
      priorSurfaceRef.current = "chat";
    } else if (chatConfig?.modalState === "none") {
      priorSurfaceRef.current = "none";
    }
    // "threads" leaves the prior surface untouched.
  }, [chatConfig?.modalState]);

  // --- Stable handlers for the seven outbound events ----------------------
  // Kept in a ref so the listener-binding effect can attach once and not churn
  // listeners every render while still calling the freshest handler.
  const setModalState = chatConfig?.setModalState;

  const noop = () => {};
  const handlers = useRef<{
    threadSelected: (id: string) => void;
    archive: (id: string) => void;
    unarchive: (id: string) => void;
    deleteThread: (id: string) => void;
    newThread: () => void;
    filterChange: (filter: DrawerFilter) => void;
    openChange: (open: boolean) => void;
  }>({
    threadSelected: noop,
    archive: noop,
    unarchive: noop,
    deleteThread: noop,
    newThread: noop,
    filterChange: noop,
    openChange: noop,
  });

  handlers.current.threadSelected = (id: string) => {
    applyThreadId(id);
    setModalState?.("chat");
  };
  // Surface mutation rejections rather than swallowing them. `useThreads` also
  // reflects the last error via its `error` channel (forwarded to the element's
  // `error` prop), but that surface is coarse (last-error-wins, no per-row
  // context) and a fire-and-forget rejection would otherwise leave nothing in
  // the console for diagnosis. Log with the same `[CopilotKit]` prefix used for
  // the licensing warning above.
  const surfaceMutationError = (operation: string, id: string) => {
    return (cause: unknown) => {
      console.warn(
        `[CopilotKit] CopilotDrawer: ${operation} thread "${id}" failed.`,
        cause,
      );
    };
  };

  handlers.current.archive = (id: string) => {
    archiveThread(id).catch(surfaceMutationError("archive", id));
  };
  handlers.current.unarchive = (id: string) => {
    unarchiveThread(id).catch(surfaceMutationError("unarchive", id));
  };
  handlers.current.deleteThread = (id: string) => {
    deleteThread(id).catch(surfaceMutationError("delete", id));
  };
  handlers.current.newThread = () => {
    applyThreadId(randomUUID());
    setModalState?.("chat");
  };
  handlers.current.filterChange = (next: DrawerFilter) => {
    setFilter(next);
  };
  handlers.current.openChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setModalState?.("threads");
      return;
    }
    // Dismissing the drawer returns to whatever surface preceded it: `"chat"`
    // only when chat was the active surface, otherwise `"none"` (e.g. a
    // desktop in-flow/collapsed surface stays collapsed). This is distinct from
    // the mobile drill-in select/new-thread paths, which intentionally land on
    // `"chat"`.
    setModalState?.(priorSurfaceRef.current);
  };

  // --- Bind DOM CustomEvents once (cleaned up on unmount) -----------------
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const onThreadSelected = (event: Event) => {
      handlers.current.threadSelected(
        (event as CustomEvent<ThreadSelectedDetail>).detail.id,
      );
    };
    const onArchive = (event: Event) => {
      handlers.current.archive((event as CustomEvent<ArchiveDetail>).detail.id);
    };
    const onUnarchive = (event: Event) => {
      handlers.current.unarchive(
        (event as CustomEvent<UnarchiveDetail>).detail.id,
      );
    };
    const onDelete = (event: Event) => {
      handlers.current.deleteThread(
        (event as CustomEvent<DeleteDetail>).detail.id,
      );
    };
    const onNewThread = () => {
      handlers.current.newThread();
    };
    const onFilterChange = (event: Event) => {
      handlers.current.filterChange(
        (event as CustomEvent<FilterChangeDetail>).detail.filter,
      );
    };
    const onOpenChange = (event: Event) => {
      handlers.current.openChange(
        (event as CustomEvent<OpenChangeDetail>).detail.open,
      );
    };

    element.addEventListener("thread-selected", onThreadSelected);
    element.addEventListener("archive", onArchive);
    element.addEventListener("unarchive", onUnarchive);
    element.addEventListener("delete", onDelete);
    element.addEventListener("new-thread", onNewThread);
    element.addEventListener("filter-change", onFilterChange);
    element.addEventListener("open-change", onOpenChange);

    return () => {
      element.removeEventListener("thread-selected", onThreadSelected);
      element.removeEventListener("archive", onArchive);
      element.removeEventListener("unarchive", onUnarchive);
      element.removeEventListener("delete", onDelete);
      element.removeEventListener("new-thread", onNewThread);
      element.removeEventListener("filter-change", onFilterChange);
      element.removeEventListener("open-change", onOpenChange);
    };
  }, []);

  // --- Project useThreads records into the element's view shape -----------
  const drawerThreads = useMemo(() => threads.map(toDrawerThread), [threads]);

  // --- Assign element PROPERTIES (React can't set these declaratively) ----
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.threads = drawerThreads;
  }, [drawerThreads]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.activeThreadId = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.filter = filter;
  }, [filter]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.open = open;
  }, [open]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.overlay = overlay;
  }, [overlay]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.licensed = licensed;
  }, [licensed]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.loading = isLoading;
  }, [isLoading]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    // Suppress runtime/endpoint errors when unlicensed. The list is never
    // fetched in that state, so `useThreads` still surfaces a "Runtime URL is
    // not configured" error when no runtimeUrl is set — forwarding it would let
    // a hard error banner show alongside the element's built-in upsell. Gating
    // on `licensed` keeps the unlicensed drawer showing only the upsell.
    element.error = licensed && error ? error.message : null;
  }, [error, licensed]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.renderThread = renderThread;
  }, [renderThread]);

  // The custom element is not in React's intrinsic-element map; render it via
  // `React.createElement` with a ref so the effects above can drive it. No
  // children/props are set here — everything flows through the ref effects.
  return React.createElement("copilotkit-drawer", { ref: elementRef });
}

CopilotDrawer.displayName = "CopilotDrawer";

export default CopilotDrawer;
