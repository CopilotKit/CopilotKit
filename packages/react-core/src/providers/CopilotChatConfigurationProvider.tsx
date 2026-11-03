import type { ReactNode } from "react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CopilotChatDefaultLabels,
  ɵChatConfigurationStore,
} from "@copilotkit/core";
import type { CopilotChatLabels } from "@copilotkit/core";
import { CopilotKitContext, useDefaultAgentId } from "../context";
// Import from the leaf module (not ../lib/slots) so this provider stays lean in
// the headless entry (issue #4893).
import { useShallowStableRef } from "../lib/shallow-stable-ref";

export interface CopilotChatConfigurationValue {
  labels: CopilotChatLabels;
  agentId: string;
  threadId: string;
  isModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  /**
   * Whether the thread-list drawer is open. A sibling boolean to `isModalOpen`
   * (deliberately NOT folded into a tri-state enum): on desktop the chat modal
   * and the drawer coexist, so two independent booleans are required.
   */
  drawerOpen: boolean;
  /**
   * Toggles the drawer open state. On mobile viewports (`<768px`) opening the
   * drawer closes the chat modal (mutual exclusion); on desktop there is no
   * constraint.
   */
  setDrawerOpen: (open: boolean) => void;
  /**
   * True once a `<CopilotThreadsDrawer>` wrapper has registered itself with this chat
   * configuration. The header thread-list launcher renders ONLY when this is
   * set, so chats with no drawer stay byte-for-byte unchanged.
   */
  drawerRegistered: boolean;
  /**
   * Called by the drawer wrapper on mount to announce its presence (and flip
   * `drawerRegistered`). Returns a cleanup function that de-registers the
   * drawer on unmount.
   *
   * @returns A cleanup callback that reverses the registration.
   */
  registerDrawer: () => () => void;
  /**
   * Internal: registers the modal-close setter of the provider that actually
   * owns the rendered modal (a descendant that supplied `isModalDefaultOpen`),
   * so the drawer's mobile mutual-exclusion — owned by the top-most provider —
   * closes the modal that is genuinely on screen rather than the top-most
   * provider's own (possibly unrendered) modal state.
   *
   * @param closeModal - A setter the drawer may call to close the rendered modal.
   * @returns A cleanup callback that de-registers the closer.
   */
  ɵregisterModalCloser: (closeModal: (open: boolean) => void) => () => void;
  // True when the current threadId was chosen by the caller rather than
  // silently minted inside the provider chain. Consumers that only make
  // sense against a real backend thread (e.g. /connect, suppressing the
  // welcome screen on switch) gate on this instead of `!!threadId`.
  hasExplicitThreadId: boolean;
  /**
   * Imperatively sets the active thread for this chat configuration.
   *
   * Use this to drive the rendered thread without a host callback — e.g. a
   * `<CopilotThreadsDrawer>` selecting a thread row sets it explicitly so the chat
   * connects to that backend thread.
   *
   * Guarded like the top-level `<CopilotKit>` provider's `setThreadId`: when
   * the consumer controls the threadId via the `threadId` prop on this
   * provider, this is a no-op (a warning is logged) so a prop-controlled
   * threadId is never silently overridden.
   *
   * @param threadId - The thread id to make active.
   * @param options.explicit - Whether the thread is a caller choice. Defaults
   *   to `true` (a picked thread). Pass `false` to set a non-explicit thread
   *   so the welcome screen shows (see {@link startNewThread}).
   */
  setActiveThreadId: (
    threadId: string,
    options?: { explicit?: boolean },
  ) => void;
  /**
   * Resets the active thread to a fresh, non-explicit client-side thread: a
   * newly minted UUID with `hasExplicitThreadId=false`, so the welcome screen
   * shows. Pairs with the core `startNewThread()` to clear the conversation
   * with no host wiring.
   *
   * Guarded identically to {@link setActiveThreadId}: a no-op when the
   * threadId is prop-controlled.
   */
  startNewThread: () => void;
  /**
   * Internal: the core store behind this value, so a nested provider can link
   * its own store to it.
   */
  ɵstore?: ɵChatConfigurationStore;
}

// Create the configuration context
const CopilotChatConfiguration =
  createContext<CopilotChatConfigurationValue | null>(null);

// Provider props interface
export interface CopilotChatConfigurationProviderProps {
  children: ReactNode;
  labels?: Partial<CopilotChatLabels>;
  agentId?: string;
  threadId?: string;
  // Lets internal wrappers (e.g. the v1 CopilotKit bridge, which pipes a
  // ThreadsProvider-minted UUID through as `threadId`) declare that the
  // threadId they are supplying is NOT a caller choice. When omitted, the
  // provider infers explicitness from whether the `threadId` prop itself
  // was supplied.
  hasExplicitThreadId?: boolean;
  isModalDefaultOpen?: boolean;
}

// Provider component
export const CopilotChatConfigurationProvider: React.FC<
  CopilotChatConfigurationProviderProps
> = ({
  children,
  labels,
  agentId,
  threadId,
  hasExplicitThreadId,
  isModalDefaultOpen,
}) => {
  const parentConfig = useContext(CopilotChatConfiguration);

  // Stabilize labels references so that inline objects (new reference on every
  // parent render) don't invalidate mergedLabels and churn the context value.
  // parentConfig?.labels is already stabilized by the parent provider's own
  // useShallowStableRef, so we only need to stabilize the local labels prop.
  const stableLabels = useShallowStableRef(labels);
  const mergedLabels: CopilotChatLabels = useMemo(
    () => ({
      ...CopilotChatDefaultLabels,
      ...parentConfig?.labels,
      ...stableLabels,
    }),
    [stableLabels, parentConfig?.labels],
  );

  // Core owns thread, agent, modal and drawer resolution across the provider
  // chain. This component feeds it props during render (so the value is
  // current on the first pass), reports them after commit (so subscribers such
  // as nested stores and the open-thread registration hear about it), and
  // projects the snapshot into context.
  const providerAgentId = useDefaultAgentId();
  const options = {
    agentId,
    threadId,
    hasExplicitThreadId,
    isModalDefaultOpen,
    providerAgentId,
  };
  const parentStore = parentConfig?.ɵstore ?? null;
  const [store] = useState(
    () => new ɵChatConfigurationStore(options, parentStore),
  );
  store.ɵsetOptions(options);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    store.update({
      agentId,
      threadId,
      hasExplicitThreadId,
      isModalDefaultOpen,
      providerAgentId,
    });
  }, [
    store,
    agentId,
    threadId,
    hasExplicitThreadId,
    isModalDefaultOpen,
    providerAgentId,
  ]);

  // Tell Core which Thread this view shows, so captured interactions can link
  // to it. Read the context directly: this provider also works without a
  // CopilotKitProvider, and then there is nothing to register with.
  const copilotkit = useContext(CopilotKitContext)?.copilotkit;
  useEffect(() => {
    if (copilotkit === undefined) return;
    return store.bindOpenThread(copilotkit);
  }, [copilotkit, store]);

  // A provider without its own modal shows the modal state in context above
  // it, which may be a ControlledModalOpenScope's host-controlled value.
  const ownsModal = isModalDefaultOpen !== undefined;
  const isModalOpen =
    ownsModal || !parentConfig
      ? snapshot.isModalOpen
      : parentConfig.isModalOpen;
  const setModalOpen =
    ownsModal || !parentConfig ? store.setModalOpen : parentConfig.setModalOpen;

  // Keyed on the snapshot's fields, not its identity: a drawer that
  // unregisters and re-registers in one commit yields an equal snapshot, and
  // a new context value there would re-run the drawer's effect forever.
  const {
    agentId: resolvedAgentId,
    threadId: resolvedThreadId,
    hasExplicitThreadId: resolvedHasExplicitThreadId,
    drawerOpen,
    drawerRegistered,
  } = snapshot;
  const configurationValue: CopilotChatConfigurationValue = useMemo(
    () => ({
      labels: mergedLabels,
      agentId: resolvedAgentId,
      threadId: resolvedThreadId,
      hasExplicitThreadId: resolvedHasExplicitThreadId,
      isModalOpen,
      setModalOpen,
      drawerOpen,
      setDrawerOpen: store.setDrawerOpen,
      drawerRegistered,
      registerDrawer: store.registerDrawer,
      ɵregisterModalCloser: store.registerModalCloser,
      setActiveThreadId: store.setActiveThreadId,
      startNewThread: store.startNewThread,
      ɵstore: store,
    }),
    [
      mergedLabels,
      resolvedAgentId,
      resolvedThreadId,
      resolvedHasExplicitThreadId,
      isModalOpen,
      setModalOpen,
      drawerOpen,
      drawerRegistered,
      store,
    ],
  );

  return (
    <CopilotChatConfiguration.Provider value={configurationValue}>
      {children}
    </CopilotChatConfiguration.Provider>
  );
};

// Hook to use the full configuration
export const useCopilotChatConfiguration =
  (): CopilotChatConfigurationValue | null => {
    const configuration = useContext(CopilotChatConfiguration);
    return configuration;
  };

/**
 * Props for {@link ControlledModalOpenScope}.
 */
export interface ControlledModalOpenScopeProps {
  children: ReactNode;
  /**
   * The host-owned open state. When this is a boolean, everything inside the
   * scope reads it as `isModalOpen`, so the host prop is the single source of
   * truth for what is on screen. Leave it `undefined` to keep the underlying
   * state in charge and only report requests through `onOpenChange`.
   */
  open?: boolean;
  /**
   * Called with the requested state whenever something inside the scope asks
   * to open or close the modal (the toggle button, click-outside, a consumer
   * calling `setModalOpen`). Fires whether or not `open` is supplied.
   */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Reports modal open/close requests to the host, and — when `open` is
 * supplied — makes the modal state of an already-established chat
 * configuration **controlled** for the subtree it wraps.
 *
 * This is deliberately a scope component rather than another mode inside
 * {@link CopilotChatConfigurationProvider}. The provider resolves modal state
 * across a nested chain (own state, parent sync, drawer mutual-exclusion, the
 * modal-closer registry); a controlled branch inside that resolution would add
 * a fourth interacting mode. Overriding the context for the subtree instead
 * leaves every one of those paths untouched:
 *
 * - `isModalOpen` is replaced with the host's `open`, so the rendered surface
 *   follows the prop from the very first frame (no open-then-close flash).
 * - `setModalOpen` still calls the underlying setter, so the existing
 *   parent-sync and drawer mutual-exclusion side effects continue to run, and
 *   *then* reports the request through `onOpenChange`.
 * - The wrapped setter is registered as the modal closer, so the drawer's
 *   mobile mutual-exclusion reaches the host instead of silently flipping
 *   state that nothing displays.
 *
 * A host that supplies `open` and ignores `onOpenChange` gets a modal pinned
 * to `open`, which is the standard controlled-component contract. A host that
 * supplies only `onOpenChange` is notified while the modal keeps managing
 * itself.
 *
 * Renders `children` unchanged when no chat configuration is in scope.
 */
export const ControlledModalOpenScope: React.FC<
  ControlledModalOpenScopeProps
> = ({ children, open, onOpenChange }) => {
  const parentConfig = useContext(CopilotChatConfiguration);
  const parentSetModalOpen = parentConfig?.setModalOpen;
  const registerModalCloser = parentConfig?.ɵregisterModalCloser;

  const setModalOpen = useCallback(
    (next: boolean) => {
      parentSetModalOpen?.(next);
      onOpenChange?.(next);
    },
    [parentSetModalOpen, onOpenChange],
  );

  useEffect(() => {
    if (!registerModalCloser) return;
    return registerModalCloser(setModalOpen);
  }, [registerModalCloser, setModalOpen]);

  const configurationValue = useMemo(
    () =>
      parentConfig
        ? {
            ...parentConfig,
            isModalOpen: open ?? parentConfig.isModalOpen,
            setModalOpen,
          }
        : null,
    [parentConfig, open, setModalOpen],
  );

  if (!configurationValue) {
    return <>{children}</>;
  }

  return (
    <CopilotChatConfiguration.Provider value={configurationValue}>
      {children}
    </CopilotChatConfiguration.Provider>
  );
};

ControlledModalOpenScope.displayName = "ControlledModalOpenScope";
