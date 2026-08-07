import * as store from "@/skins/vantage/data/store";

const WAREHOUSES = ["Snowflake", "BigQuery", "Databricks", "Redshift"];

export const GET = async () => Response.json({ sources: store.sources() });

/**
 * Connect a warehouse — beat 3a.
 *
 * The credential arrives HERE, straight from a component the user typed it into
 * inside the chat. It is shape-checked and then DISCARDED: never stored, never
 * logged, never echoed in the response, and never returned to the agent (whose
 * `respond()` receives only "Connected to <name> — <n> tables."). No warehouse
 * is contacted; this is a demo.
 *
 * Do not add a debug log of the request body here. That is the one change that
 * would quietly break the beat this route exists to prove.
 */
export const POST = async (request: Request) => {
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const warehouse = typeof body.warehouse === "string" ? body.warehouse : "";
  const token = typeof body.token === "string" ? body.token : "";

  if (!name || !WAREHOUSES.includes(warehouse)) {
    return Response.json(
      {
        error: "INVALID_SOURCE",
        message: `Provide a name and one of: ${WAREHOUSES.join(", ")}.`,
      },
      { status: 422 },
    );
  }
  // Shape check only — enough to reject an obvious typo on stage, and it tells
  // us nothing we keep.
  if (token.trim().length < 12) {
    return Response.json(
      {
        error: "INVALID_TOKEN",
        message: "That token looks too short to be a warehouse credential.",
      },
      { status: 422 },
    );
  }
  const source = store.addSource({ name, warehouse });
  return Response.json({ source }, { status: 201 });
};
