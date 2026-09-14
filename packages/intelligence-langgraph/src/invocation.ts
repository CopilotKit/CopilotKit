import { AsyncLocalStorage } from "node:async_hooks";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { SkillDeliveryError } from "@copilotkit/intelligence-delivery-core";
import type { SkillRegistry } from "@copilotkit/intelligence-delivery-core";
import type { VerifiedSnapshot } from "@copilotkit/intelligence-delivery-core";

interface Invocation {
  snapshot?: Promise<VerifiedSnapshot>;
}

const entries = new Set<PropertyKey>(["invoke", "stream", "streamEvents"]);
const unsupportedEntries = new Set<PropertyKey>(["batch", "batchAsCompleted"]);

/** Private run lifetime; nothing is added to graph state or runnable config. */
export class SkillInvocationScope {
  readonly #registry: SkillRegistry;
  readonly #storage = new AsyncLocalStorage<Invocation>();
  readonly #wrapped = new WeakMap<object, object>();
  readonly #defaultSignals = new WeakMap<object, AbortSignal>();

  constructor(registry: SkillRegistry) {
    if (!registry || typeof registry.acquireSnapshot !== "function") {
      throw new SkillDeliveryError("INVALID_CONFIG", false);
    }
    this.#registry = registry;
  }

  snapshot(): Promise<VerifiedSnapshot> {
    const invocation = this.#storage.getStore();
    if (!invocation) {
      // Register the middleware and use its wrapAgent result to execute the run.
      throw new SkillDeliveryError("INVALID_CONFIG", false);
    }
    // Assign before invoking the registry, retaining both success and denial.
    return (invocation.snapshot ??= Promise.resolve().then(() =>
      this.#registry.acquireSnapshot(),
    ));
  }

  async #prepare(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const snapshot = this.snapshot();
    if (!signal) {
      await snapshot;
      return;
    }
    let abort!: () => void;
    try {
      await Promise.race([
        snapshot,
        new Promise<never>((_, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
      signal.throwIfAborted();
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  #delegate(
    method: Function,
    target: object,
    args: unknown[],
    signal?: AbortSignal,
  ): unknown {
    const config = args[1] as { signal?: AbortSignal } | undefined;
    if (!signal || signal === config?.signal)
      return Reflect.apply(method, target, args);
    // ReactAgent omits signal when exposing its compiled graph. Forward the
    // wrapper's effective signal so cancellation still reaches native execution.
    const forwarded = [...args];
    forwarded[1] = { ...config, signal };
    return Reflect.apply(method, target, forwarded);
  }

  #eventStream(
    method: Function,
    target: object,
    args: unknown[],
    signal?: AbortSignal,
  ): IterableReadableStream<unknown> {
    const cancellation = new AbortController();
    const forwardAbort = () => cancellation.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    if (signal?.aborted) forwardAbort();
    let stream: IterableReadableStream<unknown> | undefined;
    let reader: ReadableStreamDefaultReader<unknown> | undefined;
    let cancelled = false;
    const release = () => {
      reader?.releaseLock();
      reader = undefined;
    };
    // Establish the native producer in the invocation's async context. Readiness
    // covers only snapshot acquisition, not the lifetime of the event stream.
    const ready = this.#prepare(cancellation.signal)
      .then(() => {
        cancellation.signal.throwIfAborted();
        stream = this.#delegate(
          method,
          target,
          args,
          signal,
        ) as IterableReadableStream<unknown>;
        reader = stream!.getReader();
      })
      .finally(() => signal?.removeEventListener("abort", forwardAbort));
    // A caller may cancel without ever reading; observe the rejected readiness.
    void ready.catch(() => undefined);
    return new IterableReadableStream<unknown>({
      pull: async (controller) => {
        try {
          await ready;
          if (cancelled) return;
          const chunk = await reader!.read();
          if (cancelled) return;
          if (chunk.done) {
            controller.close();
            release();
          } else controller.enqueue(chunk.value);
        } catch (error) {
          if (!cancelled) {
            controller.error(error);
            release();
          }
        }
      },
      cancel: async (reason) => {
        cancelled = true;
        cancellation.abort(reason);
        await ready.catch(() => undefined);
        try {
          // Native LangGraph cancel aborts its producer even with a locked reader.
          if (stream && "signal" in stream) await stream.cancel(reason);
          await reader?.cancel(reason);
        } finally {
          release();
        }
      },
    });
  }

  #defaultSignal(agent: object): AbortSignal | undefined {
    return (
      this.#defaultSignals.get(agent) ??
      Reflect.get(agent, "config", agent)?.signal
    );
  }

  #mergeSignal(
    first?: AbortSignal,
    second?: AbortSignal,
  ): AbortSignal | undefined {
    return first && second && first !== second
      ? AbortSignal.any([first, second])
      : (first ?? second);
  }

  wrapAgent<T extends object>(agent: T): T {
    if (
      !agent ||
      (typeof agent !== "object" && typeof agent !== "function") ||
      ![...entries].every(
        (key) => typeof Reflect.get(agent, key, agent) === "function",
      )
    ) {
      throw new SkillDeliveryError("INVALID_CONFIG", false);
    }
    const existing = this.#wrapped.get(agent);
    if (existing) return existing as T;
    const methods = new Map<
      PropertyKey,
      { source: Function; bound: Function }
    >();
    const proxy = new Proxy(agent, {
      get: (target, key) => {
        // Native ReactAgent and compiled graph getters use private receivers.
        const value = Reflect.get(target, key, target);
        if (key === "graph" && value && typeof value === "object") {
          const signal = this.#mergeSignal(
            this.#defaultSignal(value),
            this.#defaultSignal(target),
          );
          if (signal) this.#defaultSignals.set(value, signal);
          return this.wrapAgent(value);
        }
        if (typeof value !== "function" || key === "constructor") return value;
        const cached = methods.get(key);
        if (cached?.source === value) return cached.bound;
        let bound: Function;
        if (entries.has(key)) {
          bound = (...args: unknown[]) =>
            this.#storage.run({}, () => {
              const config = args[1] as
                | { signal?: AbortSignal; version?: string }
                | undefined;
              const signal = this.#mergeSignal(
                this.#defaultSignal(target),
                config?.signal,
              );
              if (
                key === "streamEvents" &&
                (config?.version !== "v3" || args[2] != null)
              ) {
                return this.#eventStream(value, target, args, signal);
              }
              return this.#prepare(signal).then(() => {
                signal?.throwIfAborted();
                return this.#delegate(value, target, args, signal);
              });
            });
        } else if (key === "withConfig") {
          bound = (...args: unknown[]) => {
            const configured = Reflect.apply(value, target, args);
            const signal = this.#mergeSignal(
              this.#defaultSignal(target),
              (args[0] as { signal?: AbortSignal } | undefined)?.signal,
            );
            if (signal) this.#defaultSignals.set(configured, signal);
            return this.wrapAgent(configured);
          };
        } else if (unsupportedEntries.has(key)) {
          // Only the three native invocation entries above are supported. A
          // raw bound batch would invoke the target outside the private scope.
          bound = () => {
            throw new SkillDeliveryError("INVALID_CONFIG", false);
          };
        } else {
          bound = value.bind(target);
        }
        methods.set(key, { source: value, bound });
        return bound;
      },
      set: (target, key, value) => Reflect.set(target, key, value, target),
    });
    this.#wrapped.set(agent, proxy);
    this.#wrapped.set(proxy, proxy);
    return proxy;
  }
}
