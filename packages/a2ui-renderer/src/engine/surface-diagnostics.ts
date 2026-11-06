import {
  ɵA2UI_PAINT_FALLBACK_MS,
  ɵdiagnoseMissingSurface,
  ɵdiagnoseUnresolvedRoot,
  ɵgetA2UIOperations,
  ɵgroupA2UIOperationsBySurface,
} from "@copilotkit/core";
import type { ɵA2UIDiagnosedSurface, ɵA2UIScheduler } from "@copilotkit/core";

/** Looks a surface up in the model the operations were applied to. */
export interface A2UISurfaceLookup {
  getSurface(surfaceId: string): ɵA2UIDiagnosedSurface | undefined;
}

export interface A2UISurfaceDiagnosticsOptions {
  /** Receives each diagnostic message, e.g. `console.warn`. */
  warn: (message: string) => void;
  /** Timer to use. Default `setTimeout`. */
  schedule?: ɵA2UIScheduler;
}

const defaultSchedule: ɵA2UIScheduler = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
};

/**
 * Development diagnostics for applied operations. Create it only in
 * development builds.
 *
 * After each `check()`:
 * - a surface still missing one task later was never created (operations
 *   addressed to one id while the surface was created under another, or
 *   operations that were all dropped as invalid);
 * - a surface whose root component is still missing 8 s later, with no newer
 *   operations in between, will animate a placeholder forever.
 *
 * Each `check()` cancels the checks of the one before, so only the last
 * snapshot of a stream is diagnosed.
 *
 * @example
 * ```ts
 * const diagnostics = new A2UISurfaceDiagnostics({ warn: console.warn });
 * applier.apply(operations);
 * diagnostics.check(operations, processor.model);
 * ```
 */
export class A2UISurfaceDiagnostics {
  readonly #warn: (message: string) => void;
  readonly #schedule: ɵA2UIScheduler;
  #cancels: (() => void)[] = [];

  constructor(options: A2UISurfaceDiagnosticsOptions) {
    this.#warn = options.warn;
    this.#schedule = options.schedule ?? defaultSchedule;
  }

  /**
   * Schedules the checks for operations that were just applied.
   *
   * @param operations - The operations that were applied.
   * @param model - Where the surfaces live, read when each check runs.
   */
  check(operations: readonly unknown[], model: A2UISurfaceLookup) {
    this.dispose();
    const groups = ɵgroupA2UIOperationsBySurface(
      ɵgetA2UIOperations({ a2ui_operations: operations }),
    );
    for (const [surfaceId, group] of groups) {
      if (model.getSurface(surfaceId)) {
        this.#cancels.push(
          this.#schedule(() => {
            const surface = model.getSurface(surfaceId);
            if (!surface) return;
            const message = ɵdiagnoseUnresolvedRoot(surfaceId, group, surface);
            if (message) this.#warn(message);
          }, ɵA2UI_PAINT_FALLBACK_MS),
        );
        continue;
      }
      const deleted = group.some((operation) => "deleteSurface" in operation);
      if (deleted) continue;
      this.#cancels.push(
        this.#schedule(() => {
          if (model.getSurface(surfaceId)) return;
          this.#warn(ɵdiagnoseMissingSurface(surfaceId, group));
        }, 0),
      );
    }
  }

  /** Cancels the pending checks. */
  dispose() {
    for (const cancel of this.#cancels) cancel();
    this.#cancels = [];
  }
}
