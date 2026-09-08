"use client";

import { useAgent } from "@copilotkit/react-core/v2";
import type { OpenGenerativeUIContent } from "@copilotkit/react-core/v2";

const OGUI_ACTIVITY_TYPE = "open-generative-ui";

/** Minimal shape of an OGUI activity message in the agent's message list. */
type MaybeActivityMessage = {
  id?: string;
  role?: string;
  activityType?: string;
  content?: Record<string, unknown>;
};

/**
 * The latest Open Generative UI surface in the agent's message stream.
 *
 * The OpenGenerativeUIMiddleware turns a `generateSandboxedUi` call into an
 * `open-generative-ui` activity message whose content is the streamed
 * css/html/js. We read it straight from `agent.messages`, mirroring
 * `useReportSurface` rather than relaying through a side channel.
 *
 * `surfaceId` is the activity message id (stable per call) so the canvas
 * dismiss can key on it without suppressing a later surface. This depends on
 * the activity message carrying an `id`; a later e2e task verifies the surface
 * mounts, and if `id` proves absent there it will be adjusted then.
 */
export function useOguiSurface(): {
  content: OpenGenerativeUIContent | null;
  surfaceId: string | null;
} {
  const { agent } = useAgent();
  // No manual useMemo: downstream consumers guard on values, and the React
  // Compiler memoizes this derivation from agent.messages — a manual memo here
  // can't be preserved by the compiler (react-hooks/preserve-manual-memoization).
  const messages = agent?.messages as MaybeActivityMessage[] | undefined;
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (
        message?.role === "activity" &&
        message?.activityType === OGUI_ACTIVITY_TYPE
      ) {
        return {
          content: (message.content as OpenGenerativeUIContent) ?? null,
          surfaceId: message.id ?? null,
        };
      }
    }
  }
  return { content: null, surfaceId: null };
}
