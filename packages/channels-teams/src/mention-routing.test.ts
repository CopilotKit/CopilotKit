import { once } from "node:events";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "@copilotkit/channels-core";
import { ActivityTypes } from "@microsoft/agents-activity";
import type { Activity, Mention } from "@microsoft/agents-activity";
import { TeamsAdapter } from "./adapter.js";

type ReceivedMessage = {
  handler: "mention" | "message";
  text: string;
  mentioned: boolean;
};
type HandlerMode = "mention" | "message" | "both" | "none";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a local TCP listener");
  }
  return address.port;
}

async function close(server: Server) {
  const closed = once(server, "close");
  server.close();
  await closed;
}

async function localChannel(mode: HandlerMode) {
  // The SDK sends typing activities through its real local Connector client.
  const connector = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: "local-typing" }));
  });
  const connectorPort = await listen(connector);
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const channel = createChannel({
    name: "teams-mention-routing",
    identifyUser: "platform",
    adapters: [new TeamsAdapter({ port })],
  });
  const received: ReceivedMessage[] = [];
  if (mode === "mention" || mode === "both") {
    channel.onMention(({ message }) => {
      received.push({
        handler: "mention",
        text: message.text,
        mentioned: message.operation.mentioned,
      });
    });
  }
  if (mode === "message" || mode === "both") {
    channel.onMessage(({ message }) => {
      received.push({
        handler: "message",
        text: message.text,
        mentioned: message.operation.mentioned,
      });
    });
  }
  return {
    channel,
    received,
    async post(overrides: Partial<Activity> = {}) {
      const response = await fetch(`http://127.0.0.1:${port}/api/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: ActivityTypes.Message,
          id: "local-message",
          text: "<at>Support Bot</at> hello",
          channelId: "msteams",
          serviceUrl: `http://127.0.0.1:${connectorPort}`,
          conversation: { id: "local-channel", conversationType: "channel" },
          from: { id: "local-user", name: "Local User", role: "user" },
          recipient: { id: "local-bot", name: "Support Bot", role: "bot" },
          entities: [mention()],
          ...overrides,
        }),
      });
      const body = await response.text();
      console.log(
        JSON.stringify({ mode, httpStatus: response.status, received }),
      );
      expect(response.status, body).toBe(200);
    },
    async stop() {
      await channel.ɵruntime.stop();
      await close(connector);
    },
  };
}

function mention(id = "local-bot", name = "Support Bot") {
  return {
    type: "mention",
    text: `<at>${name}</at>`,
    mentioned: { id, name },
  } satisfies Mention;
}

async function receive(mode: HandlerMode, overrides: Partial<Activity> = {}) {
  const fixture = await localChannel(mode);
  try {
    await fixture.channel.ɵruntime.start();
    await fixture.post(overrides);
    return fixture.received;
  } finally {
    await fixture.stop();
  }
}

describe("Teams real HTTP mention routing", () => {
  // Anonymous mode matches the M365 Agents Playground; no provider auth mocks.
  beforeEach(() => {
    vi.stubEnv("clientId", "");
    vi.stubEnv("clientSecret", "");
    vi.stubEnv("tenantId", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("delivers a recipient mention to an onMention-only channel", async () => {
    expect(await receive("mention")).toEqual([
      { handler: "mention", text: "hello", mentioned: true },
    ]);
  });

  it("falls back to onMessage while retaining the mention classification", async () => {
    expect(await receive("message")).toEqual([
      { handler: "message", text: "hello", mentioned: true },
    ]);
  });

  it("prioritizes onMention when both handlers are registered", async () => {
    expect(await receive("both")).toEqual([
      { handler: "mention", text: "hello", mentioned: true },
    ]);
  });

  it("keeps another user's mention as an ordinary message", async () => {
    expect(
      await receive("both", {
        text: "<at>Support Bot</at> hello",
        entities: [mention("another-user")],
      }),
    ).toEqual([
      {
        handler: "message",
        text: "<at>Support Bot</at> hello",
        mentioned: false,
      },
    ]);
  });

  it("does not infer a recipient mention from text markup alone", async () => {
    expect(await receive("both", { entities: [] })).toEqual([
      {
        handler: "message",
        text: "<at>Support Bot</at> hello",
        mentioned: false,
      },
    ]);
  });

  it("keeps a personal-chat message without a mention on onMessage", async () => {
    expect(
      await receive("both", {
        text: "hello",
        entities: [],
        conversation: { id: "local-personal", conversationType: "personal" },
      }),
    ).toEqual([{ handler: "message", text: "hello", mentioned: false }]);
  });

  it("rejects activation without either message handler before binding ingress", async () => {
    const fixture = await localChannel("none");
    try {
      await expect(fixture.channel.ɵruntime.start()).rejects.toThrow(
        "must register onMention or onMessage before activation",
      );
    } finally {
      await fixture.stop();
    }
  });
});
