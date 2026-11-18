import type { ThreadsState } from "./state.js";
import { html, nothing } from "lit";

export type ThreadsUsageBucket =
  | "absent"
  | "empty"
  | "within_limit"
  | "at_or_over_limit"
  | "unlimited"
  | "unknown_limit";

export type ThreadsExpiryBucket = "unavailable" | "zero" | "positive";

export type ThreadsUsage = {
  used: number;
  limit:
    | { kind: "finite"; value: number }
    | { kind: "unlimited" }
    | { kind: "unknown" };
  expiringSoonCount?: number;
};

export function getThreadsUsageBucket(
  usage: ThreadsUsage | undefined,
): ThreadsUsageBucket {
  if (!usage) return "absent";
  if (usage.used === 0) return "empty";
  if (usage.limit.kind === "finite") {
    return usage.used < usage.limit.value ? "within_limit" : "at_or_over_limit";
  }
  if (usage.limit.kind === "unlimited") return "unlimited";
  return "unknown_limit";
}

export function getThreadsCapacityState(
  usage: ThreadsUsage | undefined,
): "normal" | "warning" | "critical" | undefined {
  if (!usage || usage.limit.kind !== "finite") return undefined;
  if (usage.used >= usage.limit.value) return "critical";
  const warningThreshold =
    usage.limit.value - Math.floor(usage.limit.value / 10);
  return usage.used >= warningThreshold ? "warning" : "normal";
}

export function getThreadsExpiryBucket(
  usage: ThreadsUsage | undefined,
): ThreadsExpiryBucket {
  if (!usage || !Object.hasOwn(usage, "expiringSoonCount")) {
    return "unavailable";
  }
  if (usage.expiringSoonCount === 0) return "zero";
  return typeof usage.expiringSoonCount === "number" &&
    usage.expiringSoonCount > 0
    ? "positive"
    : "unavailable";
}

export function scheduleThreadsUsageRefresh(
  state: ThreadsState,
  refresh: () => void,
): void {
  const signature = state.threads
    .map((thread) => thread.id)
    .sort()
    .join(",");
  if (signature === state.threadUsageSignature) return;

  state.threadUsageSignature = signature;
  if (state.threadUsageRefreshTimer !== null) {
    clearTimeout(state.threadUsageRefreshTimer);
  }
  state.threadUsageRefreshTimer = setTimeout(() => {
    state.threadUsageRefreshTimer = null;
    refresh();
  }, 300);
}

export function clearThreadsUsageRefresh(state: ThreadsState): void {
  if (state.threadUsageRefreshTimer !== null) {
    clearTimeout(state.threadUsageRefreshTimer);
    state.threadUsageRefreshTimer = null;
  }
  state.threadUsageSignature = "";
}

export function getMetadataActionPlacement(
  placement: "threads-footer" | "locked",
): "threads_footer" | "threads_locked" {
  return placement === "threads-footer" ? "threads_footer" : "threads_locked";
}

export function renderThreadsUsageFooter(
  usage: ThreadsUsage | undefined,
  action: unknown | null,
  capacityState: "normal" | "warning" | "critical" | undefined,
) {
  if (!usage && action === null) return nothing;

  let countLabel: string | undefined;
  let progressMax: number | undefined;
  let progressValue: number | undefined;
  if (usage) {
    if (usage.limit.kind === "finite") {
      const visibleUsed =
        usage.used > usage.limit.value
          ? `${usage.limit.value}+`
          : String(usage.used);
      countLabel = `${visibleUsed} / ${usage.limit.value} Threads`;
      progressMax = usage.limit.value;
      progressValue = Math.min(usage.used, usage.limit.value);
    } else if (usage.limit.kind === "unlimited") {
      countLabel = `${usage.used} Threads · Unlimited`;
    } else {
      countLabel = `${usage.used} Threads · Limit unavailable`;
    }
  }

  return html`
    <footer
      class="inspector-threads-footer"
      data-inspector-threads-footer
      role="group"
      aria-label="Threads usage"
    >
      ${
        usage && countLabel
          ? html`<div class="inspector-threads-usage">
            <span data-inspector-thread-count>${countLabel}</span>
            ${
              progressMax !== undefined && progressValue !== undefined
                ? html`<progress
                  class="inspector-thread-progress"
                  data-inspector-thread-progress
                  data-inspector-thread-capacity=${capacityState}
                  max=${progressMax}
                  value=${progressValue}
                  aria-label=${
                    capacityState === "warning"
                      ? `${countLabel}. Near thread limit.`
                      : capacityState === "critical"
                        ? `${countLabel}. Thread limit reached.`
                        : countLabel
                  }
                >
                  ${countLabel}
                </progress>`
                : nothing
            }
            ${
              usage.expiringSoonCount !== undefined
                ? html`<span data-inspector-thread-expiry
                  >${usage.expiringSoonCount} Expiring Soon</span
                >`
                : nothing
            }
          </div>`
          : nothing
      }
      ${action ?? nothing}
    </footer>
  `;
}
