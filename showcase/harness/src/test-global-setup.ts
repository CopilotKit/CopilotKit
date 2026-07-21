import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const harnessDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Generate ignored registry inputs before Vitest imports static JSON modules. */
export default function generateShowcaseRegistry(): void {
  execFileSync("pnpm", ["--dir", "../scripts", "generate-registry"], {
    cwd: harnessDirectory,
    stdio: "inherit",
  });
}
