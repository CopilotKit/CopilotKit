"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * The single-tenant deploy gate, read SERVER-side in the root layout
 * (`lockedSkinId()` — a deliberately non-NEXT_PUBLIC_ env) and threaded to the
 * client through this tiny context. Mirrors `presenter-reset-context.tsx`.
 *
 * `null` means unlocked: every skin reachable, switcher visible. A skin id means
 * that skin is the only reachable one.
 *
 * The default is `null` so any subtree WITHOUT a provider behaves exactly as it
 * does today — `SelectorCard` is rendered bare in its own unit tests, and an
 * unlocked default is what keeps them meaningful.
 */
const LockedSkinContext = createContext<string | null>(null);

export function LockedSkinProvider({
  lockedSkinId,
  children,
}: {
  lockedSkinId: string | null;
  children: ReactNode;
}) {
  return (
    <LockedSkinContext.Provider value={lockedSkinId}>
      {children}
    </LockedSkinContext.Provider>
  );
}

export function useLockedSkin(): string | null {
  return useContext(LockedSkinContext);
}

/**
 * Whether this skin is unreachable on this deploy.
 *
 * A named predicate rather than an inline comparison because it is the one line
 * that can brick the app: with the condition inverted, an UNLOCKED deploy 404s
 * every skin. Pulling it out means it gets exhaustive unit tests without having
 * to render `SkinLayout` (whose pass-through case would mount CopilotKitProvider
 * and a live thread).
 *
 * The `lockedSkinId === null` short-circuit MUST come first.
 */
export function isSkinLockedOut(
  skinId: string,
  lockedSkinId: string | null,
): boolean {
  if (lockedSkinId === null) return false;
  return skinId !== lockedSkinId;
}
