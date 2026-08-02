import type { ComponentFn } from "./ir.js";

/**
 * Resolve the durable registry identity of a component function.
 *
 * Prefers an explicit `displayName` over `Function.prototype.name`, because
 * `fn.name` is a *build artifact*: a bundler that mangles names gives the same
 * component a different identity in every deploy. Since the identity is baked
 * into every minted action id and persisted in the action snapshot, a mangled
 * rename makes buttons posted by one deploy undispatchable by the next — the
 * cold-path lookup misses, the click is swallowed, and nothing happens.
 *
 * Returns `undefined` when neither a `displayName` nor a `fn.name` is usable,
 * so callers decide how to degrade.
 */
export function resolveComponentName(fn: unknown): string | undefined {
  if (typeof fn !== "function") return undefined;
  const pinned = (fn as { displayName?: unknown }).displayName;
  if (typeof pinned === "string" && pinned.length > 0) return pinned;
  return fn.name || undefined;
}

/**
 * Pin a component's durable identity so minification can't break it.
 *
 * Sets `displayName`, which {@link resolveComponentName} prefers over the
 * minifiable `fn.name`. Use it for any component passed to
 * `createChannel({ components })` or posted with a handler that must survive a
 * restart:
 *
 * ```tsx
 * const ApprovalCard = defineChannelComponent(
 *   "ApprovalCard",
 *   ({ summary }: { summary: string }) => (
 *     <Message>
 *       <Section>{summary}</Section>
 *       <Actions>
 *         <Button value="approve" onClick={approve}>Approve</Button>
 *       </Actions>
 *     </Message>
 *   ),
 * );
 * ```
 *
 * Note: pinning a name on a component that is *already* live changes the ids it
 * mints, so actions posted before the change stop resolving. Ship it with a
 * release note, or accept that in-flight cards go stale once.
 */
export function defineChannelComponent<
  TFn extends (props: never) => ReturnType<ComponentFn>,
>(name: string, fn: TFn): TFn & { displayName: string } {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      "defineChannelComponent: `name` must be a non-empty string — it is the component's durable identity.",
    );
  }
  return Object.assign(fn, { displayName: name });
}
