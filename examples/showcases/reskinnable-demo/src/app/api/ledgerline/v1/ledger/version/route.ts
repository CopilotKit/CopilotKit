import * as store from "@/skins/ledgerline/data/store";
import { lastResetAt } from "@/skins/ledgerline/learning/service";

export const dynamic = "force-dynamic";
export const GET = () =>
  Response.json(
    { version: store.version(), resetAt: lastResetAt() },
    { headers: { "cache-control": "no-store" } },
  );
