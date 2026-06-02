import { randomUUID } from "@copilotkit/shared";
import { useCallback } from "react";
import { useCopilotKit } from "../context";

/**
 * Input to {@link UseLearnFromUserActionRecorder}, the function returned
 * by {@link useLearnFromUserAction}. Captures a single UI interaction that
 * the Intelligence platform's auto-curated knowledge base loop will distill
 * into the team's `/knowledge` notes.
 */
export interface LearnFromUserActionInput {
  /** Thread the action is associated with. May be unknown to the platform. */
  threadId: string;
  /** Short, agent-readable summary of what the user did. Optional. */
  title?: string | null;
  /** Optional longer explanation. */
  description?: string | null;
  /** Free-form, JSON-serializable snapshot describing the action. Optional. */
  data?: unknown;
  /**
   * Learning container(s) this action is routed to. Accepts a single
   * container name or an array of names. Defaults to `["organization"]`
   * server-side when omitted. (Routing is not yet honored by the offline
   * learner; the value is recorded for the forthcoming learner.)
   */
  learningContainer?: string | string[];
  /** Optional caller-defined metadata. Stored verbatim. */
  metadata?: Record<string, unknown> | null;
  /** ISO-8601 client-asserted timestamp. Defaults to server NOW() when absent. */
  occurredAt?: string;
  /**
   * Caller-supplied idempotency key. When omitted, the hook generates a
   * fresh UUID per call so retries collapse to the original row at the
   * platform. Supply your own to keep a single semantic event idempotent
   * across calls (e.g. a React re-render or a manual retry button).
   */
  clientEventId?: string;
}

/** Outcome returned by the recorder function. */
export interface LearnFromUserActionResult {
  /** Platform-assigned id of the user-action row. */
  id: string;
  /** True when the platform recognized this `clientEventId` as a retry. */
  duplicate: boolean;
}

/** Recorder function returned by {@link useLearnFromUserAction}. */
export type UseLearnFromUserActionRecorder = (
  input: LearnFromUserActionInput,
) => Promise<LearnFromUserActionResult>;

/**
 * Record a user UI interaction in the Intelligence platform's user-actions
 * stream. The platform's auto-curated knowledge base agent reads these
 * (alongside finished agent runs) and writes free-form Obsidian-flavored
 * markdown to `/knowledge`, where any agent in the same project can later
 * read it via the `copilotkit_knowledge_base_shell` MCP tool.
 *
 * The hook returns a stable function. Calling it issues a request to the
 * customer's CopilotKit runtime (`POST ${runtimeUrl}/user-actions`), which
 * resolves the Intel user from the BFF's auth and forwards to the
 * platform — the Intel API key never reaches the browser.
 *
 * If `clientEventId` is omitted the hook generates a UUID per call, so a
 * naive double-call (e.g. React 18 strict-mode double-mount, or a retry
 * after a network blip on a fresh Promise) is naturally safe. Supply your
 * own key when a single semantic event must remain idempotent across
 * multiple `learnFromUserAction(...)` calls.
 *
 * @example
 * ```tsx
 * import { useLearnFromUserAction } from "@copilotkit/react-core";
 *
 * function SettingsPage({ threadId }) {
 *   const learnFromUserAction = useLearnFromUserAction();
 *
 *   const onRename = (oldName: string, newName: string) => {
 *     void learnFromUserAction({
 *       threadId,
 *       title: "Renamed project",
 *       data: { previous: { name: oldName }, next: { name: newName } },
 *       learningContainer: "organization",
 *     });
 *   };
 * }
 * ```
 */
export function useLearnFromUserAction(): UseLearnFromUserActionRecorder {
  const { copilotkit } = useCopilotKit();

  return useCallback(
    async (
      input: LearnFromUserActionInput,
    ): Promise<LearnFromUserActionResult> => {
      const runtimeUrl = copilotkit.runtimeUrl;
      if (!runtimeUrl) {
        throw new Error(
          "useLearnFromUserAction: runtimeUrl is not configured. Set it on <CopilotKitProvider runtimeUrl=...>.",
        );
      }

      const clientEventId = input.clientEventId ?? randomUUID();
      const body = {
        clientEventId,
        threadId: input.threadId,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.data !== undefined ? { data: input.data } : {}),
        ...(input.learningContainer !== undefined
          ? { learningContainer: input.learningContainer }
          : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ...(input.occurredAt !== undefined
          ? { occurredAt: input.occurredAt }
          : {}),
      };

      const response = await fetch(`${runtimeUrl}/user-actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(copilotkit.headers ?? {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `useLearnFromUserAction: request failed (${response.status})${
            text ? `: ${text}` : ""
          }`,
        );
      }

      return (await response.json()) as LearnFromUserActionResult;
    },
    [copilotkit],
  );
}
