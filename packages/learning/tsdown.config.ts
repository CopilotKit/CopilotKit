import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const pkg: unknown = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
if (
  typeof pkg !== "object" ||
  pkg === null ||
  !("version" in pkg) ||
  typeof pkg.version !== "string"
) {
  throw new Error("packages/learning/package.json has no version");
}
const version = pkg.version;

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  exports: true,
  define: { __LEARNING_VERSION__: JSON.stringify(version) },
});
