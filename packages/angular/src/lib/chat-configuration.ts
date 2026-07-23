import {
  InjectionToken,
  Injectable,
  inject,
  computed,
  signal,
} from "@angular/core";
import type { Provider, Signal } from "@angular/core";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";

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

  /** Imperative override set by internal runtime helpers (e.g. thread-switch). */
  readonly #override = signal<{ threadId: string; explicit: boolean } | null>(
    null,
  );

  /**
   * Auto-minted UUID used when neither a prop-driven nor an imperative
   * override thread id is present.  Generated once per service instance.
   */
  readonly #mintedFallback = randomUUID();

  /**
   * Whether the host application is driving `threadId` authoritatively.
   * A prop-driven `threadId` without an explicit `hasExplicitThreadId: false`
   * override locks the session to that value and prevents imperative overrides.
   */
  readonly #propIsAuthoritative =
    this.#options.threadId !== undefined &&
    this.#options.hasExplicitThreadId !== false;

  /**
   * The resolved agent id for this chat session.
   * Falls back to {@link DEFAULT_AGENT_ID} when no agent id is provided.
   */
  readonly agentId: Signal<string> = computed(
    () => this.#options.agentId ?? DEFAULT_AGENT_ID,
  );

  /**
   * The resolved thread id for this chat session.
   *
   * Precedence (highest → lowest):
   * 1. Prop-driven `threadId` when `#propIsAuthoritative` is true.
   * 2. Imperative `#override` set by internal helpers.
   * 3. Non-authoritative seed `threadId` from options.
   * 4. Auto-minted UUID fallback.
   */
  readonly threadId: Signal<string> = computed(() => {
    if (this.#propIsAuthoritative) {
      return this.#options.threadId as string;
    }
    const o = this.#override();
    if (o) {
      return o.threadId;
    }
    if (this.#options.threadId) {
      return this.#options.threadId;
    }
    return this.#mintedFallback;
  });

  /**
   * Whether the current thread id was supplied explicitly by the host
   * application (as opposed to being auto-minted or seeded without intent).
   */
  readonly hasExplicitThreadId: Signal<boolean> = computed(() => {
    if (this.#propIsAuthoritative) {
      return true;
    }
    return (
      this.#override()?.explicit ?? this.#options.hasExplicitThreadId ?? false
    );
  });

  /** Returns `true` when the host application controls the thread id via props. */
  protected get isControlled(): boolean {
    return this.#propIsAuthoritative;
  }

  /**
   * Sets an imperative thread override.  No-ops when the session is
   * controlled by the host application via props.
   *
   * @param threadId - The thread id to activate.
   * @param explicit - Whether the override represents a deliberate user choice.
   */
  protected _setOverride(threadId: string, explicit: boolean): void {
    if (this.isControlled) {
      return;
    }
    this.#override.set({ threadId, explicit });
  }

  /**
   * Switches the active thread to the given id.
   *
   * By default the switch is treated as an explicit user-driven choice
   * (`explicit` defaults to `true`).  Pass `{ explicit: false }` to mark it as
   * a non-explicit seed that the runtime may replace.
   *
   * No-ops when the threadId is controlled by the host application via props.
   *
   * @param threadId - The thread id to activate.
   * @param options - Optional overrides; `explicit` defaults to `true`.
   */
  setActiveThreadId(threadId: string, options?: { explicit?: boolean }): void {
    this._setOverride(threadId, options?.explicit ?? true);
  }

  /**
   * Abandons the current thread and starts a fresh one by minting a new UUID.
   *
   * The new thread is marked as non-explicit so the runtime may assign a
   * server-side thread id once the first message is sent.
   *
   * No-ops when the threadId is controlled by the host application via props.
   */
  startNewThread(): void {
    this._setOverride(randomUUID(), false);
  }

  // ─── Drawer open-state coordination ──────────────────────────────────────
  // Consumed by CopilotThreadsDrawer to drive the element's controlled `open`
  // property and to announce drawer presence (so a future header launcher can
  // render). A future popup/sidebar can additionally use these for mobile
  // mutual-exclusion between the drawer and other overlays.

  /** Tracks whether the drawer open-state is currently `true`. */
  readonly #drawerOpen = signal(false);

  /** Count of registered drawer instances. Used to derive {@link drawerRegistered}. */
  readonly #drawerCount = signal(0);

  /**
   * Read-only signal reflecting the current drawer open-state.
   *
   * @remarks
   * Consumed by {@link CopilotThreadsDrawer} to drive the element's controlled
   * `open` property; a future popup or sidebar component may also toggle it to
   * implement mobile mutual-exclusion between the drawer and other overlays.
   */
  readonly drawerOpen = this.#drawerOpen.asReadonly();

  /**
   * Sets the drawer open-state imperatively.
   *
   * @remarks
   * Called by {@link CopilotThreadsDrawer} in response to the element's
   * `open-change` event to keep the shared open-state coordinated.
   *
   * @param open - `true` to mark the drawer as open, `false` to close it.
   */
  setDrawerOpen(open: boolean): void {
    this.#drawerOpen.set(open);
  }

  /**
   * Computed signal that is `true` when at least one drawer instance has
   * registered itself via {@link registerDrawer}.
   */
  readonly drawerRegistered = computed(() => this.#drawerCount() > 0);

  /**
   * Registers a drawer instance and returns an idempotent unregister function.
   *
   * Increments the internal drawer count so that {@link drawerRegistered}
   * becomes `true`. The returned function decrements the count when called;
   * calling it more than once is safe — subsequent calls are no-ops (guarded
   * by an `active` flag, floor at 0).
   *
   * @remarks
   * Called by {@link CopilotThreadsDrawer} on construction with cleanup on
   * destroy. Intended for future popup/sidebar coordination as well.
   *
   * @returns An idempotent cleanup function that unregisters this drawer.
   */
  registerDrawer(): () => void {
    this.#drawerCount.update((n) => n + 1);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#drawerCount.update((n) => Math.max(0, n - 1));
    };
  }
}

/**
 * Injection token for the {@link CopilotChatConfiguration} service instance.
 * Use {@link injectChatConfiguration} to retrieve it from the injector.
 */
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
