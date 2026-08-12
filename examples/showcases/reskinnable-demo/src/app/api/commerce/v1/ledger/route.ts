import * as store from "@/skins/commerce/data/store";

/**
 * The whole ledger in one read.
 *
 * Banking exposes a granular endpoint per collection; Bellwether deliberately
 * does not. Almost every surface here is cross-cutting — the margin ladder needs
 * products AND floors, the orders page needs orders AND products, the promotions
 * table needs promotions AND products AND floors AND waivers, and the agent's
 * readables need all of it — so N endpoints would mean N fetches, N loading
 * states, and N chances for two panels on the same screen to disagree about what
 * the data is. One snapshot keeps the page self-consistent, which matters more
 * than usual here because beat 3b asks the agent to describe exactly what the
 * user can see.
 */
export const GET = async () => Response.json(store.snapshot());
