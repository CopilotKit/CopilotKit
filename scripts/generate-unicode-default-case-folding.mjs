import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  OUTPUT_PATHS,
  SOURCE_SHA256,
  SOURCE_URL,
  parseCaseFoldingSource,
  renderCSharpModule,
  renderPythonModule,
  renderTypeScriptModule,
} from "./unicode-default-case-folding-emit.mjs";

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(
    `Could not download Unicode case-folding data: ${response.status} ${response.statusText}`,
  );
}
const source = await response.text();
const sourceSha256 = createHash("sha256").update(source).digest("hex");
if (sourceSha256 !== SOURCE_SHA256) {
  throw new Error(
    `Unicode case-folding data has SHA-256 ${sourceSha256}; expected ${SOURCE_SHA256}`,
  );
}

const mappings = parseCaseFoldingSource(source);
const renderers = {
  typescript: renderTypeScriptModule,
  python: renderPythonModule,
  csharp: renderCSharpModule,
};

for (const [language, relativePath] of Object.entries(OUTPUT_PATHS)) {
  await writeFile(
    new URL(`../${relativePath}`, import.meta.url),
    renderers[language](mappings),
    "utf8",
  );
}
