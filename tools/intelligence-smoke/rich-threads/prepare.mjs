import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";

const execute = promisify(execFile);
const here = fileURLToPath(new URL(".", import.meta.url));
const { values } = parseArgs({
  options: {
    source: { type: "string", default: resolve(here, "../../..") },
    output: { type: "string" },
    pins: { type: "string" },
  },
});
assert.ok(
  values.output && values.pins,
  "--output and --pins (exact package versions or verified candidate tarballs) required",
);
const output = resolve(values.output);
const source = resolve(values.source);
const { stdout: revisionOutput } = await execute("git", ["rev-parse", "HEAD"], {
  cwd: source,
});
const revision = revisionOutput.trim();
assert.match(revision, /^[a-f0-9]{40}$/);
const pins = JSON.parse(await readFile(resolve(values.pins), "utf8"));
for (const [name, version] of Object.entries(pins)) {
  assert.match(name, /^(@[a-z0-9-]+\/)?[a-z0-9-]+$/);
  if (typeof version === "string")
    assert.match(
      version,
      /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/,
      "Package pins must be exact versions",
    );
  else {
    assert.ok(version.path);
    assert.match(version.sha256, /^[a-f0-9]{64}$/);
  }
}
await mkdir(output, { recursive: false, mode: 0o700 });
await mkdir(join(output, "packs"));
const demo = join(source, "showcase/integrations/mastra");
async function copySource(path, destination) {
  const prefix = relative(source, path);
  const { stdout } = await execute(
    "git",
    ["ls-tree", "-r", "--name-only", revision, "--", prefix],
    { cwd: source },
  );
  const files = stdout.trim().split("\n").filter(Boolean);
  assert.ok(files.length, `No committed source at ${prefix}`);
  for (const file of files) {
    const target =
      file === prefix ? destination : join(destination, relative(prefix, file));
    await mkdir(dirname(target), { recursive: true });
    const { stdout: contents } = await execute(
      "git",
      ["show", `${revision}:${file}`],
      { cwd: source, encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
    );
    await writeFile(target, contents);
  }
}
// Copy only committed build inputs. No .env, private files or borrowed stores.
for (const file of [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "postcss.config.mjs",
])
  await copySource(join(demo, file), join(output, file));
for (const directory of [
  "src/mastra",
  "src/lib",
  "src/app/demos/beautiful-chat",
])
  await copySource(join(demo, directory), join(output, directory));
await copySource(
  join(demo, "public/copilotkit-logo-mark.svg"),
  join(output, "public/copilotkit-logo-mark.svg"),
);
await copySource(
  join(demo, "src/app/globals.css"),
  join(output, "src/app/globals.css"),
);
await copySource(
  join(source, "showcase/shared/typescript/tools"),
  join(output, "shared-tools"),
);
await copySource(
  join(source, "tools/intelligence-smoke/rich-threads"),
  join(output, "rich-threads"),
);
for (const file of ["page.tsx", "layout.tsx"])
  await cp(
    join(output, "rich-threads/application", file),
    join(output, "src/app", file),
  );
for (const file of ["next.config.mjs", "Dockerfile", ".dockerignore"])
  await cp(join(output, "rich-threads/application", file), join(output, file));
const manifest = JSON.parse(
  await readFile(join(output, "package.json"), "utf8"),
);
const resolvedPins = {};
for (const [name, pin] of Object.entries(pins)) {
  if (typeof pin === "string") resolvedPins[name] = pin;
  else {
    const bytes = await readFile(resolve(pin.path));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      pin.sha256,
      `Candidate package digest mismatch: ${name}`,
    );
    await mkdir(join(output, "packs"), { recursive: true });
    const filename = `${name.replaceAll("/", "-").replaceAll("@", "")}.tgz`;
    await writeFile(join(output, "packs", filename), bytes, { flag: "wx" });
    resolvedPins[name] = `file:./packs/${filename}`;
  }
}
manifest.dependencies = {
  ...manifest.dependencies,
  pg: "8.18.0",
  ioredis: "5.9.3",
  playwright: "1.63.0",
  "@ag-ui/client": "1.0.2",
  "@ag-ui/encoder": "1.0.2",
  rxjs: "7.8.1",
  tsx: "4.21.0",
  ...resolvedPins,
};
manifest.overrides = { ...manifest.overrides, ...resolvedPins };
await writeFile(
  join(output, "package.json"),
  JSON.stringify(manifest, null, 2),
);
await execute(
  "npm",
  ["install", "--package-lock-only", "--ignore-scripts", "--legacy-peer-deps"],
  { cwd: output, timeout: 300_000, maxBuffer: 1024 * 1024 },
);
await writeFile(
  join(output, "source.json"),
  JSON.stringify({ copilotkit: revision, pins }, null, 2),
);
console.log(
  `Prepared installable shared application/runtime/native-Mastra context: ${output}`,
);
