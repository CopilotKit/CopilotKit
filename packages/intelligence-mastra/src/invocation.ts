import { AsyncLocalStorage } from "node:async_hooks";
import { SkillDeliveryError } from "@copilotkit/intelligence-delivery-core";
import type {
  SkillRegistry,
  VerifiedSnapshot,
} from "@copilotkit/intelligence-delivery-core";

const invocationMethods = new Set<PropertyKey>([
  "generate",
  "stream",
  "resumeGenerate",
  "resumeStream",
  "approveToolCall",
  "declineToolCall",
  "approveToolCallGenerate",
  "declineToolCallGenerate",
]);
const approvalMethods = new Set<PropertyKey>([
  "approveToolCall",
  "declineToolCall",
  "approveToolCallGenerate",
  "declineToolCallGenerate",
]);

/** A private snapshot lifetime, independent of Mastra's persisted tool closures. */
export class SkillInvocationScope {
  readonly #storage = new AsyncLocalStorage<VerifiedSnapshot>();
  readonly #wrapped = new WeakMap<object, object>();

  constructor(private readonly registry: SkillRegistry) {
    if (!registry || typeof registry.acquireSnapshot !== "function") {
      throw new SkillDeliveryError("INVALID_CONFIG", false);
    }
  }

  snapshot(): VerifiedSnapshot {
    const snapshot = this.#storage.getStore();
    if (!snapshot) throw new SkillDeliveryError("INVALID_CONFIG", false);
    return snapshot;
  }

  async #acquire(signal?: AbortSignal): Promise<VerifiedSnapshot> {
    signal?.throwIfAborted();
    const pending = this.registry.acquireSnapshot();
    if (!signal) return pending;
    let abort!: () => void;
    try {
      const snapshot = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
      signal.throwIfAborted();
      return snapshot;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  wrapAgent<T extends object>(agent: T): T {
    if (!agent || typeof Reflect.get(agent, "generate") !== "function") {
      throw new SkillDeliveryError("INVALID_CONFIG", false);
    }
    const existing = this.#wrapped.get(agent);
    if (existing) return existing as T;
    const methods = new Map<
      PropertyKey,
      { original: Function; bound: Function }
    >();
    const wrapped = new Proxy(agent, {
      get: (target, key) => {
        // Mastra methods access JavaScript private fields, so the native object
        // remains their receiver, including delegation between approval methods.
        const original = Reflect.get(target, key, target);
        if (typeof original !== "function") return original;
        const cached = methods.get(key);
        if (cached?.original === original) return cached.bound;
        const bound = invocationMethods.has(key)
          ? async (...args: unknown[]) => {
              const options = args[approvalMethods.has(key) ? 0 : 1] as
                | { abortSignal?: AbortSignal }
                | undefined;
              const snapshot = await this.#acquire(options?.abortSignal);
              return this.#storage.run(snapshot, () =>
                Reflect.apply(original, target, args),
              );
            }
          : original.bind(target);
        methods.set(key, { original, bound });
        return bound;
      },
    });
    this.#wrapped.set(agent, wrapped);
    this.#wrapped.set(wrapped, wrapped);
    return wrapped;
  }
}
