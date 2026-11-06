/** Execute the snapshot whose transformation is checked by the fixture suite. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = mkdtempSync(join(root, "packages/runtime/.codemod-verify-"));
const fixture = join(directory, "hosts.ts");

function run(args) {
  const result = spawnSync("pnpm", args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, COPILOTKIT_TELEMETRY_DISABLED: "true" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Verification failed: pnpm ${args.join(" ")}`);
}

try {
  writeFileSync(
    fixture,
    readFileSync(
      new URL("../tests/ts/runtime-auto-hosts/expected.ts", import.meta.url),
    ),
  );
  run([
    "exec",
    "tsc",
    "--noEmit",
    "--target",
    "es2022",
    "--module",
    "nodenext",
    "--moduleResolution",
    "nodenext",
    "--strict",
    "--skipLibCheck",
    "--esModuleInterop",
    fixture,
  ]);
  run(["exec", "tsx", fixture]);
  console.log(
    "Migrated Express/Hono output: typechecking, routing, CORS, request URLs, parsed bodies, and single-route fallthrough passed.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
