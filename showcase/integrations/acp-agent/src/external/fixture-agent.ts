import {
  PROTOCOL_VERSION,
  agent as createAgentApp,
  methods,
} from "@agentclientprotocol/sdk";
import type {
  AgentApp,
  PromptRequest,
  PromptResponse,
} from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";

const promptText = (request: PromptRequest): string =>
  request.prompt
    .filter(
      (block): block is Extract<typeof block, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");

/** Builds the deterministic external ACP agent used only by this Showcase. */
export const createShowcaseFixtureAgent = (): AgentApp => {
  const pendingCancellation = new Map<string, () => void>();
  const cancelledSessions = new Set<string>();

  return createAgentApp({ name: "ACP Showcase external fixture" })
    .onRequest(methods.agent.initialize, ({ params }) => {
      if (params.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(`Unsupported ACP version: ${params.protocolVersion}`);
      }
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: "ACP Showcase external fixture", version: "1" },
      };
    })
    .onRequest(methods.agent.session.new, () => ({
      sessionId: `showcase-${randomUUID()}`,
    }))
    .onRequest(methods.agent.session.load, () => ({}))
    .onRequest(
      methods.agent.session.prompt,
      async ({ params, client }): Promise<PromptResponse> => {
        let cancelled = cancelledSessions.delete(params.sessionId);
        let resolveCancellation: (() => void) | undefined;
        const cancellation = new Promise<void>((resolve) => {
          resolveCancellation = resolve;
        });
        pendingCancellation.set(params.sessionId, () => {
          cancelled = true;
          resolveCancellation?.();
        });

        try {
          if (cancelled) return { stopReason: "cancelled" };
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_thought_chunk",
              messageId: `thought-${randomUUID()}`,
              content: {
                type: "text",
                text: "I will inspect the request and return a concise result.",
              },
            },
          });
          if (cancelled) return { stopReason: "cancelled" };
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "plan",
              entries: [
                {
                  content: "Inspect the request",
                  priority: "high",
                  status: "completed",
                },
                {
                  content: "Return the result",
                  priority: "medium",
                  status: "in_progress",
                },
              ],
            },
          });
          if (cancelled) return { stopReason: "cancelled" };
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: `tool-${randomUUID()}`,
              title: "Inspect request",
              kind: "search",
              status: "completed",
              content: [
                {
                  type: "content",
                  content: {
                    type: "text",
                    text: "Fixture inspection complete",
                  },
                },
              ],
            },
          });
          if (cancelled) return { stopReason: "cancelled" };

          const requested = promptText(params);
          if (requested.toLowerCase().includes("request permission")) {
            const permission = await client.request(
              methods.client.session.requestPermission,
              {
                sessionId: params.sessionId,
                toolCall: {
                  toolCallId: `permission-${randomUUID()}`,
                  title: "Inspect the Showcase request",
                },
                options: [
                  {
                    optionId: "allow-once",
                    kind: "allow_once",
                    name: "Allow once",
                  },
                  {
                    optionId: "reject-once",
                    kind: "reject_once",
                    name: "Reject",
                  },
                ],
              },
            );
            if (cancelled) return { stopReason: "cancelled" };
            await client.notify(methods.client.session.update, {
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                messageId: `answer-${randomUUID()}`,
                content: {
                  type: "text",
                  text: `Permission outcome: ${permission.outcome.outcome}`,
                },
              },
            });
            return { stopReason: "end_turn" };
          }

          if (requested.toLowerCase().includes("wait for cancellation")) {
            if (!cancelled) await cancellation;
            return { stopReason: "cancelled" };
          }

          const answer = requested.includes("Respond with exactly: OK")
            ? "OK"
            : `External ACP fixture received: ${requested || "an empty prompt"}`;
          const messageId = `answer-${randomUUID()}`;
          for (const chunk of answer.match(/.{1,24}/g) ?? [answer]) {
            if (cancelled) return { stopReason: "cancelled" };
            await client.notify(methods.client.session.update, {
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                messageId,
                content: { type: "text", text: chunk },
              },
            });
            await Promise.race([
              cancellation,
              new Promise<void>((resolve) => setTimeout(resolve, 20)),
            ]);
          }
          return { stopReason: cancelled ? "cancelled" : "end_turn" };
        } finally {
          pendingCancellation.delete(params.sessionId);
        }
      },
    )
    .onNotification(methods.agent.session.cancel, ({ params }) => {
      const pending = pendingCancellation.get(params.sessionId);
      if (pending) pending();
      else cancelledSessions.add(params.sessionId);
    });
};
