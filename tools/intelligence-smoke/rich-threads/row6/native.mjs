import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { resolve, relative, join } from "node:path";

const identifier = (name) => `"${name.replaceAll('"', '""')}"`;
const jsonValue = (value) => {
  if (typeof value === "bigint") return { sqliteInteger: value.toString() };
  if (value instanceof Uint8Array)
    return { sqliteBlob: Buffer.from(value).toString("base64") };
  return value;
};

/** Consistent read-only logical snapshot, including pending workflows and sidecars. */
export function snapshotSqlite(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("BEGIN");
    const schema = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name",
      )
      .all();
    const tables = [];
    for (const entry of schema.filter((item) => item.type === "table")) {
      const statement = db.prepare(`SELECT * FROM ${identifier(entry.name)}`);
      statement.setReadBigInts(true);
      // SQL tables are unordered sets. Sort entire rows, never message arrays
      // inside a JSON cell, and retain every duplicate row occurrence.
      const rows = statement
        .all()
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, jsonValue(value)]),
          ),
        );
      rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      tables.push({ name: entry.name, rows });
    }
    db.exec("COMMIT");
    return { schema, tables };
  } finally {
    db.close();
  }
}

/** Every native file is reread. JSON is logical data; binary sidecars keep exact bytes. */
export async function snapshotDirectory(directory) {
  assert(
    !(await lstat(directory)).isSymbolicLink(),
    "Native root cannot be a symlink",
  );
  const root = await realpath(directory);
  const files = [];
  const visit = async (path) => {
    const names = (await readdir(path)).sort();
    for (const name of names) {
      const file = join(path, name);
      const stat = await lstat(file);
      assert(
        !stat.isSymbolicLink(),
        `Native snapshot refuses symlink: ${relative(root, file)}`,
      );
      if (stat.isDirectory()) await visit(file);
      else {
        assert(stat.isFile(), "Native snapshot requires regular files");
        const bytes = await readFile(file);
        const next = await lstat(file);
        assert(
          stat.size === next.size &&
            stat.ino === next.ino &&
            stat.ctimeMs === next.ctimeMs &&
            stat.mtimeMs === next.mtimeMs,
          "Native writer changed a file while snapshotting; quiesce the source",
        );
        files.push({
          path: relative(root, file),
          ...(name.endsWith(".json")
            ? { json: JSON.parse(bytes.toString("utf8")) }
            : { base64: bytes.toString("base64") }),
        });
      }
    }
    assert.deepEqual(
      (await readdir(path)).sort(),
      names,
      "Native directory changed while snapshotting; quiesce the source",
    );
  };
  await visit(root);
  assert(files.length, "Empty native store is not import coverage");
  return files;
}

/** Store locations come from row3/lifecycle, never discovery of another run's files. */
export function createNativeReader({ sources, stores, owner }) {
  assert(
    owner && sources.length && stores.length,
    "Owned native source set required",
  );
  for (const store of stores) {
    assert.equal(store.owner, owner, "Native store owner differs from run");
    assert(
      ["sqlite", "directory"].includes(store.kind),
      `Unsupported native store: ${store.kind}`,
    );
    assert.equal(
      resolve(store.path),
      store.path,
      "Native store path must be absolute",
    );
  }
  return async () => {
    const logical = [];
    for (const store of stores)
      logical.push({
        id: store.id,
        kind: store.kind,
        data:
          store.kind === "sqlite"
            ? snapshotSqlite(store.path)
            : await snapshotDirectory(store.path),
      });
    return sources.map((source) => ({
      sourceId: source.importSourceId,
      nativeIdentity: source.nativeIdentity,
      logical,
    }));
  };
}
