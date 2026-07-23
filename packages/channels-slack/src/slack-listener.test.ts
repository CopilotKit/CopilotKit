import { describe, it, expect, vi } from "vitest";
import { attachSlackListener } from "./slack-listener.js";
import type { SlackCommand } from "./slack-listener.js";
import type { IncomingTurn } from "./types.js";
import type { App } from "@slack/bolt";

/**
 * Capture the Bolt handlers `attachSlackListener` registers, without a real
 * App. Each `app.command/event/message` records its handler so a test can
 * invoke it with a representative Slack payload and assert on the emitted
 * ingress object.
 */
function captureListener(): {
  turns: IncomingTurn[];
  commands: SlackCommand[];
  command: (args: unknown) => Promise<void>;
  mention: (args: unknown) => Promise<void>;
  message: (args: unknown) => Promise<void>;
} {
  let commandHandler: ((args: unknown) => Promise<void>) | undefined;
  let mentionHandler: ((args: unknown) => Promise<void>) | undefined;
  let messageHandler: ((args: unknown) => Promise<void>) | undefined;

  const app = {
    command: vi.fn((_m: unknown, h: (args: unknown) => Promise<void>) => {
      commandHandler = h;
    }),
    event: vi.fn((_name: string, h: (args: unknown) => Promise<void>) => {
      mentionHandler = h;
    }),
    message: vi.fn((h: (args: unknown) => Promise<void>) => {
      messageHandler = h;
    }),
  } as unknown as App;

  const turns: IncomingTurn[] = [];
  const commands: SlackCommand[] = [];

  attachSlackListener({
    app,
    botUserId: "UBOT",
    onTurn: (turn) => {
      turns.push(turn);
    },
    onCommand: (cmd) => {
      commands.push(cmd);
    },
  });

  return {
    turns,
    commands,
    command: (args) => commandHandler!(args),
    mention: (args) => mentionHandler!(args),
    message: (args) => messageHandler!(args),
  };
}

const client = {} as unknown;

describe("attachSlackListener eventId (inbound dedup)", () => {
  it("derives a turn eventId from the Events API envelope event_id for an app_mention", async () => {
    const l = captureListener();
    await l.mention({
      event: {
        channel: "C1",
        user: "U1",
        text: "<@UBOT> hi",
        ts: "100.0",
        client_msg_id: "cmid-1",
      },
      body: { event_id: "Ev123ABC" },
      client,
    });
    expect(l.turns).toHaveLength(1);
    // event_id wins over client_msg_id / ts.
    expect(l.turns[0]!.eventId).toBe("Ev123ABC");
  });

  it("falls back to client_msg_id then ${channel}:${ts} when no envelope event_id", async () => {
    const l = captureListener();
    // DM message with client_msg_id but no envelope event_id.
    await l.message({
      message: {
        channel: "D9",
        channel_type: "im",
        user: "U1",
        text: "hello",
        ts: "200.1",
        client_msg_id: "cmid-2",
      },
      body: {},
      client,
    });
    expect(l.turns).toHaveLength(1);
    expect(l.turns[0]!.eventId).toBe("cmid-2");

    // Without client_msg_id, falls back to channel:ts.
    const l2 = captureListener();
    await l2.message({
      message: {
        channel: "D9",
        channel_type: "im",
        user: "U1",
        text: "hello",
        ts: "200.2",
      },
      body: {},
      client,
    });
    expect(l2.turns[0]!.eventId).toBe("D9:200.2");
  });

  it("derives a stable command eventId from command:user:trigger_id", async () => {
    const l = captureListener();
    await l.command({
      command: {
        command: "/triage",
        text: "now",
        channel_id: "C1",
        user_id: "U1",
        trigger_id: "trig-9",
      },
      ack: vi.fn(async () => {}),
      client,
    });
    expect(l.commands).toHaveLength(1);
    expect(l.commands[0]!.eventId).toBe("/triage:U1:trig-9");
  });
});
