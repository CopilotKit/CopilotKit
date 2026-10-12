import { installClickCapture } from "./clicks";
import { installNavigationCapture } from "./navigation";
import { installInputCapture } from "./inputs";
import { installNetworkCapture } from "./network";
import { createRedactor } from "./redact";
import { toRoute } from "./routes";
import { BUILT_IN_EVENT_NAMES } from "./types";
import type {
  JsonValue,
  TrajectoryCaptureOptions,
  TrajectoryCollector,
  TrajectoryEvent,
} from "./trajectory-types";

export const MAX_TRAJECTORY_EVENT_BYTES = 16 * 1024;
const RESERVED_NAMES = new Set<string>(BUILT_IN_EVENT_NAMES);

function isJson(
  value: unknown,
  ancestors = new Set<object>(),
): value is JsonValue {
  if (typeof value === "string") return !value.includes("\0");
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false;
  ancestors.add(value);
  if (
    !Array.isArray(value) &&
    Object.keys(value).some((key) => key.includes("\0"))
  )
    return false;
  const values = Array.isArray(value) ? value : Object.values(value);
  for (const item of values) {
    if (!isJson(item, ancestors)) return false;
  }
  ancestors.delete(value);
  return true;
}

/**
 * Captures outside-chat activity as plain AG-UI events, without a send queue.
 * Core starts this collector only after authentication and channel join.
 */
export function createTrajectoryCollector(
  options: TrajectoryCaptureOptions & {
    send: (event: TrajectoryEvent) => void;
  },
): TrajectoryCollector {
  let active = false;
  let generation = 0;
  let uninstalls: (() => void)[] = [];
  let flushInputs: (() => void) | undefined;

  const report = (code: string, message: string) => {
    try {
      options.onError?.({ code, message });
    } catch {
      // Diagnostic callbacks must not interrupt the host app.
    }
  };

  const getRoute = () => toRoute(location.pathname);

  const record = (name: string, value: JsonValue) => {
    if (!active) return;
    const current = generation;
    if (name !== "input" && name !== "network") flushInputs?.();
    if (!active || generation !== current) return;
    let payload: TrajectoryEvent;
    try {
      const event: TrajectoryEvent = {
        type: "CUSTOM",
        name,
        timestamp: Date.now(),
        value,
      };
      const kept =
        options.beforeSend === undefined ? event : options.beforeSend(event);
      if (kept === null || !active || generation !== current) return;
      if (
        kept.type !== "CUSTOM" ||
        typeof kept.name !== "string" ||
        !kept.name.trim() ||
        kept.name.length > 200 ||
        kept.name.includes("\0") ||
        !Number.isFinite(kept.timestamp) ||
        kept.timestamp <= 0 ||
        kept.timestamp >= 253_402_300_800_000 ||
        !isJson(kept.value)
      ) {
        report(
          "INVALID_EVENT",
          "The event must contain a name, timestamp, and JSON value.",
        );
        return;
      }
      // Keep only the contract envelope and snapshot the value before delivery.
      const serialized = JSON.stringify({
        type: kept.type,
        name: kept.name,
        timestamp: kept.timestamp,
        value: kept.value,
      });
      if (
        new TextEncoder().encode(serialized).byteLength >
        MAX_TRAJECTORY_EVENT_BYTES
      ) {
        report("EVENT_TOO_LARGE", "The serialized event exceeds 16 KiB.");
        return;
      }
      payload = JSON.parse(serialized) as TrajectoryEvent;
    } catch {
      report("INVALID_EVENT", "The event could not be serialized as JSON.");
      return;
    }
    try {
      options.send(payload);
    } catch {
      report(
        "PERSISTENCE_UNKNOWN",
        "Event delivery failed. The event will not be retried.",
      );
    }
  };

  const capture = (name: string, value: Record<string, unknown>) => {
    // Shared capture modules produce JSON; record validates and snapshots before sending.
    record(name, value as JsonValue);
  };

  const stop = () => {
    const current = generation;
    const flush = flushInputs;
    flushInputs = undefined;
    flush?.();
    if (generation !== current) return;
    generation++;
    active = false;
    const installed = uninstalls;
    uninstalls = [];
    for (const uninstall of installed) uninstall();
  };

  return {
    start() {
      if (active || typeof window === "undefined") return;
      active = true;
      generation++;
      // Native callers can emit developer events without browser observers.
      if (typeof window.addEventListener !== "function") return;
      // One per session: fields seen and values typed are forgotten on stop().
      const redact = createRedactor();
      try {
        uninstalls.push(redact.watch());
        if (options.capture?.clicks !== false) {
          uninstalls.push(
            installClickCapture({ emit: capture, getRoute, redact }),
          );
        }
        if (options.capture?.navigation !== false) {
          uninstalls.push(installNavigationCapture({ emit: capture, redact }));
        }
        if (options.capture?.inputs !== false) {
          const inputs = installInputCapture({ emit: capture, redact });
          flushInputs = inputs.flush;
          uninstalls.push(inputs);
        }
        if (options.capture?.network !== false) {
          uninstalls.push(
            installNetworkCapture({
              emit: capture,
              ignoreUrls: options.ignoreUrls ?? [],
              redact,
            }),
          );
        }
        record("page", {
          route: getRoute(),
          url: redact.url(location.href),
          title: document.title,
          referrer: redact.url(document.referrer),
        });
      } catch {
        stop();
        report("CAPTURE_FAILED", "Browser capture could not start.");
      }
    },
    stop,
    emit(name, value) {
      if (!active) return;
      if (RESERVED_NAMES.has(name)) {
        report(
          "INVALID_EVENT",
          "Use a developer event name, not a reserved capture name.",
        );
        return;
      }
      record(name, value);
    },
  };
}
