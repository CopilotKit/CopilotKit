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
  // A missing — OR present-but-empty/whitespace-only — `value` parameter means
  // the button carried no value: surface it as `undefined`, never as `""`
  // (a value-less button must not surface as `value === ""`).
  //
  // Coercion invariant: this package's own renderer JSON.stringifies button
  // values, so a string round-trips back to the same string here. We attempt
  // `JSON.parse` to recover structured values (objects/arrays/numbers/bools).
  // A consequence is that externally-authored payloads whose raw `value` looks
  // like a number/boolean (e.g. "42", "true") will be coerced to that type;
  // this is intentional and acceptable.
  const rawValue = params.find((p) => p.key === "value")?.value;
  let value: unknown;
  if (rawValue === undefined || rawValue.trim() === "") {
    value = undefined;
  } else {
    try { value = JSON.parse(rawValue); } catch { value = rawValue; }
  }

  const user = body.user?.name
    ? { id: body.user.name, name: body.user.displayName }
    : undefined;

  const messageName = body.message?.name;
  const messageRef = messageName ? { id: messageName, space: spaceId } : undefined;

  return { id, conversationKey, replyTarget, value, user, messageRef };
}
