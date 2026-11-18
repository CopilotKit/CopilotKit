import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
import type { OpenThreadRegistration } from "../core/learning-bridge";
import { ɵisMobileViewport } from "./viewport";

/**
 * Chat configuration state shared by React `CopilotChatConfigurationProvider`,
 * Vue `CopilotChatConfigurationProvider` and Angular
 * `provideCopilotChatConfiguration`: which agent and thread a chat shows, the
 * chat modal's open state, and the thread-list drawer.
 *
 * Internal (`ɵ`): framework packages use it, and it can change in any release.
 */

/** The props a chat configuration provider takes. */
export interface ɵChatConfigurationOptions {
  agentId?: string;
  /**
   * The thread to show. It is controlled (imperative thread changes are
   * ignored with a warning) unless `hasExplicitThreadId` is `false`, which
   * marks it as a seed that a picked or new thread may replace.
   */
  threadId?: string;
  hasExplicitThreadId?: boolean;
  /**
   * Set to give this provider its own modal state, starting open or closed.
   * Unset, the provider shares its parent's modal state.
   */
  isModalDefaultOpen?: boolean;
  /** The app-wide default agent (`<CopilotKitProvider agentId>`). */
  providerAgentId?: string;
}

/** What a chat reads from its configuration. */
export interface ɵChatConfigurationSnapshot {
  agentId: string;
  threadId: string;
  /** `true` when a caller chose the thread (not a minted placeholder). */
  hasExplicitThreadId: boolean;
  isModalOpen: boolean;
  drawerOpen: boolean;
  /** `true` while at least one threads drawer is mounted. */
  drawerRegistered: boolean;
}

/** The core part {@link ɵChatConfigurationStore.bindOpenThread} needs. */
export interface ɵOpenThreadRegistry {
  registerOpenThread(params: {
    agentId: string;
    threadId: string;
  }): OpenThreadRegistration;
}

const CONTROLLED_SET_WARNING =
  "[CopilotKit] Ignoring setActiveThreadId(): threadId is controlled " +
  "via the `threadId` prop on CopilotChatConfigurationProvider.";
const CONTROLLED_NEW_WARNING =
  "[CopilotKit] Ignoring startNewThread(): threadId is controlled via " +
  "the `threadId` prop on CopilotChatConfigurationProvider.";

type ModalCloser = (open: boolean) => void;

function isSameSnapshot(
  a: ɵChatConfigurationSnapshot,
  b: ɵChatConfigurationSnapshot,
) {
  return (
    a.agentId === b.agentId &&
    a.threadId === b.threadId &&
    a.hasExplicitThreadId === b.hasExplicitThreadId &&
    a.isModalOpen === b.isModalOpen &&
    a.drawerOpen === b.drawerOpen &&
    a.drawerRegistered === b.drawerRegistered
  );
}

/**
 * One chat configuration provider's state. A nested provider passes its
 * parent store, and the chain behaves as one:
 *
 * - **Thread**: a controlled `threadId` wins; then a picked or new thread;
 *   then the parent's thread; then a seed `threadId`; then a UUID minted once
 *   per store. Picking a thread or starting a new one is owned by the top-most
 *   store; nested stores pass the call up, after their own controlled check.
 * - **Agent**: own `agentId`, then the parent's, then the provider default,
 *   then `DEFAULT_AGENT_ID`.
 * - **Modal**: own state when `isModalDefaultOpen` is set (changes also go to
 *   the parent, and parent changes after creation come down); otherwise the
 *   parent's state; a store without either starts open.
 * - **Drawer**: owned by the top-most store, so one drawer serves the chain.
 *   On a mobile-width viewport, opening the drawer closes the modal that is
 *   on screen and opening the modal closes the drawer.
 *
 * The store links to its parent (and registers its modal closer there) while
 * it has subscribers, so a discarded store holds nothing.
 */
export class ɵChatConfigurationStore {
  #options: ɵChatConfigurationOptions;
  readonly #parent: ɵChatConfigurationStore | null;
  readonly #fallbackThreadId = randomUUID();
  #override: { threadId: string; explicit: boolean } | null = null;
  #ownModalOpen: boolean;
  #ownDrawerOpen = false;
  #drawerCount = 0;
  readonly #modalClosers: ModalCloser[] = [];
  readonly #listeners = new Set<() => void>();
  #disconnectParent: (() => void) | null = null;
  #lastParentModalOpen: boolean | undefined;
  #snapshot: ɵChatConfigurationSnapshot;
  #notified: ɵChatConfigurationSnapshot;

  constructor(
    options: ɵChatConfigurationOptions,
    parent: ɵChatConfigurationStore | null = null,
  ) {
    this.#options = options;
    this.#parent = parent;
    this.#ownModalOpen = options.isModalDefaultOpen ?? true;
    this.#lastParentModalOpen = parent?.getSnapshot().isModalOpen;
    this.#snapshot = this.#compute();
    this.#notified = this.#snapshot;
  }

  /**
   * The current values, read through the parent and the latest options, so a
   * render always sees them. Same object until one of them changes.
   */
  getSnapshot = () => {
    const next = this.#compute();
    if (!isSameSnapshot(next, this.#snapshot)) this.#snapshot = next;
    return this.#snapshot;
  };

  /** Listen for changes. Returns unsubscribe. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#connect();
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#disconnect();
    };
  };

  /**
   * Take the provider's current props without notifying: for a render phase,
   * where `getSnapshot()` already reflects them. Call {@link update} after
   * the commit so subscribers hear about the change.
   */
  ɵsetOptions(options: ɵChatConfigurationOptions) {
    this.#options = options;
  }

  /** Give the provider's current props and notify subscribers. */
  update(options: ɵChatConfigurationOptions) {
    const hadOwnModal = this.#hasOwnModal;
    this.#options = options;
    if (hadOwnModal !== this.#hasOwnModal && this.#listeners.size > 0) {
      this.#disconnect();
      this.#connect();
    }
    this.#refresh();
  }

  /**
   * Show `threadId`. `explicit` (default `true`) marks it as a caller
   * choice; `false` keeps the welcome screen for a fresh thread. Ignored with
   * a warning when the thread is controlled.
   */
  setActiveThreadId = (threadId: string, options?: { explicit?: boolean }) => {
    if (this.#isThreadControlled) {
      console.warn(CONTROLLED_SET_WARNING);
      return;
    }
    if (this.#parent) {
      this.#parent.setActiveThreadId(threadId, options);
      return;
    }
    this.#override = { threadId, explicit: options?.explicit ?? true };
    this.#refresh();
  };

  /**
   * Show a fresh client-side thread (new UUID, not explicit). Ignored with a
   * warning when the thread is controlled.
   */
  startNewThread = () => {
    if (this.#isThreadControlled) {
      console.warn(CONTROLLED_NEW_WARNING);
      return;
    }
    if (this.#parent) {
      this.#parent.startNewThread();
      return;
    }
    this.#override = { threadId: randomUUID(), explicit: false };
    this.#refresh();
  };

  /** Open or close the chat modal (closing the drawer on mobile). */
  setModalOpen = (open: boolean) => {
    if (open && ɵisMobileViewport()) this.setDrawerOpen(false);
    this.#setModalState(open);
  };

  /** Open or close the drawer (closing the on-screen modal on mobile). */
  setDrawerOpen = (open: boolean) => {
    if (this.#parent) {
      this.#parent.setDrawerOpen(open);
      return;
    }
    this.#ownDrawerOpen = open;
    this.#refresh();
    if (!open || !ɵisMobileViewport()) return;
    const latestCloser = this.#modalClosers[this.#modalClosers.length - 1];
    const closeModal = latestCloser ?? ((next) => this.#setModalState(next));
    closeModal(false);
  };

  /**
   * Announce a mounted threads drawer; `drawerRegistered` stays `true` until
   * every returned cleanup has run. Each cleanup runs once.
   */
  registerDrawer = (): (() => void) => {
    if (this.#parent) return this.#parent.registerDrawer();
    this.#drawerCount++;
    this.#refresh();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#drawerCount = Math.max(0, this.#drawerCount - 1);
      this.#refresh();
    };
  };

  /**
   * Register the setter of the modal that is actually rendered, so the
   * drawer's mobile exclusion closes it. The latest registration wins.
   */
  registerModalCloser = (closeModal: ModalCloser): (() => void) => {
    if (this.#parent) return this.#parent.registerModalCloser(closeModal);
    this.#modalClosers.push(closeModal);
    return () => {
      const index = this.#modalClosers.lastIndexOf(closeModal);
      if (index !== -1) this.#modalClosers.splice(index, 1);
    };
  };

  /**
   * Tell core which thread this chat shows, so captured interactions link to
   * it. Re-registers when the agent changes. Returns the cleanup.
   */
  bindOpenThread(registry: ɵOpenThreadRegistry) {
    let agentId = this.getSnapshot().agentId;
    let registration = registry.registerOpenThread({
      agentId,
      threadId: this.getSnapshot().threadId,
    });
    const unsubscribe = this.subscribe(() => {
      const { agentId: nextAgentId, threadId } = this.getSnapshot();
      if (nextAgentId === agentId) {
        registration.update(threadId);
        return;
      }
      registration.unregister();
      agentId = nextAgentId;
      registration = registry.registerOpenThread({ agentId, threadId });
    });
    return () => {
      unsubscribe();
      registration.unregister();
    };
  }

  dispose() {
    this.#disconnect();
    this.#listeners.clear();
  }

  get #hasOwnModal() {
    return this.#options.isModalDefaultOpen !== undefined;
  }

  get #isThreadControlled() {
    const { threadId, hasExplicitThreadId } = this.#options;
    return threadId !== undefined && hasExplicitThreadId !== false;
  }

  #setModalState(open: boolean) {
    if (this.#hasOwnModal || !this.#parent) {
      this.#ownModalOpen = open;
      this.#refresh();
      if (this.#hasOwnModal) this.#parent?.setModalOpen(open);
      return;
    }
    this.#parent.setModalOpen(open);
  }

  #connect() {
    const parent = this.#parent;
    if (!parent) return;
    const offParent = parent.subscribe(() => this.#onParentChange());
    const offCloser = this.#hasOwnModal
      ? parent.registerModalCloser((open) => this.#setModalState(open))
      : null;
    this.#disconnectParent = () => {
      offParent();
      offCloser?.();
    };
    // The parent may have changed while this store had no subscribers.
    this.#refresh();
  }

  #disconnect() {
    this.#disconnectParent?.();
    this.#disconnectParent = null;
  }

  #onParentChange() {
    const parentModalOpen = this.#parent?.getSnapshot().isModalOpen;
    const parentModalChanged = parentModalOpen !== this.#lastParentModalOpen;
    this.#lastParentModalOpen = parentModalOpen;
    // An owned modal follows changes made above it, not the parent's value
    // at creation (that would override `isModalDefaultOpen`).
    if (
      parentModalChanged &&
      this.#hasOwnModal &&
      parentModalOpen !== undefined
    ) {
      this.#ownModalOpen = parentModalOpen;
    }
    this.#refresh();
  }

  #compute(): ɵChatConfigurationSnapshot {
    const options = this.#options;
    const parent = this.#parent?.getSnapshot() ?? null;
    const isControlled = this.#isThreadControlled;
    const threadId = isControlled
      ? (options.threadId as string)
      : (this.#override?.threadId ??
        (parent?.threadId || options.threadId || this.#fallbackThreadId));
    const ownExplicit = isControlled
      ? true
      : (this.#override?.explicit ?? options.hasExplicitThreadId ?? false);
    const ownsDrawer = parent === null;
    return {
      agentId:
        options.agentId ??
        parent?.agentId ??
        options.providerAgentId ??
        DEFAULT_AGENT_ID,
      threadId,
      hasExplicitThreadId: ownExplicit || !!parent?.hasExplicitThreadId,
      isModalOpen:
        this.#hasOwnModal || !parent ? this.#ownModalOpen : parent.isModalOpen,
      drawerOpen: ownsDrawer ? this.#ownDrawerOpen : parent.drawerOpen,
      drawerRegistered: ownsDrawer
        ? this.#drawerCount > 0
        : parent.drawerRegistered,
    };
  }

  #refresh() {
    const snapshot = this.getSnapshot();
    if (snapshot === this.#notified) return;
    this.#notified = snapshot;
    const listeners = [...this.#listeners];
    for (const listener of listeners) listener();
  }
}
