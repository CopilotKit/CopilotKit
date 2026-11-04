import {
  DestroyRef,
  InjectionToken,
  Injectable,
  inject,
  computed,
  signal,
} from "@angular/core";
import type { Provider, Signal } from "@angular/core";
// The store's own entry, not the core index: a chat configuration is often
// provided in an app's initial bundle, which must not load all of core.
import { ɵChatConfigurationStore } from "@copilotkit/core/chat-configuration";
import { COPILOT_KIT_CONFIG } from "./config";
import { ɵOpenThreadBindings } from "./open-thread-bindings";

/**
 * Options for configuring the CopilotChat session.
 * Mirrors the React CopilotChatConfigurationProvider props so behaviour
 * is consistent across frameworks.
 */
export interface CopilotChatConfigurationOptions {
  /**
   * The agent id to connect to.
   * When omitted the runtime's default agent is used.
   */
  agentId?: string;

  /**
   * An explicit thread id to resume.
   * When provided the session joins the existing thread instead of starting a
   * new one.
   */
  threadId?: string;

  /**
   * Whether the thread id was supplied explicitly by the host application.
   * Defaults to `false`, which seeds a non-explicit thread id that the runtime
   * may override.
   */
  hasExplicitThreadId?: boolean;
}

/**
 * Angular service that holds the runtime chat configuration state.
 *
 * Active-thread resolution mirrors the React
 * `CopilotChatConfigurationProvider` precedence (prop → override → minted)
 * without parent-provider branches (PR1 has no nested providers).
 */
@Injectable()
export class CopilotChatConfiguration {
  readonly #options = inject(COPILOT_CHAT_CONFIGURATION_OPTIONS);

  readonly #store = new ɵChatConfigurationStore(this.#options);

  readonly #snapshot = signal(this.#store.getSnapshot());

  constructor() {
    const destroyRef = inject(DestroyRef);
    const unsubscribe = this.#store.subscribe(() => {
      this.#snapshot.set(this.#store.getSnapshot());
    });
    // Tell Core which Thread this view shows, so captured interactions can
    // link to it. Works without a CopilotKit provider: nothing to register.
    const hasCopilotKit =
      inject(COPILOT_KIT_CONFIG, { optional: true }) !== null;
    const unbindOpenThread = hasCopilotKit
      ? inject(ɵOpenThreadBindings).add(this.#store)
      : undefined;
    destroyRef.onDestroy(() => {
      unbindOpenThread?.();
      unsubscribe();
      this.#store.dispose();
    });
  }

  /** The agent this chat renders. */
  readonly agentId: Signal<string> = computed(() => this.#snapshot().agentId);

  /**
   * The active thread: a controlled `threadId` option, else a picked or new
   * thread, else a seed `threadId`, else a UUID minted once.
   */
  readonly threadId: Signal<string> = computed(() => this.#snapshot().threadId);

  /** `true` when a caller chose the thread (not a minted placeholder). */
  readonly hasExplicitThreadId: Signal<boolean> = computed(
    () => this.#snapshot().hasExplicitThreadId,
  );

  /** `true` when the `threadId` option controls the thread. */
  protected get isControlled(): boolean {
    const { threadId, hasExplicitThreadId } = this.#options;
    return threadId !== undefined && hasExplicitThreadId !== false;
  }

  /**
   * Show `threadId`. `explicit` (default `true`) marks it as a caller choice.
   * Ignored with a warning when the `threadId` option controls the thread.
   */
  setActiveThreadId(threadId: string, options?: { explicit?: boolean }): void {
    this.#store.setActiveThreadId(threadId, options);
  }

  /**
   * Show a fresh client-side thread so the welcome screen shows. Ignored with
   * a warning when the `threadId` option controls the thread.
   */
  startNewThread(): void {
    this.#store.startNewThread();
  }

  /** Whether the thread-list drawer is open. */
  readonly drawerOpen: Signal<boolean> = computed(
    () => this.#snapshot().drawerOpen,
  );

  /** Open or close the drawer. */
  setDrawerOpen(open: boolean): void {
    this.#store.setDrawerOpen(open);
  }

  /** `true` while at least one threads drawer is mounted. */
  readonly drawerRegistered: Signal<boolean> = computed(
    () => this.#snapshot().drawerRegistered,
  );

  /** Announce a mounted drawer. The returned cleanup runs once. */
  registerDrawer(): () => void {
    return this.#store.registerDrawer();
  }
}

export const COPILOT_CHAT_CONFIGURATION =
  new InjectionToken<CopilotChatConfiguration>("COPILOT_CHAT_CONFIGURATION");

/**
 * Injection token for the raw {@link CopilotChatConfigurationOptions} value
 * supplied to {@link provideCopilotChatConfiguration}.
 */
export const COPILOT_CHAT_CONFIGURATION_OPTIONS =
  new InjectionToken<CopilotChatConfigurationOptions>(
    "COPILOT_CHAT_CONFIGURATION_OPTIONS",
  );

/**
 * Registers the {@link CopilotChatConfiguration} service and its options into
 * the current injector.
 *
 * `CopilotChatConfiguration` is registered as the canonical class provider.
 * `COPILOT_CHAT_CONFIGURATION` is aliased to the same instance via
 * `useExisting`, so both `inject(COPILOT_CHAT_CONFIGURATION)` (via
 * {@link injectChatConfiguration}) and a direct `inject(CopilotChatConfiguration)`
 * resolve to the **same object** with shared signal state.
 *
 * @param options - Optional chat configuration overrides.
 * @returns An array of Angular providers to pass to `providers` or
 *   `TestBed.configureTestingModule`.
 */
export function provideCopilotChatConfiguration(
  options: CopilotChatConfigurationOptions = {},
): Provider[] {
  return [
    { provide: COPILOT_CHAT_CONFIGURATION_OPTIONS, useValue: options },
    CopilotChatConfiguration,
    {
      provide: COPILOT_CHAT_CONFIGURATION,
      useExisting: CopilotChatConfiguration,
    },
  ];
}

/**
 * Retrieves the {@link CopilotChatConfiguration} service from the current
 * injection context.
 *
 * Must be called inside an injection context (component constructor, factory
 * function, or `TestBed.runInInjectionContext`).
 */
export function injectChatConfiguration(): CopilotChatConfiguration {
  return inject(COPILOT_CHAT_CONFIGURATION);
}
