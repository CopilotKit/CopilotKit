// Loads the built modules that use semver, in Node (ESM and CJS) and through
// an esbuild browser bundle, so output that only breaks at load time fails
// here instead of in consumers (#7654).
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = new URL("../dist/lib/", import.meta.url);

for (const name of ["notifications", "hud-config"]) {
  const esm = fileURLToPath(new URL(`${name}.mjs`, dist));
  await import(esm);
  require(fileURLToPath(new URL(`${name}.cjs`, dist)));

  const { outputFiles } = await build({
    entryPoints: [esm],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    logLevel: "silent",
  });
  const code = Buffer.from(outputFiles[0].text).toString("base64");
  await import(`data:text/javascript;base64,${code}`);

  console.log(`dist/lib/${name}: loads as ESM, CJS and through esbuild`);
}
