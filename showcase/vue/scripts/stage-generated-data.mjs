import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const generatedRoot = fileURLToPath(
  new URL("../src/generated/", import.meta.url),
);

await mkdir(generatedRoot, { recursive: true });
await Promise.all([
  copyFile(
    fileURLToPath(
      new URL("../../shared/frontend-registry.json", import.meta.url),
    ),
    `${generatedRoot}/frontend-registry.json`,
  ),
  copyFile(
    fileURLToPath(
      new URL("../../shell/src/data/frontend-catalog.json", import.meta.url),
    ),
    `${generatedRoot}/frontend-catalog.json`,
  ),
]);
