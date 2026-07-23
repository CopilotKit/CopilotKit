import type { ReactNode } from "react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
import { useShallowStableRef } from "../lib/slots";

// Default labels
export const CopilotChatDefaultLabels = {
  chatInputPlaceholder: "Type a message...",
  chatInputToolbarStartTranscribeButtonLabel: "Transcribe",
  chatInputToolbarCancelTranscribeButtonLabel: "Cancel",
  chatInputToolbarFinishTranscribeButtonLabel: "Finish",
  chatInputToolbarAddButtonLabel: "Add attachments",
  chatInputToolbarToolsButtonLabel: "Tools",
  assistantMessageToolbarCopyCodeLabel: "Copy",
  assistantMessageToolbarCopyCodeCopiedLabel: "Copied",
  assistantMessageToolbarCopyMessageLabel: "Copy",
  assistantMessageToolbarThumbsUpLabel: "Good response",
  assistantMessageToolbarThumbsDownLabel: "Bad response",
  assistantMessageToolbarReadAloudLabel: "Read aloud",
  assistantMessageToolbarRegenerateLabel: "Regenerate",
  userMessageToolbarCopyMessageLabel: "Copy",
  userMessageToolbarEditMessageLabel: "Edit",
  chatDisclaimerText:
    "AI can make mistakes. Please verify important information.",
  chatToggleOpenLabel: "Open chat",
  chatToggleCloseLabel: "Close chat",
  modalHeaderTitle: "CopilotKit Chat",
  welcomeMessageText: "How can I help you today?",
};

export type CopilotChatLabels = typeof CopilotChatDefaultLabels;

/**
 * Mobile breakpoint below which the chat modal and the thread-list drawer are
 * mutually exclusive. At or above this width both surfaces may coexist. This
 * mirrors the `(max-width: 767px)` / `(min-width: 768px)` split already used by
 * CopilotChatInput and CopilotSidebarView.
 */
const MOBILE_MAX_WIDTH_PX = 767;

/**
 * Reports whether the current viewport is in the mobile range (`<768px`), where
 * the chat modal and drawer must not be open simultaneously. SSR-safe and
 * defensive against environments without `matchMedia` (treated as desktop, so
 * no mutual-exclusion constraint is applied).
 *
 * @returns `true` when the viewport is mobile-width, `false` otherwise.
 */
function isMobileViewport(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`).matches;
}

// Define the full configuration interface
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

  const resolvedAgentId = agentId ?? parentConfig?.agentId ?? DEFAULT_AGENT_ID;

  // A threadId prop is "authoritative" (caller-chosen) only when it is present
  // AND not explicitly flagged non-explicit. The v1 `<CopilotKit>` bridge pipes
  // an auto-minted UUID through as `threadId` with `hasExplicitThreadId={false}`
  // to SEED the thread without claiming the caller picked it; that seed must
  // stay overridable so imperative callers (e.g. `<CopilotThreadsDrawer>` selecting a
  // row, or `startNewThread`) can switch threads. A bare `threadId` prop (no
  // `hasExplicitThreadId`) is still treated as a caller choice.
  const threadIdPropIsAuthoritative =
    threadId !== undefined && hasExplicitThreadId !== false;

  // Whether this provider's threadId is controlled by the consumer. When
  // controlled, the imperative active-thread setters below must not override
  // the prop-driven value. A non-authoritative seed (v1 bridge auto-mint) is
  // NOT controlled, so imperative selection still works underneath it.
  const isThreadIdControlled = threadIdPropIsAuthoritative;

  // Imperative active-thread override owned by the TOP-MOST provider (the one
  // with no parent). A non-null override takes precedence over the auto-minted
  // UUID fallback below. Nested providers do not own this state — they proxy
  // the parent's setter (see resolved*ActiveThread below) and observe the
  // override through the inherited `parentConfig.threadId`.
  const [activeThreadOverride, setActiveThreadOverride] = useState<{
    threadId: string;
    explicit: boolean;
  } | null>(null);

  const resolvedThreadId = useMemo(() => {
    // An authoritative (caller-chosen) threadId prop always wins.
    if (threadIdPropIsAuthoritative) {
      return threadId as string;
    }
    // Otherwise an imperative override (a picked row or freshly-started thread)
    // beats both a non-authoritative seed (the v1 bridge's auto-minted UUID) and
    // the thread inherited from a parent provider.
    if (activeThreadOverride) {
      return activeThreadOverride.threadId;
    }
    if (parentConfig?.threadId) {
      return parentConfig.threadId;
    }
    if (threadId) {
      return threadId;
    }
    return randomUUID();
  }, [
    threadIdPropIsAuthoritative,
    threadId,
    parentConfig?.threadId,
    activeThreadOverride,
  ]);

  // Explicitness of this provider's own thread, mirroring the resolution order
  // above: an authoritative prop is a caller choice; otherwise an imperative
  // override carries its own explicitness (a picked row is explicit, a fresh
  // `startNewThread` is not); failing both, fall back to the (non-authoritative)
  // prop flag, which is `false` for the v1 bridge seed.
  const ownHasExplicitThreadId = threadIdPropIsAuthoritative
    ? true
    : (activeThreadOverride?.explicit ?? hasExplicitThreadId ?? false);
  const resolvedHasExplicitThreadId =
    ownHasExplicitThreadId || !!parentConfig?.hasExplicitThreadId;

  const resolvedDefaultOpen = isModalDefaultOpen ?? true;

  const [internalModalOpen, setInternalModalOpen] =
    useState<boolean>(resolvedDefaultOpen);

  const hasExplicitDefault = isModalDefaultOpen !== undefined;

  // When this provider owns its modal state, wrap the setter so that changes
  // propagate upward to any ancestor provider. This allows an outer
  // CopilotChatConfigurationProvider (e.g. a user's layout-level provider) to
  // observe open/close events that originate deep in the tree — fixing the
  // "outer hook always returns true" regression (CPK-7152 Behavior B).
  const setAndSync = useCallback(
    (open: boolean) => {
      setInternalModalOpen(open);
      parentConfig?.setModalOpen(open);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parentConfig?.setModalOpen],
  );

  // Sync parent → child: when an ancestor's modal state is changed externally
  // (e.g. the user calls setModalOpen from an outer hook), reflect that change
  // in our own state so the sidebar/popup responds accordingly.
  // Skip the initial mount so that our own isModalDefaultOpen is respected and
  // not immediately overwritten by the parent's current value.
  const isMounted = useRef(false);
  useEffect(() => {
    if (!hasExplicitDefault) return;
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (parentConfig?.isModalOpen === undefined) return;
    setInternalModalOpen(parentConfig.isModalOpen);
  }, [parentConfig?.isModalOpen, hasExplicitDefault]);

  const resolvedIsModalOpen = hasExplicitDefault
    ? internalModalOpen
    : (parentConfig?.isModalOpen ?? internalModalOpen);
  const resolvedSetModalOpen = hasExplicitDefault
    ? setAndSync
    : (parentConfig?.setModalOpen ?? setInternalModalOpen);

  // Drawer presence + open state. When a parent provider exists, this provider
  // proxies the parent's drawer state and registration so that the whole chain
  // shares a single drawer (the drawer wrapper registers once, anywhere in the
  // subtree, and the header launcher anywhere can read/toggle it). Only the
  // top-most provider owns the underlying state.
  const [ownDrawerOpen, setOwnDrawerOpen] = useState<boolean>(false);
  const [ownDrawerCount, setOwnDrawerCount] = useState<number>(0);

  // The modal-close path used by the drawer's mobile mutual-exclusion. Held in
  // a ref so the drawer setter (owned by the top-most provider) can reach the
  // resolved modal setter without recreating its identity on every render.
  const modalCloseRef = useRef<(open: boolean) => void>(() => {});
  // Default to this provider's own resolved modal setter. When a DESCENDANT
  // provider owns the rendered modal (it supplied `isModalDefaultOpen`), it
  // registers its closer via `ɵregisterModalCloser` below, which overrides this
  // so the drawer closes the modal that is actually on screen.
  modalCloseRef.current = resolvedSetModalOpen;

  // Stack of descendant-registered modal closers. The most recently registered
  // closer (the deepest/last-rendered modal owner) is preferred, mirroring how
  // `resolvedThreadId`/modal ownership flows to the nearest explicit owner.
  const registeredModalClosersRef = useRef<Array<(open: boolean) => void>>([]);

  const ownRegisterModalCloser = useCallback(
    (closeModal: (open: boolean) => void) => {
      registeredModalClosersRef.current.push(closeModal);
      return () => {
        registeredModalClosersRef.current =
          registeredModalClosersRef.current.filter(
            (entry) => entry !== closeModal,
          );
      };
    },
    [],
  );

  const ownSetDrawerOpen = useCallback((open: boolean) => {
    setOwnDrawerOpen(open);
    // Mobile mutual-exclusion: opening the drawer closes the chat modal. Prefer
    // a descendant-registered closer (the actually-rendered modal) over this
    // provider's own resolved modal setter.
    if (open && isMobileViewport()) {
      const registered = registeredModalClosersRef.current;
      const closeModal =
        registered.length > 0
          ? registered[registered.length - 1]
          : modalCloseRef.current;
      closeModal(false);
    }
  }, []);

  const ownRegisterDrawer = useCallback(() => {
    setOwnDrawerCount((count) => count + 1);
    return () => {
      setOwnDrawerCount((count) => Math.max(0, count - 1));
    };
  }, []);

  const resolvedDrawerOpen = parentConfig
    ? parentConfig.drawerOpen
    : ownDrawerOpen;
  const resolvedSetDrawerOpen = parentConfig
    ? parentConfig.setDrawerOpen
    : ownSetDrawerOpen;
  const resolvedDrawerRegistered = parentConfig
    ? parentConfig.drawerRegistered
    : ownDrawerCount > 0;
  const resolvedRegisterDrawer = parentConfig
    ? parentConfig.registerDrawer
    : ownRegisterDrawer;
  const resolvedRegisterModalCloser = parentConfig
    ? parentConfig.ɵregisterModalCloser
    : ownRegisterModalCloser;

  // When THIS provider owns the rendered modal (it supplied
  // `isModalDefaultOpen`), register its closer up the chain so the top-most
  // provider's drawer mobile mutual-exclusion closes the modal that is actually
  // on screen. Re-registers if the resolved setter identity changes.
  useEffect(() => {
    if (!hasExplicitDefault) return;
    return resolvedRegisterModalCloser(resolvedSetModalOpen);
  }, [hasExplicitDefault, resolvedRegisterModalCloser, resolvedSetModalOpen]);

  // Active-thread override setters. The TOP-MOST provider owns the override
  // state; nested providers proxy the parent's setter so the whole chain drives
  // a single active thread (the override placed on the owner flows down via the
  // inherited threadId).
  //
  // The controlled-guard is applied at EACH level, not only on the owner: a
  // provider whose own `threadId` prop pins the rendered thread (per the
  // `resolvedThreadId` precedence above) intercepts the set with a no-op +
  // warning BEFORE proxying upward. This is required because in a nested chain
  // the controlled provider is often NOT the override owner — e.g. an
  // uncontrolled top-most provider with a controlled nested provider. Guarding
  // only the owner would let the set silently no-op (the nested `threadId` prop
  // wins at render) while the documented warning never fired.
  const isThreadIdControlledRef = useRef(isThreadIdControlled);
  isThreadIdControlledRef.current = isThreadIdControlled;

  const ownSetActiveThreadId = useCallback(
    (id: string, options?: { explicit?: boolean }) => {
      setActiveThreadOverride({
        threadId: id,
        explicit: options?.explicit ?? true,
      });
    },
    [],
  );

  const ownStartNewThread = useCallback(() => {
    setActiveThreadOverride({ threadId: randomUUID(), explicit: false });
  }, []);

  // Proxy to the parent's setter when nested, else to the owner's. Wrapped with
  // this provider's own controlled-guard so the nearest pinning (controlled)
  // provider — wherever it sits in the chain — is the one that no-ops + warns.
  const parentSetActiveThreadId = parentConfig?.setActiveThreadId;
  const parentStartNewThread = parentConfig?.startNewThread;

  const resolvedSetActiveThreadId = useCallback(
    (id: string, options?: { explicit?: boolean }) => {
      if (isThreadIdControlledRef.current) {
        console.warn(
          "[CopilotKit] Ignoring setActiveThreadId(): threadId is controlled " +
            "via the `threadId` prop on CopilotChatConfigurationProvider.",
        );
        return;
      }
      if (parentSetActiveThreadId) {
        parentSetActiveThreadId(id, options);
        return;
      }
      ownSetActiveThreadId(id, options);
    },
    [parentSetActiveThreadId, ownSetActiveThreadId],
  );

  const resolvedStartNewThread = useCallback(() => {
    if (isThreadIdControlledRef.current) {
      console.warn(
        "[CopilotKit] Ignoring startNewThread(): threadId is controlled via " +
          "the `threadId` prop on CopilotChatConfigurationProvider.",
      );
      return;
    }
    if (parentStartNewThread) {
      parentStartNewThread();
      return;
    }
    ownStartNewThread();
  }, [parentStartNewThread, ownStartNewThread]);

  // Mobile mutual-exclusion (other direction): opening the chat modal closes
  // the drawer. Layered over whichever modal setter we resolved above so the
  // existing parent/child modal-sync contract is preserved untouched.
  const setModalOpenWithDrawerExclusion = useCallback(
    (open: boolean) => {
      if (open && isMobileViewport()) {
        resolvedSetDrawerOpen(false);
      }
      resolvedSetModalOpen(open);
    },
    [resolvedSetModalOpen, resolvedSetDrawerOpen],
  );

  const configurationValue: CopilotChatConfigurationValue = useMemo(
    () => ({
      labels: mergedLabels,
      agentId: resolvedAgentId,
      threadId: resolvedThreadId,
      hasExplicitThreadId: resolvedHasExplicitThreadId,
      isModalOpen: resolvedIsModalOpen,
      setModalOpen: setModalOpenWithDrawerExclusion,
      drawerOpen: resolvedDrawerOpen,
      setDrawerOpen: resolvedSetDrawerOpen,
      drawerRegistered: resolvedDrawerRegistered,
      registerDrawer: resolvedRegisterDrawer,
      ɵregisterModalCloser: resolvedRegisterModalCloser,
      setActiveThreadId: resolvedSetActiveThreadId,
      startNewThread: resolvedStartNewThread,
    }),
    [
      mergedLabels,
      resolvedAgentId,
      resolvedThreadId,
      resolvedHasExplicitThreadId,
      resolvedIsModalOpen,
      setModalOpenWithDrawerExclusion,
      resolvedDrawerOpen,
      resolvedSetDrawerOpen,
      resolvedDrawerRegistered,
      resolvedRegisterDrawer,
      resolvedRegisterModalCloser,
      resolvedSetActiveThreadId,
      resolvedStartNewThread,
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
