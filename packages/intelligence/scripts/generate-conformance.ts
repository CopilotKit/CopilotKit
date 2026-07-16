import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serializeLearningPlatformConformanceCorpus } from "../src/conformance.js";

const outputUrl = new URL(
  "../conformance/learning-platform-v1.json",
  import.meta.url,
);

await mkdir(fileURLToPath(new URL("../conformance/", import.meta.url)), {
  recursive: true,
});
await writeFile(
  fileURLToPath(outputUrl),
  serializeLearningPlatformConformanceCorpus(),
  "utf8",
);
