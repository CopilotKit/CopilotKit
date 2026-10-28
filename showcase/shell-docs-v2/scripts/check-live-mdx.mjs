// Compiles every page in content/live with the live collection's MDX options
// and lists the ones that fail, without a dev server or a full build.
//   node scripts/check-live-mdx.mjs [filter]
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@mdx-js/mdx";
import { parse } from "yaml";
import { applyMdxPreset } from "fumadocs-mdx/config";

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "content",
  "live",
);
const filter = process.argv[2] ?? "";
// The same options the site compiles with (source.config.ts).
const { default: config } = await import("../source.config.ts");
const options = await applyMdxPreset(config.mdxOptions)({ type: "runtime" });

const files = readdirSync(root, { recursive: true })
  .filter((f) => /\.mdx?$/.test(f) && f.includes(filter))
  .sort();
const failures = [];
for (const file of files) {
  const raw = readFileSync(join(root, file), "utf8");
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const content = fm ? raw.slice(fm[0].length) : raw;
  if (fm) parse(fm[1]);
  try {
    await compile({ value: content, path: join(root, file) }, options);
  } catch (err) {
    failures.push(`${file}: ${String(err.message ?? err).split("\n")[0]}`);
  }
}
console.log(failures.join("\n"));
console.log(
  `[check-live-mdx] ${files.length - failures.length}/${files.length} compile`,
);
process.exitCode = failures.length ? 1 : 0;
