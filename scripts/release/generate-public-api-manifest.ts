import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPublicApiManifest,
  publicApiManifestPath,
  publicApiSchemaPath,
  renderPublicApiManifest,
} from "./lib/public-api-manifest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = new Set(process.argv.slice(2));
const write = args.delete("--write");
const check = args.delete("--check");

if (args.size > 0 || write === check) {
  throw new Error("Usage: generate-public-api-manifest.ts (--write | --check)");
}

if (!existsSync(publicApiSchemaPath(root))) {
  throw new Error(`Missing versioned schema: ${publicApiSchemaPath(root)}`);
}

const expected = renderPublicApiManifest(buildPublicApiManifest(root));
const manifestPath = publicApiManifestPath(root);

if (write) {
  writeFileSync(manifestPath, expected);
  console.log(`Wrote ${manifestPath}`);
} else {
  const actual = existsSync(manifestPath)
    ? readFileSync(manifestPath, "utf8")
    : "";
  if (actual !== expected) {
    throw new Error(
      `${manifestPath} is stale. Run pnpm generate:public-api-manifest.`,
    );
  }
  console.log(`${manifestPath} is current`);
}
