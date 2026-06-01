/**
 * Parity test: every `agent="..."` literal used by a demo page under
 * `src/app/demos/**\/page.tsx` MUST appear in the exported `demoAgentNames`
 * registry in `src/app/api/copilotkit/route.ts`. Otherwise the runtime will
 * return agent-not-found errors for that demo at runtime.
 *
 * This test is skip-safe: it only asserts what it can actually find. If the
 * demos directory doesn't exist (e.g. in a stripped-down test checkout) the
 * test is a no-op. If a page.tsx doesn't reference CopilotKit at all, it's
 * ignored.
 *
 * Well-known excludes: none today. Add here if some demo intentionally uses
 * an agent name that is NOT in `demoAgentNames` (e.g. a demo that talks to a
 * different backend directly). Each entry needs a justification comment.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Stubs so importing route.ts doesn't pull real Next.js / Mastra runtimes
// into the test environment. We only need the exported constant
// `demoAgentNames` — the side-effectful module code is benign under stubs.
vi.mock("@/mastra", () => ({ mastra: { __stub: "mastra" } }));
vi.mock("@ag-ui/mastra", () => ({
  MastraAgent: { getLocalAgents: vi.fn() },
  getLocalAgent: vi.fn(),
}));
vi.mock("@copilotkit/runtime", () => ({
  CopilotRuntime: vi.fn(),
  ExperimentalEmptyAdapter: vi.fn(),
  copilotRuntimeNextJSAppRouterEndpoint: vi.fn(() => ({
    handleRequest: vi.fn(async () => new Response("ok")),
  })),
}));
vi.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));

import { demoAgentNames } from "../../src/app/api/copilotkit/route";

const DEMOS_DIR = path.resolve(__dirname, "../../src/app/demos");

// Agent names that appear in demo page.tsx files but intentionally do NOT
// need to be registered in `demoAgentNames` (e.g. demos that talk to a
// different backend). Keep empty unless you have a reason; add the reason.
const WELL_KNOWN_EXCLUDES = new Set<string>([
  // The auth demo points at `/api/copilotkit-auth` (a separate route with
  // its own runtime + agent map), not `/api/copilotkit`. Its agent name
  // therefore does not — and must not — appear in the main `demoAgentNames`
  // registry, which gates the `/api/copilotkit` route.
  "auth-demo",
  // The mcp-apps demo points at `/api/copilotkit-mcp-apps` (its own route
  // with `mcpApps.servers` config). Its agent name lives in that route, not
  // in the main `demoAgentNames` registry.
  "mcp-apps",
]);

function dirExists(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function listDemoDirs(root: string): string[] {
  if (!dirExists(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(root, d.name));
}

/** Extract every unique `agent="..."` literal from a .tsx file. */
function extractAgentNames(tsxSource: string): string[] {
  const names = new Set<string>();
  // Matches agent="..." and agent={"..."} style literals.
  const re = /\bagent\s*=\s*\{?\s*["']([^"']+)["']\s*\}?/g;
  for (const m of tsxSource.matchAll(re)) {
    names.add(m[1]);
  }
  return [...names];
}

describe("demoAgentNames parity with src/app/demos/", () => {
  const demoDirs = listDemoDirs(DEMOS_DIR);

  if (demoDirs.length === 0) {
    it.skip("no demos directory — skipping parity check", () => {});
    return;
  }

  it("every agent name referenced by a demo page is registered", () => {
    const registry = new Set<string>(demoAgentNames);
    const missing: { demoDir: string; agentName: string }[] = [];
    let pagesChecked = 0;

    for (const demoDir of demoDirs) {
      const pagePath = path.join(demoDir, "page.tsx");
      let source: string;
      try {
        source = readFileSync(pagePath, "utf8");
      } catch {
        // No page.tsx in this demo dir; skip.
        continue;
      }
      pagesChecked += 1;

      const referenced = extractAgentNames(source);
      for (const name of referenced) {
        if (WELL_KNOWN_EXCLUDES.has(name)) continue;
        if (!registry.has(name)) {
          missing.push({ demoDir: path.basename(demoDir), agentName: name });
        }
      }
    }

    expect(pagesChecked).toBeGreaterThan(0);
    expect(
      missing,
      `Demo pages reference agent names not present in demoAgentNames. ` +
        `Add them to demoAgentNames in route.ts (or to WELL_KNOWN_EXCLUDES with ` +
        `a comment if intentional): ${JSON.stringify(missing)}`,
    ).toEqual([]);
  });
});
