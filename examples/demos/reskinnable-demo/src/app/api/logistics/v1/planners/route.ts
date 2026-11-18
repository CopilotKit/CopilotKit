import * as store from "@/skins/logistics/data/store";

export const GET = async () => Response.json(store.planners());
