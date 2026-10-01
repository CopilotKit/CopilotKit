import * as store from "@/skins/ledgerline/data/store";

export const dynamic = "force-dynamic";
export const GET = () =>
  Response.json(
    { version: store.version() },
    { headers: { "cache-control": "no-store" } },
  );
