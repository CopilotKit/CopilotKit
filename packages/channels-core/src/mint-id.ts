import { createHash } from "node:crypto";

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
 * Derive a content-addressed action id from the component that owns the
 * handler, its path in the rendered tree, and the props it was rendered with.
 *
 * `componentName` must be the component's *durable* identity — what
 * `resolveComponentName` returns, not a raw `fn.name`. The id is persisted in
 * the action snapshot and re-resolved on a cold dispatch, so feeding it a
 * minifiable name means already-posted buttons stop resolving after a deploy
 * that mangles it differently.
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
