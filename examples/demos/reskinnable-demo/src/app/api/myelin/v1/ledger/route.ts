import * as store from "@/skins/myelin/data/store";

/** The whole ledger in one read — pages, tools, presence and the agent share it. */
export const dynamic = "force-dynamic";
export const GET = async () => Response.json(store.snapshot());
