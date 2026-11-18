import * as store from "@/skins/logistics/data/store";

// daysOfCover / atRisk are DERIVED here, never stored.
export const GET = async () => Response.json(store.inventoryRisk());
