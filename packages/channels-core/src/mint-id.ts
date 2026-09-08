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
