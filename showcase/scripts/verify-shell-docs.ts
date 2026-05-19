import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// showcase/scripts/ → showcase/ → repo root. Different from
// validate-parity.ts (which stops at showcase/) because `nx build shell-docs`
// must run from the monorepo root.
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export type CheckStatus = "pass" | "fail" | "skipped";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  messages: string[];
}

export interface BuildCheckOptions {
  skipExecution?: boolean;
}

export function runBuildCheck(opts: BuildCheckOptions = {}): CheckResult {
  if (opts.skipExecution) {
    return {
      name: "nx-build-shell-docs",
      status: "skipped",
      messages: ["skipExecution=true; no build run"],
    };
  }
  const out = spawnSync("npx", ["nx", "build", "shell-docs"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  if (out.status === 0) {
    return { name: "nx-build-shell-docs", status: "pass", messages: [] };
  }
  return {
    name: "nx-build-shell-docs",
    status: "fail",
    messages: [out.stdout || "", out.stderr || ""].filter(Boolean),
  };
}
