import { expect, test, vi } from "vitest";
import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { Section } from "@copilotkit/channels-ui";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";
import { startChannelsWithGatewaySession } from "./realtime-gateway-launcher.js";
import type { LiveSessionDelivery } from "./live-session-transport.js";

class GuardTestGatewaySession implements RealtimeGatewaySession {
  readonly projectHandlers = new Map<string, (payload: unknown) => void>();
  readonly pushes: Array<{ event: string; payload: unknown }> = [];
  leaves = 0;

  push(event: string, payload: unknown): Promise<unknown> {
    this.pushes.push({ event, payload });
    return Promise.resolve({});
  }

  on(event: string, handler: (payload: unknown) => void): void {
    this.projectHandlers.set(event, handler);
  }

  async join(
    _topic: string,
    _payload: unknown,
  ): Promise<RealtimeGatewayDeliveryChannel> {
    return {
      push: async (event, payload) => {
        this.pushes.push({ event, payload });
        if (event === "channel.run.open.v1") {
          const request = payload as { callId: string; responseId: string };
          return {
            deliveryId: "delivery-guard",
            callId: request.callId,
            responseId: request.responseId,
            threadId: "thread-guard",
            runId: "run-guard",
            runnerToken: "runner-token-guard",
            runnerTokenExpiresAt: new Date().toISOString(),
          };
        }
        if (event === "channel.effect.v1") {
          const seq = (payload as { payload: { effect: { seq: number } } })
            .payload.effect.seq;
          return { receivedThrough: seq, appliedThrough: seq };
        }
        return {};
      },
      on: () => undefined,
      leave: () => {
        this.leaves += 1;
      },
    };
  }

  async deliver(delivery: LiveSessionDelivery): Promise<void> {
    this.projectHandlers.get("channel.delivery.v1")?.(delivery);
    await vi.waitFor(() => {
      expect(this.leaves).toBe(1);
    });
  }
}

function slackCommandDelivery(): LiveSessionDelivery {
  return {
    protocol: "channel_session_v1",
    deliveryId: "delivery-guard",
    deliveryCode: "delivery-code-guard",
    sessionTopic: "channel_session:delivery-guard",
    canonicalThreadId: "thread-guard",
    appUserId: "app-user-guard",
    channelId: "channel-guard",
    adapter: "slack",
    turn: {
      id: "turn-guard",
      eventId: "event-guard",
      receivedAt: new Date().toISOString(),
      input: {
        kind: "command",
        command: "triage",
        text: "urgent",
      },
      actor: {
        externalUserId: "slack-user-guard",
        displayName: "Ada",
      },
    },
  };
}

async function setupManagedSlackCommand() {
  const gateway = new GuardTestGatewaySession();
  const agent = new FakeAgent();
  const runCanonical = vi.fn(async (args) => args.execute({}));
  const channel = createChannel({
    name: "support",
    agent: () => agent,
  });
  let runError: unknown;
  channel.onCommand("triage", async ({ thread, text }) => {
    try {
      await thread.runAgent({ prompt: text });
    } catch (error) {
      runError = error;
    }
    await thread.post(Section({ children: "Direct command reply" }));
  });
  const handle = await startChannelsWithGatewaySession([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "runtime-guard",
    runCanonical,
    loadHistory: async () => [],
  });

  return {
    agent,
    gateway,
    getRunError: () => runError,
    runCanonical,
    teardown: () => handle.stop(),
  };
}

test("managed Slack commands reject runAgent before opening a run while direct replies still work", async () => {
  const { agent, gateway, getRunError, runCanonical, teardown } =
    await setupManagedSlackCommand();

  try {
    await gateway.deliver(slackCommandDelivery());

    expect(getRunError()).toMatchObject({
      name: "ChannelSlashCommandAgentNotSupportedError",
      code: "channel_slash_command_agent_not_supported",
      message: expect.stringContaining("discrete"),
    });
    expect(agent.runAgentCalls).toBe(0);
    expect(runCanonical).not.toHaveBeenCalled();
    expect(gateway.pushes.map(({ event }) => event)).toEqual([
      "channel.effect.v1",
      "channel.delivery.complete.v1",
    ]);
    expect(gateway.pushes[0]!.payload).toMatchObject({
      payload: {
        effect: {
          kind: "slack.message.create",
          text: "Direct command reply",
        },
      },
    });
  } finally {
    await teardown();
  }
});
