import * as store from "@/skins/exec/data/store";
import { presenterResetEnabled } from "@/lib/presenter";

/**
 * Presenter/booth reset — put the exec skin's ledger back to the state the
 * demo starts from.
 *
 * Allowed when a booth deployment set PRESENTER_RESET_ENABLED, OR in any
 * non-production environment. Keeping this in agreement with the sidebar
 * button matters: gate it more tightly than the button and a production
 * booth shows a Reset control that 403s.
 */
export const POST = async () => {
  if (!presenterResetEnabled() && process.env.NODE_ENV === "production") {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  store.reset();

  // TODO(6.2): forget/reseed MEMORY here, mirroring people's route — wire in
  // once the exec skin has its own intelligence forget/seed helpers.

  return Response.json({ ok: true, reset: ["store"] });
};
