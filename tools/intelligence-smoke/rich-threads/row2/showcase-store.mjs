import { stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readNativeJson, readNativeSqlite } from "./native-store.mjs";

function identifier(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value))
    throw new Error(`${label} must be a single native identifier`);
  return value;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function tables(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
  } finally {
    db.close();
  }
}

/** Read the real Showcase memory and workflow databases independently of its APIs.
 * Workflow storage may be a different database from agent memory. No schema is
 * created and no checkpoint belonging to an unrelated run is exported.
 */
export async function readMastraStore({
  location,
  workflowLocation,
  threadId,
  resourceId,
  runIds = [],
}) {
  identifier(threadId, "threadId");
  if (!resourceId || !Array.isArray(runIds))
    throw new Error("Native resourceId and runIds required");
  for (const path of [location, workflowLocation]) {
    if (!path || /:memory:/i.test(path))
      throw new Error("Both Mastra memory and workflow stores must be durable");
  }
  const records = { messages: [], threads: [], resources: [], checkpoints: [] };
  const stores = [];
  for (const path of new Set([location, workflowLocation])) {
    const present = await exists(path);
    const schema = present ? tables(path) : new Set();
    stores.push({
      location: path,
      exists: present,
      tables: [...schema].sort(),
    });
    const queries = [];
    if (path === location) {
      if (schema.has("mastra_messages"))
        queries.push({
          key: "messages",
          sql: "SELECT * FROM mastra_messages WHERE thread_id = ? ORDER BY createdAt, rowid",
          params: [threadId],
          jsonColumns: ["content"],
        });
      if (schema.has("mastra_threads"))
        queries.push({
          key: "threads",
          sql: "SELECT * FROM mastra_threads WHERE id = ?",
          params: [threadId],
          jsonColumns: ["metadata"],
        });
      if (schema.has("mastra_resources"))
        queries.push({
          key: "resources",
          sql: "SELECT * FROM mastra_resources WHERE id = ?",
          params: [resourceId],
          jsonColumns: ["metadata"],
        });
    }
    if (path === workflowLocation && schema.has("mastra_workflow_snapshot")) {
      // Resource absence is also checked before the run; subsequent run IDs cover
      // frameworks which don't attach a resourceId to workflow checkpoints.
      const placeholders = runIds.map(() => "?").join(",");
      queries.push({
        key: "checkpoints",
        sql: `SELECT *, json(snapshot) AS snapshot FROM mastra_workflow_snapshot WHERE ${runIds.length ? `run_id IN (${placeholders})` : "resourceId = ?"} ORDER BY rowid`,
        params: runIds.length ? runIds : [resourceId],
        jsonColumns: ["snapshot"],
      });
    }
    if (queries.length)
      Object.assign(
        records,
        (await readNativeSqlite({ path, queries })).records,
      );
  }
  return { kind: "sqlite", location, workflowLocation, stores, records };
}

/** The SDK writes its complete envelope here, including metadata attachment
 * sidecars, appData, pending tool execution and interrupt maps. Never substitute
 * Agent.messages, the importer output or the Intelligence history.
 */
export async function readStrandsStore({
  location,
  namespace,
  threadId,
  agentId,
}) {
  identifier(threadId, "threadId");
  identifier(agentId, "native agentId");
  if (namespace)
    location = join(location, identifier(namespace, "native namespace"));
  if (!location || /:memory:/i.test(location))
    throw new Error("Durable Strands session directory required");
  const file = join(
    location,
    threadId,
    "scopes",
    "agent",
    agentId,
    "snapshots",
    "snapshot_latest.json",
  );
  if (!(await exists(file)))
    return {
      kind: "file",
      location,
      records: {},
      files: [{ path: file, exists: false }],
    };
  return {
    ...(await readNativeJson({ root: location, files: [file] })),
    files: [{ path: file, exists: true }],
  };
}

export function createNativeReader(framework, native) {
  if (framework === "mastra")
    return (identity) => readMastraStore({ ...native, ...identity });
  if (framework === "strands-typescript")
    return (identity) =>
      readStrandsStore({ ...native, ...identity, agentId: native.agentId });
  throw new Error(
    `Concrete Showcase native reader not implemented: ${framework}`,
  );
}
