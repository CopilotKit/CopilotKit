import type { Skin } from "./skin-contract";
import banking from "@/skins/banking/skin";
import airline from "@/skins/airline/skin";
import logistics from "@/skins/logistics/skin";
import keel from "@/skins/keel/skin";
import people from "@/skins/people/skin";
import commerce from "@/skins/commerce/skin";

export { defaultSkinId } from "./skins-config";

// Client-side skin registry. Each skin's server-side agent factory is
// registered separately in agent-registry.ts under the SAME id (=== agentId).
export const SkinRegistry: Record<string, Skin> = {
  [banking.id]: banking,
  [airline.id]: airline,
  [logistics.id]: logistics,
  [keel.id]: keel,
  [people.id]: people,
  [commerce.id]: commerce,
};

export function getSkin(id: string | undefined): Skin | null {
  if (!id) return null;
  return SkinRegistry[id] ?? null;
}

export const allSkins = (): Skin[] => Object.values(SkinRegistry);
