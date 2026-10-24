import {
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { useCallback, useEffect, useRef } from "react";
import { AGENT_ID } from "./agent";
import { useDesk } from "./desk-store";
import { ViewRequestSubmissions } from "./view-request-messages";

/** Records the view picked at submit time against the SDK's actual message ID. */
export function useViewRequestMessages() {
  const { agent } = useAgent({ agentId: AGENT_ID, updates: [] });
  const threadId = useCopilotChatConfiguration()?.threadId;
  const { viewRequest } = useDesk();
  const submissions = useRef(new ViewRequestSubmissions());

  useEffect(() => {
    const pending = submissions.current;
    const subscription = agent.subscribe({
      onRunInitialized: ({ messages, input }) => {
        // Subscriber mutations update both the local message list and the
        // outgoing input before transport, so thread history keeps the marker.
        const annotated = pending.annotate(messages, input.threadId);
        if (annotated) return { messages: annotated };
      },
    });
    return () => {
      subscription.unsubscribe();
      pending.clear();
    };
  }, [agent, threadId]);

  return useCallback(
    <T>(submit: () => T): T => {
      const pending = submissions.current;
      const submission = pending.begin(
        threadId ?? agent.threadId,
        viewRequest?.id ?? null,
        agent.messages,
      );
      try {
        const result = submit();
        // SDK submission promises also settle for blocked or abandoned sends.
        // Remove those entries so they cannot label a later question.
        void Promise.resolve(result).then(
          () => pending.finish(submission),
          () => pending.finish(submission),
        );
        return result;
      } catch (error) {
        pending.finish(submission);
        throw error;
      }
    },
    [agent, threadId, viewRequest],
  );
}
