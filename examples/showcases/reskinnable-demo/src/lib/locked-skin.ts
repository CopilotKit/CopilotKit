import { skinIds } from "@/shell/skins-config";

/**
 * Single-tenant deploy gate. Unset (default) = the normal multi-skin demo: every
 * skin reachable, switcher visible. Set to a skin id and the routing and UI
 * expose only that skin — `/` lands there, every other segment 404s, and the
 * selector card's dropdown collapses to a static brand badge.
 *
 * This is a presentation/deploy gate, NOT a security boundary: every skin's
 * agent stays registered server-side, so another skin's agent endpoint remains
 * reachable under a lock.
 *
 * A per-deploy SERVER env (deliberately non-NEXT_PUBLIC_, like
 * PRESENTER_RESET_ENABLED) so one build serves both a locked single-tenant host
 * and the unlocked four-skin demo. Threaded to client chrome as a prop in
 * `src/app/layout.tsx` → `LockedSkinProvider`.
 *
 * NOTE: this does NOT pin dark/light. That is a separate axis (localStorage +
 * `--nw-dark-capable` reconciliation in `src/hooks/use-theme.ts`).
 *
 * Throws on an unrecognised id. A typo would otherwise 404 every skin AND send
 * `/` to a 404 — the whole app dark, with nothing pointing at the cause.
 */
export function lockedSkinId(): string | null {
  const raw = process.env.LOCK_SKIN?.trim();
  if (!raw) return null;
  if (!(skinIds as readonly string[]).includes(raw)) {
    throw new Error(
      `LOCK_SKIN="${raw}" is not a registered skin. Valid ids: ${skinIds.join(", ")}. ` +
        `Unset LOCK_SKIN to run the normal multi-skin demo.`,
    );
  }
  return raw;
}
