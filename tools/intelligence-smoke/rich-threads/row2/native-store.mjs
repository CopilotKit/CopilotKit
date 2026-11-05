import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Readers return entire envelopes, never a text-only reconstruction. */
export async function readNativeJson({ root, files }) {
  const resolvedRoot = await realpath(root);
  if (!Array.isArray(files) || !files.length)
    throw new Error("Explicit native files required");
  const records = {};
  for (const file of files) {
    const resolved = await realpath(file);
    const key = relative(resolvedRoot, resolved);
    if (!key || key.startsWith("..") || isAbsolute(key))
      throw new Error("Native file outside owned store");
    if (Object.hasOwn(records, key)) throw new Error("Duplicate native file");
    records[key] = JSON.parse(await readFile(resolved, "utf8"));
  }
  return { kind: "file", location: resolvedRoot, records };
}

/** Parameterized, read-only queries must select the fixture's exact native IDs. */
export async function readNativeSqlite({ path, queries }) {
  const location = await realpath(path);
  if (!Array.isArray(queries) || !queries.length)
    throw new Error("Explicit native queries required");
  const db = new DatabaseSync(location, { readOnly: true });
  try {
    const records = {};
    for (const { key, sql, params = [], jsonColumns = [] } of queries) {
      if (!key || Object.hasOwn(records, key))
        throw new Error("Unique query key required");
      if (!/^\s*SELECT\b/i.test(sql))
        throw new Error("Only native SELECT queries are allowed");
      records[key] = db
        .prepare(sql)
        .all(...params)
        .map((row) => {
          const decoded = { ...row };
          for (const column of jsonColumns) {
            if (typeof decoded[column] === "string")
              decoded[column] = JSON.parse(decoded[column]);
          }
          return decoded;
        });
    }
    return { kind: "sqlite", location, records };
  } finally {
    db.close();
  }
}
