import * as store from "@/skins/ledgerline/data/store";
import { presenterResetEnabled } from "@/lib/presenter";

/** Presenter reset: restore the seeded expense ledger. */
export const POST = async () => {
  if (!presenterResetEnabled() && process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "FORBIDDEN", message: "Not available in production." },
      { status: 403 },
    );
  }
  store.reset();
  return Response.json({ ok: true, reset: ["store"] });
};
