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

async function download(oid, { size, paths }, action) {
  const response = await fetch(action.href, { headers: action.header });
  if (!response.ok) throw new Error(`${paths[0]}: HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
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
    },
  );
  if (!response.ok) {
    throw new Error(`LFS batch request to ${REPO}: HTTP ${response.status}`);
  }
  const { objects } = await response.json();
  await Promise.all(
    objects.map((object) => {
      if (object.error) {
        throw new Error(`${object.oid}: ${object.error.message}`);
      }
      return download(
        object.oid,
        pointers.get(object.oid),
        object.actions.download,
      );
    }),
  );
}
console.log(`[fetch-lfs] ${oids.length} files from ${REPO}`);
