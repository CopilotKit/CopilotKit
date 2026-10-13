import * as store from "@/skins/ledgerline/data/store";

export const dynamic = "force-dynamic";
export const GET = () =>
  Response.json(store.snapshot(), { headers: { "cache-control": "no-store" } });
