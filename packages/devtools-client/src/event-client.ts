import { EventClient } from "@tanstack/devtools-event-client";
import type { CopilotKitDevtoolsEvents } from "./types.js";

/**
 * Strips the "copilotkit:" prefix from all keys in CopilotKitDevtoolsEvents,
 * because EventClient adds the pluginId prefix automatically via emit/on.
 */
type StripPrefix<TMap, TPrefix extends string> = {
  [K in keyof TMap & string as K extends `${TPrefix}${infer Suffix}`
    ? Suffix
    : never]: TMap[K];
};

export type CopilotKitEventSuffixes = StripPrefix<CopilotKitDevtoolsEvents, "copilotkit:">;

/**
 * Lazy wrapper around EventClient that defers instantiation of the underlying
 * EventClient until the first emit/on call.
 * This avoids allocating resources at module evaluation time for applications
 * that import @copilotkit/core but never use devtools.
 *
 * If instantiation fails, the error is cached and rethrown on every
 * subsequent access — construction is not retried.
 */
class CopilotKitEventClient {
  private _client: EventClient<CopilotKitEventSuffixes> | null = null;
  private _initError: Error | null = null;

  private get client(): EventClient<CopilotKitEventSuffixes> {
    if (this._initError) {
      throw this._initError;
    }
    if (!this._client) {
      try {
        this._client = new EventClient<CopilotKitEventSuffixes>({
          pluginId: "copilotkit",
          debug: false,
        });
      } catch (err) {
        this._initError = err instanceof Error ? err : new Error(String(err));
        throw this._initError;
      }
    }
    return this._client;
  }

  emit<K extends keyof CopilotKitEventSuffixes & string>(
    event: K,
    payload: CopilotKitEventSuffixes[K],
  ): void {
    this.client.emit(event, payload);
  }

  on<K extends keyof CopilotKitEventSuffixes & string>(
    event: K,
    handler: (e: { payload: CopilotKitEventSuffixes[K] }) => void,
    options?: { withEventTarget?: boolean },
  ): () => void {
    return this.client.on(event, (e) => handler({ payload: e.payload }), options);
  }
}

export const devtoolsClient = new CopilotKitEventClient();
