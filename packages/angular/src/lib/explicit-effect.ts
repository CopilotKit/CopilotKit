import {
  effect,
  untracked,
  type EffectCleanupRegisterFn,
  type EffectRef,
} from "@angular/core";

/**
 * Runs an Angular effect with explicit dependency tracking.
 *
 * Signals read inside `track` are the effect's only dependencies; `run`
 * always executes in an untracked context, so signals read there never
 * trigger a re-run. This makes the reactive inputs visible at the call site
 * instead of hiding them inside a large effect body.
 *
 * @param track - Reactive computation returning the value `run` receives.
 * Any signals read here are tracked.
 * @param run - Imperative execution receiving the tracked value and the
 * effect's `onCleanup` hook. Always runs untracked.
 * @returns The underlying {@link EffectRef}.
 */
export function explicitEffect<T>(
  track: () => T,
  run: (tracked: T, onCleanup: EffectCleanupRegisterFn) => void,
): EffectRef {
  return effect((onCleanup) => {
    const tracked = track();
    untracked(() => run(tracked, onCleanup));
  });
}
