import type { UnserializableRef } from "./types";

export type RuntimeMode =
  | { kind: "embed" }
  | { kind: "proxy-unsupported"; url: string }
  | { kind: "proxy-unsupported-dynamic"; expressionSource: string };

/**
 * Classifies `<CopilotKit>`'s runtimeUrl into a runtime mode for Plan #3.
 *
 * - Relative paths, empty, null, undefined → "embed" (we spawn our own runtime).
 * - Absolute http(s) URLs → "proxy-unsupported" (Plan #3b will handle).
 * - Unserializable expressions (runtimeUrl={getRuntimeUrl()}) → can't statically
 *   classify; treat as proxy-unsupported-dynamic with the source preserved.
 */
export function detectMode(
  runtimeUrl:
    | string
    | null
    | undefined
    | UnserializableRef
    | unknown,
): RuntimeMode {
  if (runtimeUrl == null || runtimeUrl === "") return { kind: "embed" };
  if (typeof runtimeUrl === "object" && runtimeUrl !== null) {
    const maybe = runtimeUrl as { __unserializable?: unknown; source?: string };
    if (maybe.__unserializable === true) {
      return {
        kind: "proxy-unsupported-dynamic",
        expressionSource: typeof maybe.source === "string" ? maybe.source : "",
      };
    }
    return { kind: "embed" }; // unknown object — default to embed
  }
  if (typeof runtimeUrl !== "string") return { kind: "embed" };
  if (/^https?:\/\//i.test(runtimeUrl)) {
    return { kind: "proxy-unsupported", url: runtimeUrl };
  }
  return { kind: "embed" };
}
