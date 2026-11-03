import { isPlatformBrowser } from "@angular/common";
import { NgZone, PLATFORM_ID, inject, isDevMode } from "@angular/core";
import type { ɵA2UIActivityControllerOptions } from "@copilotkit/core";

/**
 * @internal
 * Timers, frames and dev diagnostics for core's A2UI controllers, adapted to
 * Angular: timers run outside the zone and re-enter it to update state, and
 * nothing is scheduled during server rendering. Call in an injection context.
 */
export function injectA2UIControllerScheduling() {
  const zone = inject(NgZone);
  const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  const scheduling: Required<
    Pick<ɵA2UIActivityControllerOptions, "schedule" | "requestFrame">
  > &
    Pick<ɵA2UIActivityControllerOptions, "warn"> = {
    schedule: (callback, ms) => {
      if (!isBrowser) return () => undefined;
      const handle = zone.runOutsideAngular(() =>
        globalThis.setTimeout(() => zone.run(callback), ms),
      );
      return () => globalThis.clearTimeout(handle);
    },
    requestFrame: (callback) => {
      if (isBrowser && typeof globalThis.requestAnimationFrame === "function") {
        globalThis.requestAnimationFrame(() => zone.run(callback));
      } else {
        callback();
      }
    },
    warn: isDevMode() ? (message) => console.warn(message) : undefined,
  };
  return scheduling;
}
