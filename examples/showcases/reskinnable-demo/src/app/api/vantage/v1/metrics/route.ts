import * as store from "@/skins/vantage/data/store";

export const GET = async () => Response.json({ metrics: store.metrics() });
