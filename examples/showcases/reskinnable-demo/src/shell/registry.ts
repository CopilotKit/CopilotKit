import type { Skin } from "./skin-contract";
import banking from "@/skins/banking/skin";
import airline from "@/skins/airline/skin";
import logistics from "@/skins/logistics/skin";
import keel from "@/skins/keel/skin";
import people from "@/skins/people/skin";
import commerce from "@/skins/commerce/skin";
import bookstore from "@/skins/bookstore/skin";
import exec from "@/skins/exec/skin";

// Client-side skin registry. Each skin's server-side agent factory is
// registered separately in agent-registry.ts under the SAME id (=== agentId).
export const SkinRegistry: Record<string, Skin> = {
  [banking.id]: banking,
  [airline.id]: airline,
  [logistics.id]: logistics,
  [keel.id]: keel,
  [people.id]: people,
  [commerce.id]: commerce,
  [bookstore.id]: bookstore,
  [exec.id]: exec,
};

/**
 * Resolve a skin by id. The only caller is `src/app/[skin]/layout.tsx`, which
 * passes the `[skin]` dynamic URL SEGMENT — so `id` is attacker-chosen and this
 * lookup must never leave the registry's own keys.
 *
 * `Object.hasOwn` rather than a bare `SkinRegistry[id]`: a plain-object index
 * walks the prototype chain, so `/constructor`, `/toString`, `/valueOf`,
 * `/hasOwnProperty`, `/__proto__` … all return a truthy INHERITED member. That
 * sails past the layout's `if (!skin) notFound()` and then throws on
 * `skin.identity.favicon` — a 500 with a stack trace where Next's own 404
 * belongs. Same hazard, same reasoning as the `Map` lookups in every skin's
 * `intelligence/user-id.ts` (see `src/skins/exec/intelligence/user-id.ts` for
 * the long-form rationale); a `Map` here would cost the object literal above its
 * readability, and the own-key check buys the same guarantee.
 *
 * `Record<string, Skin>` cannot catch this: the annotation is a claim about the
 * object's own entries, not about what indexing it returns. `registry.test.ts`
 * pins the behaviour.
 */
export function getSkin(id: string | undefined): Skin | null {
  if (!id || !Object.hasOwn(SkinRegistry, id)) return null;
  return SkinRegistry[id];
}

export const allSkins = (): Skin[] => Object.values(SkinRegistry);
