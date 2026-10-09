import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packAngularArtifacts } from "./lib/angular-artifacts.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDirectory = process.argv[2];

if (!outputDirectory) {
  throw new Error(
    "usage: tsx scripts/release/pack-angular-artifacts.ts <output-directory>",
  );
}

const artifacts = packAngularArtifacts(ROOT, outputDirectory);
console.log(
  `Packed ${artifacts.tarballs.size} Angular workspace artifacts into ${resolve(outputDirectory)}.`,
);
