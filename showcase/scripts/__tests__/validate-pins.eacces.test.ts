// Split from validate-pins.test.ts — see validate-pins.shared.ts header
// for the full rationale (vitest birpc 60s cliff, fork-per-file).

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

// ---------------------------------------------------------------------------
// FX16-A: EACCES on example dir → EXIT_UNREADABLE (3), not EXIT_INTERNAL (2).
// Runs the validate-pins CLI end-to-end against a tmp REPO_ROOT where
// the examples/integrations/<slug>/ directory is unreadable (mode 0000).
// Skipped on CI platforms where the process runs as root (chmod has no
// effect) — detected by attempting to read a 0000 dir we create.
// ---------------------------------------------------------------------------

// Root cannot be restricted by chmod — EACCES routing can't be
// exercised when the process is uid 0. We skip at declaration time so
// the skip is VISIBLE in the test report rather than a silent early
// `return` (which makes the guard look like it always passes).
const isRoot = process.getuid?.() === 0;

// Some filesystems (e.g. certain CI mounts, network shares) ignore
// chmod 0000 and keep a dir readable even to non-root processes. We
// must NOT silently `return` from inside `it()` on those platforms —
// the test would then "pass" without exercising the EACCES routing
// under test (anti-pattern called out on lines immediately above this
// comment). Probe once at module scope and hand the result to
// `it.skipIf` so the skip is visible in the test report.
//
// The probe: create a tmp dir, chmod it 0000, then attempt to read it.
// If the read succeeds (or fails with something other than EACCES),
// chmod is not enforced here. We do the probe even when `isRoot` is
// true (the two conditions are OR'd into `cannotEnforceEacces`).
function probeChmodEnforced(): boolean {
  if (isRoot) return false;
  let probeDir: string | undefined;
  try {
    probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-chmod-probe-"));
    fs.chmodSync(probeDir, 0o000);
    try {
      // statSync on the dir itself may still work (metadata is in the
      // parent). The enforcement check is whether readdir is blocked.
      fs.readdirSync(probeDir);
      return false; // readdir succeeded → chmod not enforced
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
        // Visible stderr log on leak — operators must see tmpdirs that
        // may linger at mode 0000 (rmSync would fail silently and the
        // dir stays forever).
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
describe("EACCES on examples/integrations/<slug> routes to EXIT_UNREADABLE", () => {
  it.skipIf(cannotEnforceEacces)(
    "exits with EXIT_UNREADABLE (3) when candidate example dir is unreadable",
    () => {
      withTmp((tmp) => {
        // Build a minimal repo layout:
        //   <tmp>/examples/integrations/<slug>/     (mode 0000)
        //   <tmp>/showcase/integrations/<slug>/package.json
        const slug = "mastra";
        const examplesDir = path.join(tmp, "examples", "integrations");
        const packagesDir = path.join(tmp, "showcase", "integrations");
        const exampleSlugDir = path.join(examplesDir, slug);
        const pkgSlugDir = path.join(packagesDir, slug);
        fs.mkdirSync(exampleSlugDir, { recursive: true });
        fs.mkdirSync(pkgSlugDir, { recursive: true });
        write(
          path.join(pkgSlugDir, "package.json"),
          JSON.stringify({ name: slug, dependencies: {} }),
        );

        // Make example slug dir unreadable. The module-scope probe
        // (`cannotEnforceEacces`) already confirmed the FS enforces
        // chmod 0000 for this process, so we don't need a second
        // in-body probe + silent-return dance here.
        fs.chmodSync(exampleSlugDir, 0o000);

        try {
          const r = spawnSync("npx", ["tsx", VALIDATE_PINS_SCRIPT], {
            env: {
              ...process.env,
              VALIDATE_PINS_REPO_ROOT: tmp,
            },
            encoding: "utf-8",
            timeout: 30_000,
          });
          // EXIT_UNREADABLE = 3. Must NOT be 2 (EXIT_INTERNAL) or 1
          // (EXIT_DRIFT). A successful routing yields 3.
          expect(r.status, r.stdout + r.stderr).toBe(3);
        } finally {
          // Restore perms so the rmSync in withTmp works on Linux.
          // Log to stderr if restore fails — otherwise the tmp dir
          // leaks at mode 0000 and operators never see it.
          try {
            fs.chmodSync(exampleSlugDir, 0o755);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[validate-pins test] failed to restore perms on ${exampleSlugDir} (possible leak): ${msg}`,
            );
          }
        }
      });
    },
  );
});
describe("validateAll: infra parse error routes to EXIT_UNREADABLE", () => {
  it.skipIf(cannotEnforceEacces)(
    "EACCES on showcase package dir exits 3, not 1",
    () => {
      withTmp((tmp) => {
        const slug = "mastra";
        // Build a minimal repo layout where the example dir is fine but
        // the SHOWCASE PACKAGE DIR is unreadable. We chmod the parent
        // dir (not the file) because on Linux/macOS, statSync on your
        // own mode-0000 file succeeds (metadata is still accessible via
        // the parent dir). Chmodding the parent forces statSync(abs) in
        // collectDepsFromDir to throw EACCES, which hits the `infra:
        // true` branch → UnreadableInputError → EXIT_UNREADABLE (3).
        // The prior version of this test chmod'd the file, which routed
        // through readFileSync EACCES → parseErrors (not infra) →
        // EXIT_DRIFT (1), and then the assertion accepted [1, 3] which
        // defeated the fix it was meant to guard.
        const examplesDir = path.join(tmp, "examples", "integrations");
        const packagesDir = path.join(tmp, "showcase", "integrations");
        const exampleSlugDir = path.join(examplesDir, slug);
        const pkgSlugDir = path.join(packagesDir, slug);
        fs.mkdirSync(exampleSlugDir, { recursive: true });
        fs.mkdirSync(pkgSlugDir, { recursive: true });
        write(
          path.join(exampleSlugDir, "package.json"),
          JSON.stringify({ name: slug, dependencies: {} }),
        );
        write(
          path.join(pkgSlugDir, "package.json"),
          JSON.stringify({ name: slug, dependencies: {} }),
        );
        // Make the package dir itself unreadable so statSync on its
        // entries fails. Module-scope probe (`cannotEnforceEacces`)
        // already confirmed the FS enforces chmod 0000 here.
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
          // STRICT: the fix is that EACCES on a showcase dep-file path
          // routes to EXIT_UNREADABLE (3), not EXIT_DRIFT (1) or
          // EXIT_INTERNAL (2). Accepting [1, 3] defeats the fix.
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
        const slug = "mastra";
        const examplesDir = path.join(tmp, "examples", "integrations");
        const packagesDir = path.join(tmp, "showcase", "integrations");
        const exampleSlugDir = path.join(examplesDir, slug);
        const pkgSlugDir = path.join(packagesDir, slug);
        fs.mkdirSync(exampleSlugDir, { recursive: true });
        fs.mkdirSync(pkgSlugDir, { recursive: true });
        write(
          path.join(exampleSlugDir, "package.json"),
          JSON.stringify({ name: slug, dependencies: {} }),
        );
        const pkgFile = path.join(pkgSlugDir, "package.json");
        write(pkgFile, JSON.stringify({ name: slug, dependencies: {} }));

        // Mode-0000 on the FILE with a normal-mode parent: statSync on
        // the file succeeds (metadata is in the parent dir inode),
        // so the stat guard in collectDepsFromDir passes and the
        // error surfaces from readFileSync instead. This specifically
        // exercises the classification fix at the parsePackageJson
        // catch site — an EACCES here used to route to EXIT_DRIFT (1)
        // because `infra: true` was not set.
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
          // Must be EXIT_UNREADABLE (3), NOT EXIT_DRIFT (1).
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
        const packagesDir = path.join(tmp, "showcase", "integrations");
        const examplesDir = path.join(tmp, "examples", "integrations");
        fs.mkdirSync(packagesDir, { recursive: true });
        fs.mkdirSync(examplesDir, { recursive: true });
        // Create one slug inside so the dir isn't legitimately empty —
        // we want readdir to FAIL, not return [].
        fs.mkdirSync(path.join(packagesDir, "mastra"), { recursive: true });

        // Mode 0o111: executable (traverseable) but not readable. On
        // platforms that enforce chmod for non-root, statSync succeeds
        // (metadata is in the parent) but readdirSync throws EACCES.
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
          // Must be EXIT_UNREADABLE (3), NOT EXIT_INTERNAL (2) which
          // is the pre-fix behaviour (unwrapped readdir error
          // propagating to the generic top-level catch).
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
      // Deliberately do NOT create showcase/integrations. examples/integrations
      // exists so paths() resolves cleanly to its usual shape.
      fs.mkdirSync(path.join(tmp, "examples", "integrations"), {
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
      // Must be EXIT_UNREADABLE (3), NOT EXIT_DRIFT (1). A missing
      // packages dir is not drift — it's a repo-structure error.
      expect(r.status, r.stdout + r.stderr).toBe(3);
    });
  });
});
describe("validateAll: empty packages dir routes to EXIT_UNREADABLE", () => {
  it("exits 3 when showcase/integrations exists but contains no slugs", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "examples", "integrations"), {
        recursive: true,
      });
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
      // Empty-dir is the same class of error as missing. Classing it
      // as EXIT_UNREADABLE (3) keeps report.fail (EXIT_DRIFT, 1)
      // reserved for real drift findings.
      expect(r.status, r.stdout + r.stderr).toBe(3);
    });
  });
});
