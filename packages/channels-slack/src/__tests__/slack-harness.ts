import { vi } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { EMPTY } from "rxjs";
import type { Observable } from "rxjs";
import { createChannel } from "@copilotkit/channels-core";
import type { Channel } from "@copilotkit/channels-core";
import type { SlackRespondToOptions } from "../types.js";

/**
 * Test harness: a channel on the REAL Slack adapter, with Bolt and the Web API
 * client faked at their edges. Ingress is fired with Slack-shaped payloads, so
 * the adapter's own listener, renderer and decoders run end to end.
 */

class NoopAgent extends AbstractAgent {
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }
}

export const BOT_USER_ID = "UBOT0001";

type Handler = (args: Record<string, unknown>) => unknown;

/** A fake Bolt app that records every listener the adapter attaches. */
function makeFakeApp() {
  const events: Record<string, Handler> = {};
  let command: Handler | undefined;
  let message: Handler | undefined;
  let action: Handler | undefined;
  const app = {
    init: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    event(name: string, handler: Handler) {
      events[name] = handler;
    },
    message(handler: Handler) {
      message = handler;
    },
    action(_matcher: unknown, handler: Handler) {
      action = handler;
    },
    command(_matcher: unknown, handler: Handler) {
      command = handler;
    },
    view() {},
    assistant() {},
    use() {},
  };
  return {
    app,
    command: (args: Record<string, unknown>) => command!(args),
    event: (name: string, args: Record<string, unknown>) => events[name]!(args),
    message: (args: Record<string, unknown>) => message!(args),
    action: (args: Record<string, unknown>) => action!(args),
  };
}

/** One Block Kit element of a posted message, with the block it sits in. */
export interface PostedElement {
  type: string;
  action_id: string;
  value?: string;
  block_id?: string;
  options?: Array<{ value: string }>;
}

/** Every interactive element (button, select, input element) in `blocks`. */
export function interactiveElements(blocks: unknown): PostedElement[] {
  const out: PostedElement[] = [];
  const visit = (value: unknown, blockId?: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, blockId);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const el = value as Record<string, unknown>;
    const ownBlockId = typeof el.block_id === "string" ? el.block_id : blockId;
    if (typeof el.action_id === "string" && typeof el.type === "string") {
      out.push({
        type: el.type,
        action_id: el.action_id,
        ...(typeof el.value === "string" ? { value: el.value } : {}),
        ...(ownBlockId ? { block_id: ownBlockId } : {}),
        ...(Array.isArray(el.options)
          ? { options: el.options as Array<{ value: string }> }
          : {}),
      });
    }
    for (const child of Object.values(el)) visit(child, ownBlockId);
  };
  visit(blocks);
  return out;
}

export interface PostedMessage {
  channel: string;
  threadTs?: string;
  ts: string;
  blocks: unknown;
  elements: PostedElement[];
}

export interface SlackHarness {
  channel: Channel;
  posts: PostedMessage[];
  /** Every `chat.update` call: the message it replaced and its new elements. */
  updates: Array<{ channel: string; ts: string; elements: PostedElement[] }>;
  /** Every `chat.postEphemeral` call: who it was for and its blocks. */
  ephemerals: Array<{ channel: string; user: string; blocks: unknown }>;
  /** Errors thrown by fired ingress handlers. */
  errors: unknown[];
  /** Fire a `/deploy` slash command from `user` in `channel`. */
  slash(opts: { channel: string; user: string; text?: string }): Promise<void>;
  /** Fire an `app_mention` from `user` in `channel` at `ts`. */
  mention(opts: { channel: string; user: string; ts: string }): Promise<void>;
  /** Fire a DM from `user` in DM channel `channel` at `ts`. */
  dm(opts: { channel: string; user: string; ts: string }): Promise<void>;
  /**
   * Record that someone posted `ts` as a reply in thread `threadTs`. Slack
   * posts a message whose `thread_ts` names a reply into that reply's thread.
   */
  reply(opts: { channel: string; threadTs: string; ts: string }): void;
  /** Fire a `reaction_added` by `user` on message `ts` in `channel`. */
  react(opts: {
    channel: string;
    user: string;
    ts: string;
    reaction?: string;
  }): Promise<void>;
  /**
   * Fire a `block_actions` click on `element` of `message` by `user`, shaped
   * like Slack's payload. `override` replaces fields of the action object (for
   * example a select's `selected_option`, or an input's typed `value`).
   */
  click(opts: {
    message: Pick<PostedMessage, "channel" | "threadTs" | "ts">;
    element: Pick<PostedElement, "type" | "action_id" | "value" | "block_id">;
    user: string;
    override?: Record<string, unknown>;
  }): Promise<void>;
}

const activeChannels: Channel[] = [];

/** Stop every channel started by {@link startSlackHarness}. */
export async function stopSlackHarnesses(): Promise<void> {
  while (activeChannels.length > 0) {
    await activeChannels.pop()!.ɵruntime.stop();
  }
}

/** Let fire-and-forget ingress settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

export async function startSlackHarness(opts: {
  respondTo?: SlackRespondToOptions;
  /** The agent each turn runs (default: one that does nothing). */
  agent?: () => AbstractAgent;
  setup: (channel: Channel) => void;
}): Promise<SlackHarness> {
  const { SlackAdapter } = await import("../adapter.js");
  const adapter = new SlackAdapter({
    botToken: "xoxb",
    appToken: "xapp",
    signingSecret: "s",
    assistant: false,
    ...(opts.respondTo ? { respondTo: opts.respondTo } : {}),
  });
  const fakeApp = makeFakeApp();
  (adapter as unknown as { app: unknown }).app = fakeApp.app;
  const posts: PostedMessage[] = [];
  const updates: SlackHarness["updates"] = [];
  // Thread root of every known reply, as Slack tracks it.
  const threadRoots = new Map<string, string>();
  const ephemerals: SlackHarness["ephemerals"] = [];
  let nextTs = 1000;
  const postMessage = vi.fn(
    async (args: { channel: string; thread_ts?: string; blocks?: unknown }) => {
      const ts = `${nextTs++}.0001`;
      // Slack files a reply to a reply under the thread's root.
      const root = args.thread_ts
        ? (threadRoots.get(args.thread_ts) ?? args.thread_ts)
        : undefined;
      if (root) threadRoots.set(ts, root);
      posts.push({
        channel: args.channel,
        ...(root ? { threadTs: root } : {}),
        ts,
        blocks: args.blocks,
        elements: interactiveElements(args.blocks),
      });
      return {
        ok: true,
        ts,
        message: { ts, ...(root ? { thread_ts: root } : {}) },
      };
    },
  );
  const client = {
    auth: {
      test: vi.fn().mockResolvedValue({ user_id: BOT_USER_ID, team_id: "T1" }),
    },
    chat: {
      postMessage,
      update: vi.fn(
        async (args: { channel: string; ts: string; blocks?: unknown }) => {
          updates.push({
            channel: args.channel,
            ts: args.ts,
            elements: interactiveElements(args.blocks),
          });
          return { ok: true, ts: args.ts };
        },
      ),
      postEphemeral: vi.fn(
        async (args: { channel: string; user: string; blocks?: unknown }) => {
          ephemerals.push({
            channel: args.channel,
            user: args.user,
            blocks: args.blocks,
          });
          return { ok: true, message_ts: `${nextTs++}.0001` };
        },
      ),
    },
    users: { info: vi.fn().mockResolvedValue({ user: { id: "U1" } }) },
  };
  (adapter as unknown as { client: unknown }).client = client;

  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: opts.agent ?? (() => new NoopAgent()),
  });
  opts.setup(channel);
  await channel.ɵruntime.start();
  activeChannels.push(channel);

  let clickSeq = 0;
  const errors: unknown[] = [];
  // Ingress is fired, not awaited: a serial turn stays open while its handler
  // awaits a choice, exactly as it does behind Bolt.
  const fire = (result: unknown): void => {
    void Promise.resolve(result).catch((err: unknown) => {
      errors.push(err);
    });
  };
  return {
    channel,
    posts,
    updates,
    ephemerals,
    errors,
    async slash({ channel: channelId, user, text }) {
      fire(
        fakeApp.command({
          ack: vi.fn().mockResolvedValue(undefined),
          client: {},
          command: {
            command: "/deploy",
            text: text ?? "",
            channel_id: channelId,
            user_id: user,
            trigger_id: `trigger-${++clickSeq}`,
          },
        }),
      );
      await settle();
    },
    async mention({ channel: channelId, user, ts }) {
      fire(
        fakeApp.event("app_mention", {
          event: {
            type: "app_mention",
            channel: channelId,
            user,
            text: `<@${BOT_USER_ID}> go`,
            ts,
          },
          body: { event_id: `Ev-${ts}` },
          client: {},
        }),
      );
      await settle();
    },
    async dm({ channel: channelId, user, ts }) {
      fire(
        fakeApp.message({
          message: {
            type: "message",
            channel: channelId,
            channel_type: "im",
            user,
            text: "go",
            ts,
          },
          body: { event_id: `Ev-${ts}` },
          client: {},
        }),
      );
      await settle();
    },
    reply({ threadTs, ts }) {
      threadRoots.set(ts, threadRoots.get(threadTs) ?? threadTs);
    },
    async react({ channel: channelId, user, ts, reaction }) {
      fire(
        fakeApp.event("reaction_added", {
          event: {
            type: "reaction_added",
            user,
            reaction: reaction ?? "eyes",
            item: { type: "message", channel: channelId, ts },
            event_ts: `${++clickSeq}.0002`,
          },
        }),
      );
      await settle();
    },
    async click({ message, element, user, override }) {
      const seq = ++clickSeq;
      fire(
        fakeApp.action({
          ack: vi.fn().mockResolvedValue(undefined),
          body: {
            type: "block_actions",
            api_app_id: "A1",
            team: { id: "T1" },
            trigger_id: `trigger-${seq}`,
            user: { id: user, name: user.toLowerCase() },
            channel: { id: message.channel },
            container: {
              type: "message",
              channel_id: message.channel,
              message_ts: message.ts,
              ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
            },
            message: {
              ts: message.ts,
              ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
            },
            actions: [
              {
                type: element.type,
                action_id: element.action_id,
                ...(element.block_id ? { block_id: element.block_id } : {}),
                ...(element.value !== undefined
                  ? { value: element.value }
                  : {}),
                action_ts: `${seq}.0001`,
                ...override,
              },
            ],
          },
        }),
      );
      await settle();
    },
  };
}
