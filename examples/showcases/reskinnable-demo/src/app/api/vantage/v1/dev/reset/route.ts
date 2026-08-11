import * as store from "@/skins/vantage/data/store";
import { presenterResetEnabled } from "@/lib/presenter";

/**
 * Presenter/dev reset: restore the seeded scenario so the demo can be re-run
 * without restarting the server. Mirrors logistics' gate — allowed when a booth
 * deployment has explicitly enabled reset, OR in any non-production environment.
 *
 * Phase 2 extends this to wipe learned memories and re-seed beats 4 and 5 while
 * leaving beat 6 unlearned.
 */
export const POST = async () => {
  if (!presenterResetEnabled() && process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "FORBIDDEN", message: "Not available in production." },
      { status: 403 },
    );
  }
  store.reset();
  return Response.json({ ok: true });
};
