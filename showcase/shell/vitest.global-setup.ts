// Vitest globalSetup: generate the gitignored registry.json BEFORE any
// test worker starts.
//
// src/middleware.ts statically imports `@/data/registry.json`, a generated
// artifact (see showcase/.gitignore) that `npm run dev`/`build` produce.
// On a fresh checkout it doesn't exist, and vitest workers have no
// ordering guarantee — so generation must happen here, once, before
// module transform, not in any single test file's beforeAll (which both
// races other workers and leaves every other file broken when it doesn't
// run first).
//
// Idempotent: if the registry already exists AND is valid (dev/build
// ran, or a prior test run generated it), this is a no-op.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const SHELL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.join(SHELL_ROOT, "src", "data", "registry.json");

// Validate before the early return (SU4-A7): a corrupt or stale
// registry.json (interrupted generator, truncated write) used to pass
// the bare existsSync check and then break EVERY middleware test at
// import with an unrelated-looking JSON/transform error. Parse it and
// require a non-empty integrations array; regenerate otherwise.
function isValidRegistry(registryPath: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as {
      integrations?: unknown;
    };
    return Array.isArray(parsed.integrations) && parsed.integrations.length > 0;
  } catch {
    return false;
  }
}

export default function setup(): void {
  if (fs.existsSync(REGISTRY_PATH)) {
    if (isValidRegistry(REGISTRY_PATH)) return;
    console.warn(
      `[vitest.global-setup] ${REGISTRY_PATH} exists but is corrupt or ` +
        "has no integrations — regenerating.",
    );
  }

  // Run the local generator through the current node binary + the locally
  // installed tsx CLI — NOT `npx tsx`: npx without -y can prompt-hang when
  // the package isn't cached, and `npx` itself isn't directly spawnable on
  // Windows (execFile needs the .cmd shim).
  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  const generator = path.join(
    SHELL_ROOT,
    "..",
    "scripts",
    "generate-registry.ts",
  );

  // Generous timeout: the generator validates every manifest and emits
  // catalogs for all shells. Keep stdout quiet but surface stderr — with
  // stdio "ignore" a generator failure is a bare exit-code-1 with nothing
  // to debug on CI.
  execFileSync(process.execPath, [tsxCli, generator], {
    cwd: SHELL_ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    timeout: 120_000,
  });

  // Re-validate AFTER regeneration (SU5-A5): a generator that exits 0
  // but emits an unusable registry (schema drift, empty integrations,
  // output path moved) would otherwise resurface as the exact baffling
  // transform error in whichever test file imports middleware first —
  // the failure this setup exists to prevent. Fail HERE, loudly.
  if (!isValidRegistry(REGISTRY_PATH)) {
    throw new Error(
      `[vitest.global-setup] generate-registry.ts completed but ` +
        `${REGISTRY_PATH} is still missing, corrupt, or has no ` +
        "integrations — the registry generator (or its output path) is " +
        "broken; fix it before running the shell test suite.",
    );
  }
}
