import * as store from "@/skins/airline/data/store";

/**
 * The whole traveler profile in one read.
 *
 * One snapshot rather than an endpoint per collection, for the reason commerce
 * and people both landed on: almost every surface here is cross-cutting — the
 * trip wall needs bookings AND flights AND travelers, the rebooking search needs
 * options AND the booking they belong to — so N endpoints would mean N fetches,
 * N loading states, and N chances for two panels on the same screen to disagree
 * about what the data is. That matters more than usual here because beat 3b asks
 * the agent to describe exactly what the user can see.
 *
 * ⚠️ `store.snapshot()` STRIPS `waiverGround` from every booking. That field is
 * a code-shaped token mapping one-to-one onto beat 6's withheld catalogue, so
 * publishing it here would hand the agent half the answer through the ledger
 * readable. The passenger reads the same fact as prose in `fareNotes`.
 */
export const GET = async () => Response.json(store.snapshot());
