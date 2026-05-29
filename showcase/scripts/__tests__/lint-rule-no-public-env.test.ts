import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

// Repo root is two directories above this test file
// (showcase/scripts/__tests__/X -> showcase/scripts -> showcase -> <repo>).
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const CONFIG_PATH = join(REPO_ROOT, ".oxlintrc.json");

describe("oxlint copilotkit/no-public-env-shell-read NEXT_PUBLIC_* guard", () => {
    it("fires on direct process.env.NEXT_PUBLIC_POCKETBASE_URL read in shell code", () => {
        // Stage a forbidden file inside the actual repo path so the
        // override `files` pattern matches. We use a `.lintfixture.tsx`
        // suffix that the off-override (which excludes `*.test.{ts,tsx}` /
        // `*.spec.{ts,tsx}` / `*runtime-config*`) does NOT match.
        const target = join(
            REPO_ROOT,
            "showcase",
            "shell-dashboard",
            "src",
            "lib",
            "__bad.lintfixture.tsx",
        );
        writeFileSync(
            target,
            `export const x = process.env.NEXT_PUBLIC_POCKETBASE_URL;\n`,
            "utf8",
        );
        try {
            // Use an explicit -c to pin the config: in git worktrees nested
            // under .claude/worktrees/, oxlint's automatic upward config
            // search may resolve to a different .oxlintrc.json than the
            // worktree's own. Pinning it makes the test deterministic.
            const result = execSync(
                `npx oxlint -c ${CONFIG_PATH} ${target} --quiet`,
                { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: REPO_ROOT },
            ).toString();
            // Should not reach here — oxlint exits non-zero on errors.
            expect(result).toBe("UNREACHABLE: oxlint should have failed");
        } catch (e) {
            const stderr = (e as { stderr?: Buffer | string }).stderr?.toString() ?? "";
            const stdout = (e as { stdout?: Buffer | string }).stdout?.toString() ?? "";
            const combined = stderr + stdout;
            expect(combined).toMatch(/no-public-env-shell-read/);
            expect(combined).toMatch(/getRuntimeConfig/);
        } finally {
            rmSync(target, { force: true });
        }
    });

    it("does NOT fire on process.env.NEXT_PUBLIC_COMMIT_SHA (build-stamp, intentionally allowed)", () => {
        const target = join(
            REPO_ROOT,
            "showcase",
            "shell-dashboard",
            "src",
            "lib",
            "__ok.lintfixture.tsx",
        );
        writeFileSync(
            target,
            `export const sha = process.env.NEXT_PUBLIC_COMMIT_SHA;\n`,
            "utf8",
        );
        try {
            // Should succeed (exit 0).
            execSync(`npx oxlint -c ${CONFIG_PATH} ${target} --quiet`, {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                cwd: REPO_ROOT,
            });
        } finally {
            rmSync(target, { force: true });
        }
    });
});
