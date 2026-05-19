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

interface RegistryDemo {
  id: string;
}
interface RegistryIntegrationLite {
  slug: string;
  demos: RegistryDemo[];
}
interface RegistryLite {
  integrations: RegistryIntegrationLite[];
}

interface PageInput {
  path: string;
  body: string;
}

const INLINE_DEMO_RE = /<InlineDemo\s+[^>]*demo=["']([^"']+)["']/g;

export function checkInlineDemoRefs(input: {
  pages: PageInput[];
  registry: RegistryLite;
}): CheckResult {
  const known = new Set<string>();
  for (const i of input.registry.integrations) {
    for (const d of i.demos) {
      known.add(d.id);
    }
  }

  const failures: string[] = [];
  for (const page of input.pages) {
    INLINE_DEMO_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_DEMO_RE.exec(page.body)) !== null) {
      if (!known.has(m[1])) {
        failures.push(`${page.path}: unknown demo id "${m[1]}"`);
      }
    }
  }

  return {
    name: "inline-demo-refs",
    status: failures.length === 0 ? "pass" : "fail",
    messages: failures,
  };
}
