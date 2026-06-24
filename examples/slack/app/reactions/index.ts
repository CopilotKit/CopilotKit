/**
 * Reaction demo — "emoji triage". A teammate reacts to any message to act on
 * it without typing: 🐛 file it as a bug, 🔥 escalate it, ✅ mark it triaged.
 * The bot acks with reactions of its own — 👀 when it picks the work up, ✅
 * when it's done — so progress shows without chat noise.
 *
 * Cross-platform: reactions work on Slack, Discord, and Telegram alike. The
 * emoji are canonical names from @copilotkit/bot-ui's table, so 🐛/🔥/✅ match
 * whether the platform delivers an alias (Slack) or the unicode glyph (Discord/
 * Telegram). `thread.react` is capability-gated — on a surface without
 * reactions it returns `{ ok: false }` and we simply skip the ack.
 */
import type { ReactionHandler } from "@copilotkit/bot";
import { senderContext } from "../sender-context.js";

// Map a reaction to the triage intent it runs. The run is rooted at the reacted
// message, so the prompt only has to say WHAT to do, not restate the message.
// Reacting to a top-level message or a thread root sees the whole thread;
// reacting to a deep reply sees that reply onward (Slack's reaction event
// carries no parent thread_ts, so the reacted message is treated as the root).
const INTENTS: Record<string, string> = {
  bug: "A teammate reacted 🐛 to a message in this thread to file it as a bug. Read the thread, then propose and (after the usual confirm) file a Linear bug issue capturing it.",
  fire: "A teammate reacted 🔥 to escalate a message in this thread. Read the thread, then triage it as urgent: summarize the problem and propose a high-priority Linear issue.",
  check:
    "A teammate reacted ✅ to mark a message in this thread as triaged. Acknowledge briefly and note it as handled.",
};

export const emojiTriage: ReactionHandler = async (evt) => {
  if (!evt.added) return; // act on add, not removal
  const prompt = INTENTS[evt.emoji];
  if (!prompt) return; // not one of our triage emoji

  // The reacted message's ref: its id is the platform message id (Slack ts),
  // and the channel is supplied by the thread's reply target.
  const reacted = { id: evt.messageId };

  // React acks are best-effort: this handler must never throw (the "degrade,
  // never throw" contract), so a rejecting `react` (e.g. Telegram's restricted
  // reaction set, or a transient API error) is swallowed rather than escaping.
  await evt.thread.react(reacted, "eyes").catch(() => {}); // 👀 picked it up
  try {
    await evt.thread.runAgent({
      prompt,
      context: senderContext(evt.user, evt.thread.platform),
    });
    // ✅ means "finished this turn" — for 🐛/🔥 the agent only PROPOSES an
    // issue; filing is gated behind the confirm_write HITL step. The ✅ is a
    // progress ack, not a "filed" confirmation.
    await evt.thread.react(reacted, "check").catch(() => {}); // ✅ turn complete
  } catch (err) {
    console.error("[bot] emoji-triage run failed", err);
    await evt.thread.react(reacted, "warning").catch(() => {}); // ⚠️ surfaced, not silent
  }
};
