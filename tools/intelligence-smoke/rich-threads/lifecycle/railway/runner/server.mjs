import assert from "node:assert/strict";
import { createServer } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  lstat,
  writeFile,
} from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { durableJson } from "../journal.mjs";
import { parseRunRecordsSnapshot, policy } from "../contract.mts";
import { digest, policyDigest } from "../distribution.mjs";
import { createScheduler } from "./scheduler.mjs";
import { installBootstrap } from "./bootstrap-seed.mjs";

const roles = ["image-gate", "ruby-promotion", "harness"];
const idPattern = /^run-[a-f0-9-]{36}$/;
const maxBytes = 32 * 1024 * 1024;
async function jsonBody(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    assert.ok(bytes <= 16_384);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function safeFile(root, path) {
  const actualRoot = await realpath(root);
  const file = await realpath(resolve(root, path));
  assert.ok(
    file.startsWith(actualRoot + sep),
    "Result path escapes retained directory",
  );
  const stat = await lstat(file);
  assert.ok(
    stat.isFile() && stat.size <= maxBytes,
    "Result exceeds download bound",
  );
  return file;
}
async function manifest(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      assert.ok(files.length < 5000, "Result manifest exceeds bound");
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Result symlink refused");
      if (entry.isDirectory()) await walk(path);
      else {
        const bytes = await readFile(
          await safeFile(root, relative(root, path)),
        );
        files.push({
          path: relative(root, path),
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  await walk(root);
  return files;
}
export function runnerServer({ root, config, token, scheduler }) {
  assert.ok(
    typeof token === "string" && token.length >= 32,
    "Runner authentication required",
  );
  const expected = Buffer.from(`Bearer ${token}`);
  return createServer(async (request, response) => {
    const send = (status, value, headers = {}) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        ...headers,
      });
      response.end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url, "http://runner");
      if (request.method === "GET" && url.pathname === "/health")
        return send(200, { service: "rich-threads-runner", alive: true });
      const auth = Buffer.from(request.headers.authorization ?? "");
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected))
        return send(401, { error: "unauthorized" });
      if (request.method === "GET" && url.pathname === "/status")
        return send(200, scheduler.status());
      if (request.method === "GET" && url.pathname === "/registry") {
        const bytes = await readFile(config.recordsFile, "utf8");
        assert.ok(
          parseRunRecordsSnapshot(JSON.parse(bytes), policy, new Date()).ok,
        );
        response.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-policy-sha256": policyDigest(),
          "x-snapshot-sha256": digest(bytes),
        });
        return response.end(bytes);
      }
      const consumer = url.pathname.match(/^\/consumers\/([a-z-]+)$/)?.[1];
      if (consumer && roles.includes(consumer)) {
        const path = join(root, `consumer-${consumer}.json`);
        if (request.method === "POST") {
          const body = await jsonBody(request);
          assert.ok(
            config.consumers?.some(
              (target) =>
                target.transport === "https" &&
                target.consumer === consumer &&
                target.recordsFile === body.recordsFile,
            ),
            "Consumer transport not configured",
          );
          assert.equal(body.policySha256, policyDigest());
          assert.equal(
            body.sha256,
            digest(await readFile(config.recordsFile, "utf8")),
          );
          assert.equal(body.reader, "railway-lifecycle-records-v1");
          await durableJson(path, {
            consumer,
            recordsFile: body.recordsFile,
            reader: body.reader,
            policySha256: body.policySha256,
            sha256: body.sha256,
            at: new Date().toISOString(),
          });
          return send(200, { accepted: true });
        }
        if (request.method === "GET")
          return send(200, JSON.parse(await readFile(path, "utf8")));
      }
      if (request.method === "POST" && url.pathname === "/runs") {
        const body = await jsonBody(request);
        assert.ok(
          Object.keys(body).every((key) =>
            ["mode", "crashStage"].includes(key),
          ) && ["single", "acceptance", "crash-recovery"].includes(body.mode),
        );
        const result = await scheduler.start(body.mode, body.crashStage);
        if (!result.accepted) return send(409, { reason: result.reason });
        return send(202, {
          id: result.id,
          statusUrl: `/runs/${result.id}`,
          resultsUrl: `/results/${result.id}/`,
        });
      }
      const runId = url.pathname.match(/^\/runs\/([^/]+)$/)?.[1];
      if (request.method === "GET" && runId && idPattern.test(runId))
        return send(
          200,
          JSON.parse(
            await readFile(join(root, "results", runId, "run.json"), "utf8"),
          ),
        );
      const result = url.pathname.match(/^\/results\/([^/]+)\/(.+)$/);
      if (request.method === "GET" && result && idPattern.test(result[1])) {
        const directory = join(root, "results", result[1]);
        if (result[2] === "manifest")
          return send(200, { files: await manifest(directory) });
        const bytes = await readFile(
          await safeFile(directory, decodeURIComponent(result[2])),
        );
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
        });
        return response.end(bytes);
      }
      send(404, { error: "not-found" });
    } catch {
      send(503, { error: "request-refused-or-evidence-unavailable" });
    }
  });
}

export async function main(env = process.env) {
  assert.ok(
    env.RAILWAY_SERVICE_ID &&
      env.RAILWAY_ENVIRONMENT_ID &&
      env.RAILWAY_VOLUME_MOUNT_PATH,
    "Permanent hosted Railway service and volume required",
  );
  const root = env.RAILWAY_VOLUME_MOUNT_PATH;
  assert.equal(root, "/data");
  for (const path of ["private", "control", "results"])
    await mkdir(join(root, path), { recursive: true, mode: 0o700 });
  const configPath = join(root, "private/template.json");
  const template = JSON.parse(env.RICH_TEMPLATE_JSON);
  assert.equal(template.controlDirectory, join(root, "control"));
  assert.equal(template.recordsFile, join(root, "control/records.json"));
  template.permanentRunner = {
    projectId: env.RAILWAY_PROJECT_ID,
    environmentId: env.RAILWAY_ENVIRONMENT_ID,
    serviceId: env.RAILWAY_SERVICE_ID,
    volumeId: env.RAILWAY_VOLUME_ID,
  };
  await installBootstrap({
    root,
    template,
    seed: env.RICH_BOOTSTRAP_SCRIPT_B64,
  });
  delete env.RICH_BOOTSTRAP_SCRIPT_B64;
  await durableJson(configPath, template);
  // Only initialize an unmistakably new volume. Missing records on an existing
  // initialized volume are corruption and must block, never become an empty run list.
  const marker = join(root, "initialized.json");
  try {
    await readFile(marker);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    assert.deepEqual(
      await readdir(template.controlDirectory),
      [],
      "Refusing to initialize nonempty authority",
    );
    await writeFile(
      template.recordsFile,
      JSON.stringify({ schemaVersion: 1, runs: [] }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await durableJson(marker, {
      serviceId: env.RAILWAY_SERVICE_ID,
      volumeId: env.RAILWAY_VOLUME_ID,
      initializedAt: new Date().toISOString(),
    });
  }
  const scheduler = await createScheduler({
    root,
    config: template,
    configPath,
    controller: resolve("tools/intelligence-smoke/rich-threads/controller.mjs"),
  });
  const server = runnerServer({
    root,
    config: template,
    token: env.RICH_RUNNER_TOKEN,
    scheduler,
  });
  server.listen(Number(env.PORT ?? 8080), "0.0.0.0");
  const timer = setInterval(() => {
    void scheduler
      .tick()
      .catch(() => console.error("Runner reconciliation tick failed"));
  }, 30_000);
  const stop = async () => {
    clearInterval(timer);
    server.close();
    await scheduler.close();
  };
  process.once("SIGTERM", () => {
    void stop();
  });
  process.once("SIGINT", () => {
    void stop();
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Permanent Railway runner failed startup; retained authority requires reconciliation",
    );
    process.exitCode = 1;
  });
