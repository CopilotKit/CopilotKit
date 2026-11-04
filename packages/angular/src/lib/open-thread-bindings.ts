import { Injectable } from "@angular/core";
import type {
  ɵChatConfigurationStore,
  ɵOpenThreadRegistry,
} from "@copilotkit/core/chat-configuration";

/**
 * Binds each chat configuration's shown Thread to core's open-Thread registry.
 * `CopilotKit` attaches its core when it is created, so this file does not
 * import the `CopilotKit` service (and core) into an app's initial bundle.
 * Configurations created first bind when core attaches.
 *
 * @internal
 */
@Injectable({ providedIn: "root" })
export class ɵOpenThreadBindings {
  #registry: ɵOpenThreadRegistry | undefined;
  readonly #stores = new Map<
    ɵChatConfigurationStore,
    (() => void) | undefined
  >();

  /** Binds every configuration to `registry`, or unbinds them all. */
  attach(registry: ɵOpenThreadRegistry | undefined): void {
    this.#registry = registry;
    for (const [store, unbind] of this.#stores) {
      unbind?.();
      this.#stores.set(store, registry && store.bindOpenThread(registry));
    }
  }

  /** Binds `store` now or once core attaches. Returns the cleanup. */
  add(store: ɵChatConfigurationStore): () => void {
    const registry = this.#registry;
    this.#stores.set(store, registry && store.bindOpenThread(registry));
    return () => {
      this.#stores.get(store)?.();
      this.#stores.delete(store);
    };
  }
}
