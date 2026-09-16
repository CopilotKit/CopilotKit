import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const CONTENT_DIR = path.resolve(import.meta.dirname, "../../content");

/**
 * The wiring page published by OSS-881. Any page that configures a runtime with
 * `intelligence` but never builds the client has to send the reader here.
 */
const WIRING_PAGE = "/intelligence/connect-your-runtime";

const TS_FENCE = /```(?:ts|typescript|tsx)[^\n]*\n([\s\S]*?)```/g;

/** `intelligence` used as a `CopilotRuntime` option, not as prose or a URL. */
const INTELLIGENCE_OPTION = /^\s*intelligence[,:]/m;
const INTELLIGENCE_CONSTRUCTED = /new\s+CopilotKitIntelligence\s*\(/;

/** The v1 root entrypoint. Its `CopilotRuntime` has no `intelligence` option. */
const V1_RUNTIME_IMPORT = /from\s+["']@copilotkit\/runtime["']/;

function mdxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdxFiles(full));
    else if (entry.name.endsWith(".mdx")) out.push(full);
  }
  return out;
}

/** Pages whose TypeScript examples pass `intelligence` to a runtime. */
function pagesConfiguringIntelligence(): {
  relativePath: string;
  source: string;
  fences: string[];
}[] {
  return mdxFiles(CONTENT_DIR)
    .map((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      const fences = [...source.matchAll(TS_FENCE)]
        .map((match) => match[1])
        .filter((body) => INTELLIGENCE_OPTION.test(body));
      return {
        relativePath: path.relative(CONTENT_DIR, filePath),
        source,
        fences,
      };
    })
    .filter((page) => page.fences.length > 0);
}

describe("docs that configure a runtime with Intelligence", () => {
  // Guards the OSS-900 defect class: a page names `intelligence` as a runtime
  // option and leaves the reader with no way to find out what produces it. An
  // onboarding run hit exactly this on the Mastra route and stopped rather than
  // invent a constructor.
  test("either build the client or link to the page that does", () => {
    const orphaned = pagesConfiguringIntelligence()
      .filter(
        (page) =>
          !INTELLIGENCE_CONSTRUCTED.test(page.source) &&
          !page.source.includes(WIRING_PAGE),
      )
      .map((page) => page.relativePath);

    expect(orphaned).toEqual([]);
  });

  // The v2 `intelligence` option does not exist on the v1 root export, so an
  // example that imports from `@copilotkit/runtime` cannot compile as written.
  test("import the runtime from the v2 entrypoint", () => {
    const v1Imports = pagesConfiguringIntelligence()
      .filter((page) =>
        page.fences.some((body) => V1_RUNTIME_IMPORT.test(body)),
      )
      .map((page) => page.relativePath);

    expect(v1Imports).toEqual([]);
  });

  // Copy-pasting a runtime with `intelligence` but no `identifyUser` produces a
  // type error, and — if it were forced through — one shared thread history for
  // every visitor. Channels-only runtimes are the documented exception.
  test("pair Intelligence with a user identity", () => {
    const missingIdentity = pagesConfiguringIntelligence()
      .flatMap((page) =>
        page.fences.map((body) => ({ page: page.relativePath, body })),
      )
      .filter(
        ({ body }) =>
          !/identifyUser/.test(body) && !/^\s*channels[,:]/m.test(body),
      )
      .map(({ page }) => page);

    expect(missingIdentity).toEqual([]);
  });
});
