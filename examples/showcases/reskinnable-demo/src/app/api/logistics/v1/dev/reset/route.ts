import * as store from "@/skins/logistics/data/store";

/** Dev-only: re-seed the store so the over-authority scenario can be re-run
 *  without restarting the server. */
export const POST = async () => {
  if (process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "FORBIDDEN", message: "Not available in production." },
      { status: 403 },
    );
  }
  store.reset();
  return Response.json({ ok: true });
};
