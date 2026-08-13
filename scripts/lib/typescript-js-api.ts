import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// TypeScript 7.0 ships `tsc` as a Go binary. The package export is only
// `version`. Scripts that walk source with the compiler API must load the
// TypeScript 5 JS API. Angular already pins that package.
const typescriptJsRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/angular",
);

// oxlint-disable-next-line typescript-eslint/consistent-type-imports -- TS 7 types are version-only
export const ts = require(
  require.resolve("typescript", { paths: [typescriptJsRoot] }),
) as typeof import("typescript");
