import * as store from "@/skins/people/data/store";

/**
 * The whole ledger in one read.
 *
 * Banking exposes a granular endpoint per collection; Rowan deliberately does
 * not. Almost every surface here is cross-cutting — the ladder needs employees
 * AND bands, the roster needs employees AND requests AND tasks, and the agent's
 * readables need all of it — so N endpoints would mean N fetches, N loading
 * states, and N chances for two panels on the same screen to disagree about
 * what the data is. One snapshot keeps the page self-consistent, which matters
 * more than usual here because beat 3b asks the agent to describe exactly what
 * the user can see.
 */
export const GET = async () => Response.json(store.snapshot());
