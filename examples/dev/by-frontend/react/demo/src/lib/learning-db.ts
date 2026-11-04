import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

type SqliteValue = string | number | null;

interface SqliteStatement {
  run(...params: SqliteValue[]): unknown;
  all(...params: SqliteValue[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase;
}

/** A batch as the browser sends it. Validated by {@link parseBatch} before use. */
export interface IncomingBatch {
  trajectoryId: string;
  learningContainerIds: string[];
  dropped: number;
  events: IncomingEvent[];
}

interface IncomingEvent {
  name: string;
  timestamp: number;
  value: Record<string, unknown>;
}

export interface LearningEventRow {
  id: number;
  trajectoryId: string;
  seq: number | null;
  name: string;
  threadId: string | null;
  timestamp: number;
  value: Record<string, unknown>;
}

export const DEFAULT_DB_PATH = join(process.cwd(), ".data", "learning.sqlite");

// ponytail: loaded at runtime so the bundler never resolves `node:sqlite`, and old Node fails with a readable error.
const loadBuiltin = createRequire(`${process.cwd()}/`);

function loadSqlite() {
  try {
    const sqlite: SqliteModule = loadBuiltin("node:sqlite");
    return sqlite;
  } catch {
    throw new Error(
      "The learning sink needs Node.js 22.13 or later, which ships node:sqlite.",
    );
  }
}

/** Opens (and creates) the demo database. Pass ":memory:" in tests. */
export function openLearningDb(path: string = DEFAULT_DB_PATH) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trajectory_id TEXT NOT NULL,
      seq INTEGER,
      name TEXT NOT NULL,
      thread_id TEXT,
      timestamp INTEGER NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trajectory_id TEXT NOT NULL,
      learning_container_ids TEXT NOT NULL,
      dropped INTEGER NOT NULL,
      received_at INTEGER NOT NULL
    );
  `);
  return db;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvent(value: unknown): IncomingEvent | null {
  if (!isRecord(value)) return null;
  const { name, timestamp, value: fields } = value;
  if (typeof name !== "string" || typeof timestamp !== "number") return null;
  if (!isRecord(fields)) return null;
  return { name, timestamp, value: fields };
}

/** Validates an untrusted request body. Returns `null` when it is not a batch. */
export function parseBatch(body: unknown): IncomingBatch | null {
  if (!isRecord(body)) return null;
  const { trajectoryId, events, dropped, learningContainerIds } = body;
  if (typeof trajectoryId !== "string" || !Array.isArray(events)) return null;
  const parsed = events.map(parseEvent);
  const valid = parsed.filter(
    (event): event is IncomingEvent => event !== null,
  );
  if (valid.length !== parsed.length) return null;
  const containerIds = Array.isArray(learningContainerIds)
    ? learningContainerIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    trajectoryId,
    learningContainerIds: containerIds,
    dropped: typeof dropped === "number" ? dropped : 0,
    events: valid,
  };
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" ? value : null;
}

/** Stores one batch in a single transaction. Returns the number of events written. */
export function insertBatch(db: SqliteDatabase, batch: IncomingBatch) {
  const insertEvent = db.prepare(
    "INSERT INTO events (trajectory_id, seq, name, thread_id, timestamp, value) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertBatchRow = db.prepare(
    "INSERT INTO batches (trajectory_id, learning_container_ids, dropped, received_at) VALUES (?, ?, ?, ?)",
  );
  db.exec("BEGIN");
  try {
    for (const event of batch.events) {
      insertEvent.run(
        batch.trajectoryId,
        numberOrNull(event.value.seq),
        event.name,
        stringOrNull(event.value.threadId),
        event.timestamp,
        JSON.stringify(event.value),
      );
    }
    insertBatchRow.run(
      batch.trajectoryId,
      JSON.stringify(batch.learningContainerIds),
      batch.dropped,
      Date.now(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return batch.events.length;
}

function toRow(raw: unknown): LearningEventRow | null {
  if (!isRecord(raw)) return null;
  const value: unknown = JSON.parse(String(raw.value));
  if (!isRecord(value)) return null;
  return {
    id: Number(raw.id),
    trajectoryId: String(raw.trajectory_id),
    seq: numberOrNull(raw.seq),
    name: String(raw.name),
    threadId: stringOrNull(raw.thread_id),
    timestamp: Number(raw.timestamp),
    value,
  };
}

/** Every stored event, grouped by Trajectory and in capture order. */
export function listEvents(db: SqliteDatabase) {
  const rows = db
    .prepare(
      "SELECT id, trajectory_id, seq, name, thread_id, timestamp, value FROM events ORDER BY trajectory_id, seq, id",
    )
    .all();
  return rows.map(toRow).filter((row): row is LearningEventRow => row !== null);
}
