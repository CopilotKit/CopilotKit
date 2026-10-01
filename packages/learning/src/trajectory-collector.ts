import { installClickCapture } from "./clicks";
import { installNavigationCapture } from "./navigation";
import { toRoute } from "./routes";
import { BUILT_IN_EVENT_NAMES } from "./types";
import type {
  JsonValue,
  TrajectoryCaptureOptions,
  TrajectoryCollector,
  TrajectoryEvent,
} from "./trajectory-types";

export const MAX_TRAJECTORY_EVENT_BYTES = 64 * 1024;
const RESERVED_NAMES = new Set<string>(BUILT_IN_EVENT_NAMES);

function isJson(
  value: unknown,
  ancestors = new Set<object>(),
): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false;
  ancestors.add(value);
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
  const routes = [...(options.routes ?? [])];
  let active = false;
  let uninstalls: (() => void)[] = [];

  const report = (code: string, message: string) => {
    try {
      options.onError?.({ code, message });
    } catch {
      // Diagnostic callbacks must not interrupt the host app.
    }
  };

  const configuredRoute = (value: unknown) =>
    typeof value === "string" && routes.includes(value) ? value : null;
  const getRoute = () => toRoute(location.pathname, routes);

  const record = (name: string, value: JsonValue) => {
    if (!active) return;
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
      if (kept === null || !active) return;
      if (
        kept.type !== "CUSTOM" ||
        typeof kept.name !== "string" ||
        !kept.name.trim() ||
        !Number.isFinite(kept.timestamp) ||
        kept.timestamp < 0 ||
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
        report("EVENT_TOO_LARGE", "The serialized event exceeds 64 KiB.");
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
    if (name === "navigation") {
      record(name, {
        from: configuredRoute(value.from),
        to: configuredRoute(value.to),
      });
    } else if (name === "click") {
      const target = value.target as {
        tag: string;
        role: string | null;
        action: string | null;
      };
      record(name, {
        route: configuredRoute(value.route),
        target: { tag: target.tag, role: target.role, action: target.action },
      });
    }
  };

  const stop = () => {
    active = false;
    const installed = uninstalls;
    uninstalls = [];
    for (const uninstall of installed) uninstall();
  };

  return {
    start() {
      if (active || typeof window === "undefined") return;
      active = true;
      try {
        if (options.capture?.clicks !== false) {
          uninstalls.push(installClickCapture({ emit: capture, getRoute }));
        }
        if (options.capture?.navigation !== false) {
          uninstalls.push(installNavigationCapture({ emit: capture, routes }));
        }
        record("page", { route: configuredRoute(getRoute()) });
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
