import type { InteractionEvent } from "@copilotkit/bot";
import { DM_SCOPE, conversationKeyOf, type ReplyTarget } from "./types.js";

export function decodeInteraction(raw: unknown): InteractionEvent | undefined {
  const body = raw as {
    type?: string;
    space?: { name?: string; type?: string };
    message?: { name?: string; thread?: { name?: string } };
    user?: { name?: string; displayName?: string };
    common?: { invokedFunction?: string; parameters?: Array<{ key?: string; value?: string }> };
    action?: { actionMethodName?: string; parameters?: Array<{ key?: string; value?: string }> };
  };
  if (body.type !== "CARD_CLICKED") return undefined;

  const spaceId = body.space?.name;
  if (!spaceId) return undefined;

  const id = body.common?.invokedFunction ?? body.action?.actionMethodName;
  if (!id) return undefined;

  const isDm = body.space?.type === "DM";
  const threadName = body.message?.thread?.name;
  const scope = isDm ? DM_SCOPE : (threadName ?? "");
  const conversationKey = conversationKeyOf({ spaceId, scope });
  const replyTarget: ReplyTarget = { space: spaceId, thread: isDm ? undefined : threadName };

  const params = body.common?.parameters ?? body.action?.parameters ?? [];
  const rawValue = params.find((p) => p.key === "value")?.value ?? params[0]?.value;
  let value: unknown = rawValue;
  if (typeof rawValue === "string") {
    try { value = JSON.parse(rawValue); } catch { value = rawValue; }
  }

  const user = body.user?.name
    ? { id: body.user.name, name: body.user.displayName }
    : undefined;

  const messageName = body.message?.name;
  const messageRef = messageName ? { id: messageName, space: spaceId } : undefined;

  return { id, conversationKey, replyTarget, value, user, messageRef };
}
