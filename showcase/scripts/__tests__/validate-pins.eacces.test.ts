// Split from validate-pins.test.ts — see validate-pins.shared.ts header
// for the full rationale (vitest birpc 60s cliff, fork-per-file).
//
// This file covers EACCES / infra-class fault routing in validateAll's
// showcase-side scan (the validator no longer reads `examples/` so the
// examples-side EACCES test was retired).

import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import {
  VALIDATE_PINS_SCRIPT,
  write,
  withTmp,
} from "./validate-pins.shared.js";

// Minimal valid canonical-pins.json wired into a tmp repo so validateAll
// reaches the slug loop instead of bailing on the config-load step. Tests
// that care about a NON-default canonical version can pass an override.
function writeCanonicalPins(repoRoot: string, version = "1.59.2"): void {
  write(
    path.join(repoRoot, "showcase", "scripts", "showcase-canonical-pins.json"),
    JSON.stringify({ canonicalCopilotKitVersion: version, overrides: {} }),
  );
}

const isRoot = process.getuid?.() === 0;

// Some filesystems (e.g. certain CI mounts, network shares) ignore
// chmod 0000 and keep a dir readable even to non-root processes. Probe
// at module scope so the skip is visible in the test report rather than
// a silent early `return` inside `it()`.
function probeChmodEnforced(): boolean {
  if (isRoot) return false;
  let probeDir: string | undefined;
  try {
    probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-chmod-probe-"));
    fs.chmodSync(probeDir, 0o000);
    try {
      fs.readdirSync(probeDir);
      return false;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      return err.code === "EACCES";
    }
  } catch {
    return false;
  } finally {
    if (probeDir) {
      try {
        fs.chmodSync(probeDir, 0o755);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[validate-pins test] failed to restore perms on probe dir ${probeDir} (possible leak): ${msg}`,
        );
      }
      try {
        fs.rmSync(probeDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
}

const chmodEnforced = probeChmodEnforced();
const cannotEnforceEacces = isRoot || !chmodEnforced;

describe("validateAll: infra parse error routes to EXIT_UNREADABLE", () => {
  it.skipIf(cannotEnforceEacces)(
    "EACCES on showcase package dir exits 3, not 1",
    () => {
      withTmp((tmp) => {
        writeCanonicalPins(tmp);
        const slug = "mastra";
        const packagesDir = path.join(tmp, "showcase", "integrations");
        const pkgSlugDir = path.join(packagesDir, slug);
        fs.mkdirSync(pkgSlugDir, { recursive: true });
        write(
          path.join(pkgSlugDir, "package.json"),
          JSON.stringify({ name: slug, dependencies: {} }),
        );
        // Make the package dir itself unreadable so statSync on its
        // entries fails. The infra=true branch in collectDepsFromDir
        // routes through UnreadableInputError → EXIT_UNREADABLE (3).
        fs.chmodSync(pkgSlugDir, 0o000);

        try {
          const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
            env: {
              ...process.env,
              VALIDATE_PINS_REPO_ROOT: tmp,
            },
            encoding: "utf-8",
            timeout: 30_000,
          });
          expect(r.status, r.stdout + r.stderr).toBe(3);
        } finally {
          try {
            fs.chmodSync(pkgSlugDir, 0o755);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[validate-pins test] failed to restore perms on ${pkgSlugDir} (possible leak): ${msg}`,
            );
          }
        }
      });
    },
  );
});

describe("validateAll: readFileSync EACCES routes to EXIT_UNREADABLE", () => {
  it.skipIf(cannotEnforceEacces)(
    "exits 3 when a showcase package.json is statable but unreadable (mode 0000 file, readable parent)",
    () => {
      withTmp((tmp) => {
        writeCanonicalPins(tmp);
        const slug = "mastra";
        const packagesDir = path.join(tmp, "showcase", "integrations");
        const pkgSlugDir = path.join(packagesDir, slug);
        fs.mkdirSync(pkgSlugDir, { recursive: true });
        const pkgFile = path.join(pkgSlugDir, "package.json");
        write(pkgFile, JSON.stringify({ name: slug, dependencies: {} }));
        // chmod 0000 on the FILE itself (parent readable). statSync on
        // the file succeeds (metadata is in the parent dir inode), so
        // the stat guard in collectDepsFromDir passes and the error
        // surfaces from readFileSync instead. This exercises the
        // classification at the parsePackageJson catch site.
        fs.chmodSync(pkgFile, 0o000);

        try {
          const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
            env: {
              ...process.env,
              VALIDATE_PINS_REPO_ROOT: tmp,
            },
            encoding: "utf-8",
            timeout: 30_000,
          });
          expect(r.status, r.stdout + r.stderr).toBe(3);
        } finally {
          try {
            fs.chmodSync(pkgFile, 0o644);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[validate-pins test] failed to restore perms on ${pkgFile} (possible leak): ${msg}`,
            );
          }
        }
      });
    },
  );
});

describe("validateAll: readdirSync(PACKAGES_DIR) failure routes to EXIT_UNREADABLE", () => {
  it.skipIf(cannotEnforceEacces)(
    "exits 3 when PACKAGES_DIR is traverseable but not readable",
    () => {
      withTmp((tmp) => {
        writeCanonicalPins(tmp);
        const packagesDir = path.join(tmp, "showcase", "integrations");
        fs.mkdirSync(packagesDir, { recursive: true });
        // Create one slug inside so the dir isn't legitimately empty —
        // we want readdir to FAIL, not return [].
        fs.mkdirSync(path.join(packagesDir, "mastra"), { recursive: true });

        // Mode 0o111: executable (traverseable) but not readable. statSync
        // succeeds (metadata is in the parent) but readdirSync throws EACCES.
        fs.chmodSync(packagesDir, 0o111);

        try {
          const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
            env: {
              ...process.env,
              VALIDATE_PINS_REPO_ROOT: tmp,
            },
            encoding: "utf-8",
            timeout: 30_000,
          });
          expect(r.status, r.stdout + r.stderr).toBe(3);
        } finally {
          try {
            fs.chmodSync(packagesDir, 0o755);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[validate-pins test] failed to restore perms on ${packagesDir} (possible leak): ${msg}`,
            );
          }
        }
      });
    },
  );
});

describe("validateAll: missing packages dir routes to EXIT_UNREADABLE", () => {
  it("exits 3 when showcase/integrations does not exist", () => {
    withTmp((tmp) => {
      writeCanonicalPins(tmp);
      const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
        env: {
          ...process.env,
          VALIDATE_PINS_REPO_ROOT: tmp,
        },
        encoding: "utf-8",
        timeout: 30_000,
      });
      // A missing packages dir is not drift — it's a repo-structure
      // error. Must be EXIT_UNREADABLE (3), not EXIT_DRIFT (1).
      expect(r.status, r.stdout + r.stderr).toBe(3);
    });
  });
});

describe("validateAll: empty packages dir routes to EXIT_UNREADABLE", () => {
  it("exits 3 when showcase/integrations exists but contains no slugs", () => {
    withTmp((tmp) => {
      writeCanonicalPins(tmp);
      // Create showcase/integrations but leave it empty. readdir returns [].
      fs.mkdirSync(path.join(tmp, "showcase", "integrations"), {
        recursive: true,
      });
      const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
        env: {
          ...process.env,
          VALIDATE_PINS_REPO_ROOT: tmp,
        },
        encoding: "utf-8",
        timeout: 30_000,
      });
      expect(r.status, r.stdout + r.stderr).toBe(3);
    });
  });
});

describe("validateAll: missing canonical-pins config routes to EXIT_UNREADABLE", () => {
  it("exits 3 when showcase-canonical-pins.json is not present", () => {
    withTmp((tmp) => {
      // Deliberately do NOT write canonical-pins. Create the packages
      // dir so the early packages-dir guard doesn't fire first.
      fs.mkdirSync(path.join(tmp, "showcase", "integrations"), {
        recursive: true,
      });
      const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
        env: {
          ...process.env,
          VALIDATE_PINS_REPO_ROOT: tmp,
        },
        encoding: "utf-8",
        timeout: 30_000,
      });
      // Missing config is a repo-structure / configuration problem,
      // same class as a missing packages dir → EXIT_UNREADABLE (3).
      expect(r.status, r.stdout + r.stderr).toBe(3);
    });
  });
});
