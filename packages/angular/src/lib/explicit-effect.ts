import {
  effect,
  untracked,
  type CreateEffectOptions,
  type EffectCleanupRegisterFn,
  type EffectRef,
} from "@angular/core";

/**
 * Creates an effect whose reactive dependencies are stated up front.
 *
 * `deps` is the only reactive scope: every signal read there is tracked, and
 * nothing read in `run` is. That split is the point — a plain `effect()` tracks
 * whatever its body happens to touch, so an incidental signal read buried in
 * imperative code silently becomes a re-run trigger. Here the trigger set is
 * the first function, and a reader does not have to trace the body to find it.
 *
 * @param deps - Reactive computation; signals read here drive re-runs.
 * @param run - Imperative body, always invoked untracked. Receives the value
 * `deps` returned and the effect's cleanup registration function.
 * @param options - Standard Angular effect options (`injector`, `manualCleanup`).
 * @returns The underlying {@link EffectRef}, so callers can `destroy()` it.
 *
 * @example
 * ```ts
 * explicitEffect(
 *   () => ({ threadId: threadId(), agentId: agentId() }),
 *   ({ threadId, agentId }, onCleanup) => {
 *     const connection = connect(agentId, threadId);
 *     onCleanup(() => connection.close());
 *   },
 * );
 * ```
 *
 * @example
 * ```ts
 * explicitEffect(
 *   () => threadId(),
 *   (threadId) => {
 *     console.log(threadId);
 *   },
 * );
 * ```
 */
export function explicitEffect<T>(
  deps: () => T,
  run: (value: T, onCleanup: EffectCleanupRegisterFn) => void,
  options?: CreateEffectOptions,
): EffectRef {
  return effect((onCleanup) => {
    const value = deps();
    untracked(() => run(value, onCleanup));
  }, options);
}
