// Swaps this app's Git LFS pointer files for their content, from the repo's
// LFS store. Railway builds from a copy of the repo without Git LFS, so the
// page images arrive as pointers (see Dockerfile). With LFS installed there
// are no pointers and this does nothing.
//
//   node scripts/fetch-lfs.mjs
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = process.env.LFS_REPO ?? "CopilotKit/CopilotKit";
// Per request, body included. A stalled connection fails the build instead of
// hanging it until the CI job's own timeout.
const TIMEOUT_MS = Number(process.env.LFS_TIMEOUT_MS ?? 60_000);
const SKIP = new Set(["node_modules", ".next", ".source"]);
const POINTER =
  /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n/;

const app = join(dirname(fileURLToPath(import.meta.url)), "..");

/** oid -> { size, paths } for every pointer file under `dir`. */
function findPointers(dir, found = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      findPointers(path, found);
    } else if (entry.isFile() && statSync(path).size < 1024) {
      const match = readFileSync(path, "utf8").match(POINTER);
      if (!match) continue;
      const [, oid, size] = match;
      if (!found.has(oid)) found.set(oid, { size: Number(size), paths: [] });
      found.get(oid).paths.push(path);
    }
  }
  return found;
}

// A dropped connection is retried; Railway's builder drops some of them.
const ATTEMPTS = 3;
// Downloads at once. All of them in parallel had connections dropped.
const CONCURRENCY = 6;

async function fetchBody(action) {
  const response = await fetch(action.href, {
    headers: action.header,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function download(oid, { size, paths }, action) {
  let body;
  for (let attempt = 1; !body; attempt++) {
    try {
      body = await fetchBody(action);
    } catch (error) {
      // undici's "fetch failed" hides the network error in `cause`.
      const reason = error.cause?.code ?? error.cause?.message ?? error.message;
      if (attempt === ATTEMPTS) {
        throw new Error(`${paths[0]}: ${error.message} (${reason})`, {
          cause: error,
        });
      }
      console.warn(`[fetch-lfs] ${paths[0]}: ${reason}, retrying`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  const hash = createHash("sha256").update(body).digest("hex");
  if (body.length !== size || hash !== oid) {
    throw new Error(`${paths[0]}: content does not match its LFS pointer`);
  }
  for (const path of paths) writeFileSync(path, body);
}

const pointers = findPointers(app);
const oids = [...pointers.keys()];
// The LFS batch API takes up to 100 objects a request.
for (let i = 0; i < oids.length; i += 100) {
  const batch = oids.slice(i, i + 100);
  const response = await fetch(
    `https://github.com/${REPO}.git/info/lfs/objects/batch`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.git-lfs+json",
        "Content-Type": "application/vnd.git-lfs+json",
      },
      body: JSON.stringify({
        operation: "download",
        transfers: ["basic"],
        objects: batch.map((oid) => ({ oid, size: pointers.get(oid).size })),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`LFS batch request to ${REPO}: HTTP ${response.status}`);
  }
  const { objects } = await response.json();
  for (const object of objects) {
    if (object.error) {
      throw new Error(`${object.oid}: ${object.error.message}`);
    }
  }
  const queue = [...objects];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let object; (object = queue.shift()); ) {
        await download(
          object.oid,
          pointers.get(object.oid),
          object.actions.download,
        );
      }
    }),
  );
}
console.log(`[fetch-lfs] ${oids.length} files from ${REPO}`);
