import { json, preflight, body } from "@/skins/ledgerline/learning/http";
import * as store from "@/skins/ledgerline/learning/store";

/**
 * Ingest for the in-app trajectory recorder (additive to the contract):
 * `{ events: CustomEvent[] }` -> the persisted rows with their eventIds.
 */
export const POST = async (req: Request) => {
  const { events } = await body(req);
  if (!Array.isArray(events))
    return json(
      { error: "BAD_REQUEST", message: "events must be an array" },
      400,
    );
  const valid = events.filter(store.isCustomEvent).slice(0, 200);
  const captured = store.ingest(valid);
  return json({
    accepted: captured.length,
    dropped: events.length - valid.length,
    events: captured,
  });
};
export const OPTIONS = preflight;
