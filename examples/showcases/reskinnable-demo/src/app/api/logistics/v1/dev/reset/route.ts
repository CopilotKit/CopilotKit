import * as store from "@/skins/logistics/data/store";
import { presenterResetEnabled } from "@/lib/presenter";

/** Dev-only: re-seed the store so the over-authority scenario can be re-run
 *  without restarting the server. */
export const POST = async () => {
  // Allowed when a presenter/booth deployment has explicitly enabled reset, OR
  // in any non-production environment (local dev + the unit tests). A production
  // deployment without the flag still refuses.
  if (!presenterResetEnabled() && process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "FORBIDDEN", message: "Not available in production." },
      { status: 403 },
    );
  }
  store.reset();
  return Response.json({ ok: true });
};
