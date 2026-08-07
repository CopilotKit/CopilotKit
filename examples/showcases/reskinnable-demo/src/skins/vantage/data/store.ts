import seedJson from "./seed.json";
import type {
  Board,
  BoardTile,
  Db,
  Deal,
  Lens,
  MetricDefinition,
  Source,
} from "./types";

/**
 * In-memory, file-seeded store for the Vantage demo. Mirrors
 * `src/skins/banking/data/store.ts`:
 *
 * - The seed is deep-cloned at module init so mutations never bleed back into
 *   the imported JSON.
 * - Mutations live for the running server process only. A restart resets to
 *   seed, which is intentional (and a second reset lever on stage).
 * - Process lifetime is enough for beat 3d's claim: a filed board outlives the
 *   THREAD that created it. It does not claim to outlive the server.
 * - The single `as unknown as Db` cast at the JSON seam is the only permitted
 *   cast — imported JSON widens enum members to `string`.
 */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let db: Db = clone(seedJson as unknown as Db);

export const reset = (): void => {
  db = clone(seedJson as unknown as Db);
};

export const all = (): Db => db;
export const metrics = (): MetricDefinition[] => db.metrics;
export const deals = (): Deal[] => db.deals;
export const boards = (): Board[] => db.boards;
export const sources = (): Source[] => db.sources;

export const findBoard = (idOrSlug: string): Board | undefined =>
  db.boards.find((b) => b.id === idOrSlug || b.slug === idOrSlug);

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "board";

const uniqueSlug = (title: string): string => {
  const base = slugify(title);
  if (!db.boards.some((b) => b.slug === base)) return base;
  let n = 2;
  while (db.boards.some((b) => b.slug === `${base}-${n}`)) n++;
  return `${base}-${n}`;
};

export interface NewBoardInput {
  title: string;
  summary: string;
  lens: Lens;
  tiles: BoardTile[];
  notes?: string[];
  sourceDocument?: string;
  note?: string;
}

export const addBoard = (input: NewBoardInput): Board => {
  const board: Board = {
    id: `b-${(db.boards.length + 1).toString(36)}-${Date.now().toString(36)}`,
    slug: uniqueSlug(input.title),
    title: input.title,
    summary: input.summary,
    lens: input.lens,
    tiles: input.tiles,
    notes: input.notes ?? [],
    origin: "generated",
    pinned: false,
    createdAt: new Date().toISOString(),
    sourceDocument: input.sourceDocument,
    note: input.note,
  };
  db.boards.push(board);
  return board;
};

export const patchBoard = (
  id: string,
  patch: { pinned?: boolean; notes?: string[]; note?: string },
): Board | undefined => {
  const board = findBoard(id);
  if (!board) return undefined;
  // Exactly one board is pinned at a time — the Boardroom renders "the" pinned
  // board, so two pinned boards would make that page non-deterministic.
  if (patch.pinned === true) {
    for (const other of db.boards) other.pinned = false;
  }
  if (patch.pinned !== undefined) board.pinned = patch.pinned;
  if (patch.notes !== undefined) board.notes = patch.notes;
  if (patch.note !== undefined) board.note = patch.note;
  return board;
};

export interface NewSourceInput {
  name: string;
  warehouse: string;
}

export const addSource = (input: NewSourceInput): Source => {
  const source: Source = {
    id: `src-${db.sources.length + 1}`,
    name: input.name,
    warehouse: input.warehouse,
    // Demo affordance: a plausible table count so the connection reads as real.
    // No warehouse is contacted — see the POST /sources route.
    tableCount: 8 + ((input.name.length * 3) % 22),
    connectedAt: new Date().toISOString(),
  };
  db.sources.push(source);
  return source;
};
