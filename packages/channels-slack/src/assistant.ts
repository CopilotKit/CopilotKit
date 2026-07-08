/**
 * Slack assistant-pane wiring — the SOLE owner of pane (`assistant_thread_*`)
 * events. Bridges Bolt's `Assistant` middleware to the engine `IngressSink`.
 *
 * Flow:
 *   - `assistant_thread_started` → apply the adapter's STATIC defaults first
 *     (greeting + suggested prompts), then emit `sink.onThreadStarted` so
 *     `bot.onThreadStarted` handlers layer on top (never race the defaults).
 *     Records the pane thread so the message listener's guard can skip it.
 *   - a user message in the pane → exactly ONE `sink.onTurn`, scoped to the
 *     pane thread's `ts` (`channelId::threadTs`, NOT the flat DM scope), with a
 *     threaded reply target carrying `recipientUserId` (native streaming needs
 *     it). First message + `title: "auto"` → `assistant.threads.setTitle`.
 *   - `assistant_thread_context_changed` → persisted via Bolt's default
 *     thread-context store (stored for a later release; not yet fed to the agent).
 *
 * Pane messages arrive as threaded `message.im` events, which the ordinary
 * `app.message` listener also sees; `attachSlackListener` is given the
 * `isAssistantThread` predicate returned here so each pane message becomes
 * exactly one turn (see slack-listener.ts).
 */
import { Assistant } from "@slack/bolt";
import type { App } from "@slack/bolt";
import type { IngressSink, PlatformUser } from "@copilotkit/channels";
import { conversationKeyOf } from "./interaction.js";
import type { SlackAssistantOptions } from "./types.js";

export interface AttachAssistantConfig {
  app: App;
  /** The engine sink — pane events are delivered straight to it. */
  sink: IngressSink;
  /** Static pane behavior (greeting / prompts / title). */
  opts: SlackAssistantOptions;
  /** Resolve a Slack user id to a richer PlatformUser (adapter-owned, cached). */
  resolveUser: (userId: string) => Promise<PlatformUser>;
}

export interface AssistantHandle {
  /** True if `(channel, threadTs)` is a known assistant-pane thread. */
  isAssistantThread: (channel: string, threadTs: string) => boolean;
}

/** Register the Bolt `Assistant` middleware and bridge it to the engine sink. */
export function attachAssistant(cfg: AttachAssistantConfig): AssistantHandle {
  const { app, sink, opts, resolveUser } = cfg;

  // Pane threads seen this process (channelId::threadTs). Populated on
  // thread_started and (defensively, after a restart) on the first message.
  const assistantThreads = new Set<string>();
  // Threads we've already auto-titled, so only the FIRST user message titles.
  const titled = new Set<string>();

  const titleAuto = opts.title !== false; // default "auto"

  const assistant = new Assistant({
    threadStarted: async ({ event, say, setSuggestedPrompts }) => {
      const at = (event as { assistant_thread?: AssistantThreadMeta })
        .assistant_thread;
      if (!at?.channel_id || !at.thread_ts) return;
      const channelId = at.channel_id;
      const threadTs = at.thread_ts;
      assistantThreads.add(threadKey(channelId, threadTs));

      // ── Static defaults first (greeting + prompts). Degrade, never throw. ──
      if (opts.greeting) {
        try {
          await say(opts.greeting);
        } catch (err) {
          console.error("[slack-assistant] greeting failed:", err);
        }
      }
      if (opts.suggestedPrompts && opts.suggestedPrompts.length > 0) {
        try {
          await setSuggestedPrompts({
            prompts: opts.suggestedPrompts.map((p) => ({
              title: p.title,
              message: p.message,
            })) as [
              { title: string; message: string },
              ...{ title: string; message: string }[],
            ],
          });
        } catch (err) {
          console.error("[slack-assistant] setSuggestedPrompts failed:", err);
        }
      }

      // ── Then hand off to the engine (onThreadStarted handlers layer on top). ──
      const user = at.user_id ? await resolveUser(at.user_id) : undefined;
      await sink.onThreadStarted({
        conversationKey: conversationKeyOf({ channelId, scope: threadTs }),
        replyTarget: {
          channel: channelId,
          threadTs,
          recipientUserId: at.user_id,
        },
        user,
        platform: "slack",
      });
    },

    userMessage: async ({ message, setTitle }) => {
      const m = message as {
        channel?: string;
        thread_ts?: string;
        text?: string;
        user?: string;
      };
      // Pane messages are always threaded; ignore anything without a thread.
      if (!m.channel || !m.thread_ts) return;
      const channelId = m.channel;
      const threadTs = m.thread_ts;
      const key = conversationKeyOf({ channelId, scope: threadTs });
      assistantThreads.add(threadKey(channelId, threadTs)); // defensive (post-restart)

      const text = (m.text ?? "").trim();

      // Auto-title from the first user message.
      if (titleAuto && !titled.has(key)) {
        titled.add(key);
        const title = text.replace(/\s+/g, " ").slice(0, 80);
        if (title) {
          try {
            await setTitle(title);
          } catch (err) {
            console.error("[slack-assistant] setTitle failed:", err);
          }
        }
      }

      await sink.onTurn({
        conversationKey: key,
        replyTarget: { channel: channelId, threadTs, recipientUserId: m.user },
        userText: text,
        user: m.user ? await resolveUser(m.user) : undefined,
        platform: "slack",
      });
    },

    threadContextChanged: async ({ saveThreadContext }) => {
      // Persist via Bolt's default thread-context store. Stored for a later
      // release; not yet consumed by the agent.
      try {
        await saveThreadContext();
      } catch (err) {
        console.error("[slack-assistant] saveThreadContext failed:", err);
      }
    },
  });

  app.assistant(assistant);

  return {
    isAssistantThread: (channel, threadTs) =>
      assistantThreads.has(threadKey(channel, threadTs)),
  };
}

interface AssistantThreadMeta {
  user_id?: string;
  channel_id?: string;
  thread_ts?: string;
  context?: Record<string, unknown>;
}

const threadKey = (channel: string, threadTs: string): string =>
  `${channel}::${threadTs}`;
