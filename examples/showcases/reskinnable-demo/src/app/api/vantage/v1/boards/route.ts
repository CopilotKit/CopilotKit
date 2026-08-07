import * as store from "@/skins/vantage/data/store";
import { parseLens } from "@/skins/vantage/data/lens";
import type { BoardTile, MetricId } from "@/skins/vantage/data/types";

const TILE_KINDS = ["kpi", "trend", "breakdown", "waterfall"] as const;
const METRICS: MetricId[] = [
  "arr",
  "nrr",
  "pipeline_coverage",
  "cac_payback",
  "logo_churn",
  "magic_number",
];

export const GET = async () => Response.json({ boards: store.boards() });

/**
 * File a board. This is beat 3d's durable artifact: the response is a real
 * resource with a slug the app routes to, so the board survives the thread that
 * asked for it being deleted.
 */
export const POST = async (request: Request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "BAD_JSON", message: "Body must be JSON." },
      { status: 400 },
    );
  }
  const input = body as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const rawTiles = Array.isArray(input.tiles) ? input.tiles : [];
  const tiles = rawTiles.filter((t): t is BoardTile => {
    const tile = t as Partial<BoardTile>;
    return (
      typeof tile.label === "string" &&
      TILE_KINDS.includes(tile.kind as (typeof TILE_KINDS)[number]) &&
      METRICS.includes(tile.metric as MetricId)
    );
  });
  if (!title || tiles.length === 0) {
    return Response.json(
      {
        error: "INVALID_BOARD",
        message: "A board needs a title and at least one valid tile.",
      },
      { status: 422 },
    );
  }
  const board = store.addBoard({
    title,
    summary: typeof input.summary === "string" ? input.summary : "",
    lens: parseLens((input.lens ?? {}) as Record<string, string | undefined>),
    tiles,
    notes: Array.isArray(input.notes) ? (input.notes as string[]) : [],
    sourceDocument:
      typeof input.sourceDocument === "string"
        ? input.sourceDocument
        : undefined,
    note: typeof input.note === "string" ? input.note : undefined,
  });
  return Response.json({ board }, { status: 201 });
};
