import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  snapshotSqlite,
  snapshotDirectory,
  createNativeReader,
} from "../row6/native.mjs";
import { runImporter } from "../row6/command.mjs";
import { createDestinationReader } from "../row6/destination.mjs";

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "row6-adapter-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("SQLite logical reader retains workflow metadata, binary media and 64-bit integers through read-only WAL snapshot", async (t) => {
  const path = join(await directory(t), "source.db");
  const writer = new DatabaseSync(path);
  t.after(() => writer.close());
  writer.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE messages (id INTEGER, envelope TEXT, media BLOB); CREATE TABLE workflows (payload TEXT)",
  );
  writer.prepare("INSERT INTO messages VALUES (?,?,?)").run(
    9007199254740993n,
    JSON.stringify({
      toolCallId: "call",
      filename: "a.wav",
      parts: ["first", "second"],
    }),
    Buffer.from([0, 255, 3]),
  );
  writer
    .prepare("INSERT INTO workflows VALUES (?)")
    .run(JSON.stringify({ interrupt: { id: "pending", task: "original" } }));
  const first = snapshotSqlite(path);
  assert.deepEqual(first, snapshotSqlite(path));
  assert.deepEqual(
    first.tables.find((item) => item.name === "messages").rows[0].id,
    { sqliteInteger: "9007199254740993" },
  );
  assert.deepEqual(
    first.tables.find((item) => item.name === "messages").rows[0].media,
    { sqliteBlob: "AP8D" },
  );
  writer.exec("UPDATE workflows SET payload='changed'");
  assert.notDeepEqual(first, snapshotSqlite(path));
});

test("SQLite set ordering ignores physical row reorder but retains duplicate rows", async (t) => {
  const path = join(await directory(t), "source.db");
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec(
    "CREATE TABLE records (value TEXT); INSERT INTO records VALUES ('a'),('b'),('a')",
  );
  const first = snapshotSqlite(path);
  db.exec("DELETE FROM records; INSERT INTO records VALUES ('b'),('a'),('a')");
  assert.deepEqual(first, snapshotSqlite(path));
  db.exec(
    "DELETE FROM records WHERE rowid=(SELECT MIN(rowid) FROM records WHERE value='a')",
  );
  assert.notDeepEqual(first, snapshotSqlite(path));
});

test("directory reader covers all latest/history snapshots and media sidecars without sorting nested arrays", async (t) => {
  const root = await directory(t);
  await mkdir(join(root, "snapshots"));
  await writeFile(
    join(root, "snapshots", "latest.json"),
    JSON.stringify({ messages: ["a", "b"], pending: { id: "p" } }),
  );
  await writeFile(
    join(root, "snapshots", "history.json"),
    JSON.stringify({ state: { todo: 1 } }),
  );
  await writeFile(join(root, "media.wav"), Buffer.from([0, 255]));
  const first = await snapshotDirectory(root);
  assert.equal(first.length, 3);
  assert.equal(first[0].base64, "AP8=");
  await writeFile(
    join(root, "snapshots", "latest.json"),
    JSON.stringify({ messages: ["b", "a"], pending: { id: "p" } }),
  );
  assert.notDeepEqual(first, await snapshotDirectory(root));
});

test("directory reader refuses symlink escapes and invalid JSON", async (t) => {
  const root = await directory(t);
  await symlink(tmpdir(), join(root, "escape"));
  await assert.rejects(snapshotDirectory(root), /refuses symlink/);
  await rm(join(root, "escape"));
  await writeFile(join(root, "broken.json"), "{");
  await assert.rejects(snapshotDirectory(root), SyntaxError);
});

test("native service rereads stores each time and rejects another owner's store", async (t) => {
  const root = await directory(t);
  await writeFile(join(root, "state.json"), '{"todo":1}');
  const config = {
    owner: "owned",
    stores: [{ id: "native", kind: "directory", path: root, owner: "owned" }],
    sources: [{ importSourceId: "s", nativeIdentity: { threadId: "native" } }],
  };
  const read = createNativeReader(config);
  const before = await read();
  await writeFile(join(root, "state.json"), '{"todo":2}');
  assert.notDeepEqual(before, await read());
  assert.throws(
    () => createNativeReader({ ...config, owner: "foreign" }),
    /owner differs/,
  );
});

test("destination queries are tenant scoped and preserve raw records plus API transcript", async () => {
  const queries = [];
  let released = false;
  const raw = {
    id: "internal",
    thread_id: "public",
    end_user_id: "user",
    import_metadata: { source_thread_id: "source", backendThreadId: "native" },
  };
  const client = {
    async query(sql, args) {
      queries.push({ sql, args });
      if (sql.startsWith("SELECT * FROM cpki.threads")) return { rows: [raw] };
      if (sql.includes("to_regclass")) return { rows: [{ table_name: null }] };
      if (sql.includes("run_events"))
        return {
          rows: [
            {
              id: "9",
              raw: { type: "STATE_SNAPSHOT", snapshot: { todos: [1] } },
            },
          ],
        };
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const read = createDestinationReader({
    pool: { connect: async () => client },
    organizationId: "org",
    projectId: 7,
    readThread: async (id, user) => {
      assert.equal(id, "public");
      assert.equal(user, "user");
      return {
        messages: [{ id: "m", role: "user", content: "saved" }],
        state: { todo: 1 },
      };
    },
  });
  const result = await read();
  assert.equal(result.threads[0].nativeThreadId, "native");
  assert.deepEqual(result.threads[0].thread, raw);
  assert.equal(result.threads[0].events[0].id, "9");
  assert(released);
  assert(
    queries
      .filter(
        ({ sql }) => sql.includes("cpki.") && !sql.includes("to_regclass"),
      )
      .every(({ args }) => args[0] === "org"),
  );
  assert.equal(queries.at(-1).sql, "COMMIT");
});

test("real importer subprocess logs redact credentials and preserve nonzero exit", async (t) => {
  const log = join(await directory(t), "command.log");
  await assert.rejects(
    runImporter(
      process.execPath,
      ["-e", "console.error('private-key');process.exit(1)"],
      { log, secrets: ["private-key"] },
    ),
    (error) => error.exitCode === 1,
  );
  assert.equal((await readFile(log, "utf8")).trim(), "[redacted]");
});

test("real importer subprocess is terminated when its run is aborted", async (t) => {
  const root = await directory(t);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("owned run cancelled")),
    100,
  );
  t.after(() => clearTimeout(timer));
  await assert.rejects(
    runImporter(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      log: join(root, "cancel.log"),
      signal: controller.signal,
    }),
    /owned run cancelled/,
  );
});
