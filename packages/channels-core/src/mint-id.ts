import { createHash, randomBytes } from "node:crypto";

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

/**
 * Content-derived id. Deterministic, so it is NOT used for action ids (an id
 * minted from content collides across conversations); see {@link mintActionId}.
 */
export function mintId(
  componentName: string,
  path: (string | number)[],
  props: unknown,
): string {
  const h = createHash("sha1")
    .update(`${componentName}|${path.join(".")}|${stableStringify(props)}`)
    .digest("hex");
  return "ck:" + h.slice(0, 16);
}

/**
 * Mint an unguessable action id for one rendered control (handlers,
 * continuations and awaitChoice controls alike): `ck:` plus 128 random bits
 * (base64url, 25 chars total). Ids are opaque capabilities; their conversation
 * scope is recorded with the binding and checked on dispatch. Renderers that
 * pack a value next to the id share the platform's cap with it (Discord
 * `<id>;v:<json>` in 100 chars, WhatsApp `<id>::<json>` in 256), so the id's
 * 25 chars come out of the room left for the value.
 */
export function mintActionId(): string {
  return "ck:" + randomBytes(16).toString("base64url");
}

/**
 * Whether `id` is one the registry minted (the `ck:` prefix of
 * {@link mintActionId}, and of the legacy {@link mintId}). Any other id a
 * platform delivers is a renderer's fallback for a control that never had an
 * action of its own (a link button, a button without a handler).
 */
export function isMintedActionId(id: string): boolean {
  return id.startsWith("ck:");
}
