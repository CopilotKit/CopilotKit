import type { IngressSink } from "@copilotkit/bot";
import type { PlatformUser } from "@copilotkit/bot-ui";
import type { ChangeValue, ReplyTarget } from "./types.js";
import type { HistoryStore } from "./history-store.js";
import type { WhatsAppClient } from "./client.js";
import type { FileDeliveryConfig, WhatsAppMediaRef } from "./download-files.js";
import { buildFileContentParts, type AgentContentPart } from "./download-files.js";
import { conversationKeyOf, decodeInteraction } from "./interaction.js";

export interface WebhookListenerArgs {
  sink: IngressSink;
  history: HistoryStore;
  phoneNumberId: string;
  commandPrefix: string;
  client: Pick<WhatsAppClient, "downloadMedia">;
  files: FileDeliveryConfig;
}

const MEDIA_TYPES = ["image", "audio", "video", "document"] as const;

/** Process one webhook `value` object: classify each message and emit to the sink. */
export async function handleWebhookValue(value: ChangeValue, args: WebhookListenerArgs): Promise<void> {
  if (!value.messages || value.messages.length === 0) return; // statuses-only or empty

  const nameByWaId = new Map<string, string>();
  for (const c of value.contacts ?? []) {
    if (c.wa_id && c.profile?.name) nameByWaId.set(c.wa_id, c.profile.name);
  }

  for (const msg of value.messages) {
    const replyTarget: ReplyTarget = { to: msg.from, phoneNumberId: args.phoneNumberId };
    const user: PlatformUser = { id: msg.from };
    const name = nameByWaId.get(msg.from);
    if (name) user.name = name;

    // 1. Interactive reply → interaction.
    if (msg.type === "interactive") {
      const evt = decodeInteraction(msg, replyTarget);
      if (evt) {
        if (name) evt.user = { id: msg.from, name };
        await args.sink.onInteraction(evt);
      }
      continue;
    }

    // 2. Text → command or turn.
    if (msg.type === "text" && msg.text?.body) {
      const body = msg.text.body;
      const conversationKey = conversationKeyOf(msg.from);
      if (body.startsWith(args.commandPrefix)) {
        const rest = body.slice(args.commandPrefix.length);
        const space = rest.indexOf(" ");
        const command = space === -1 ? rest : rest.slice(0, space);
        const text = space === -1 ? "" : rest.slice(space + 1).trim();
        // Unlike a normal turn, a slash command's text is NOT persisted to history here.
        // The command handler injects it via thread.runAgent({ prompt }) — the engine's
        // designated path for input that isn't in the adapter's replayed history (mirrors
        // bot-slack, where slash args never appear in channel history). Persisting it here
        // too would double it in the agent's context.
        await args.sink.onCommand({ command, text, conversationKey, replyTarget, user, platform: "whatsapp" });
        continue;
      }
      await args.history.append(conversationKey, { role: "user", content: body, ts: msg.timestamp ?? msg.id });
      await args.sink.onTurn({ conversationKey, replyTarget, userText: body, user, platform: "whatsapp" });
      continue;
    }

    // 3. Media → turn with multimodal content stored in history.
    if (MEDIA_TYPES.includes(msg.type as (typeof MEDIA_TYPES)[number])) {
      const conversationKey = conversationKeyOf(msg.from);
      const mediaObj = (msg as unknown as Record<string, WhatsAppMediaRef>)[msg.type];
      const caption = (mediaObj as unknown as { caption?: string })?.caption ?? "";
      const { parts, notes } = await buildFileContentParts(
        mediaObj ? [mediaObj] : [],
        args.client,
        args.files,
      );
      const content: AgentContentPart[] = [];
      if (caption) content.push({ type: "text", text: caption });
      content.push(...parts);
      if (notes.length > 0) content.push({ type: "text", text: `[attachment notes: ${notes.join("; ")}]` });
      if (content.length === 0) continue;
      await args.history.append(conversationKey, { role: "user", content, ts: msg.timestamp ?? msg.id });
      await args.sink.onTurn({
        conversationKey,
        replyTarget,
        userText: caption,
        user,
        platform: "whatsapp",
      });
      continue;
    }

    // Unknown type → ignore.
  }
}
