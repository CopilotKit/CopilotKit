"use client";

import { useAgent } from "@copilotkit/react-core/v2";
import {
  A2UI_OPERATIONS_KEY,
  extractSurfaceId,
  type A2UIOp,
} from "@/a2ui/build-report-ops";

/** Minimal shape of an A2UI activity message in the agent's message list. */
type MaybeActivityMessage = {
  role?: string;
  activityType?: string;
  content?: Record<string, unknown>;
};

/**
 * The latest A2UI report surface in the agent's message stream.
 *
 * The A2UI middleware turns the render_report tool result into an
 * `a2ui-surface` activity message carrying `a2ui_operations`. We read that
 * directly from `agent.messages` (the pattern the framework's own renderer and
 * the reference apps use) rather than relaying through a side channel.
 */
export function useReportSurface(): {
  operations: A2UIOp[];
  surfaceId: string | null;
} {
  const { agent } = useAgent();
  // No manual useMemo: downstream consumers guard on values (SurfaceMessageProcessor
  // hashes the ops; CanvasProvider compares the string surfaceId), and the React
  // Compiler memoizes this derivation from agent.messages — a manual memo here
  // can't be preserved by the compiler (react-hooks/preserve-manual-memoization).
  const messages = agent?.messages as MaybeActivityMessage[] | undefined;
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (
        message?.role === "activity" &&
        message?.activityType === "a2ui-surface"
      ) {
        const operations =
          (message.content?.[A2UI_OPERATIONS_KEY] as A2UIOp[]) ?? [];
        return {
          operations,
          surfaceId: operations.length ? extractSurfaceId(operations) : null,
        };
      }
    }
  }
  return { operations: [], surfaceId: null };
}
