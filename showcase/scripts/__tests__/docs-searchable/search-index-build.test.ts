import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Before lib/docs-searchable: it reads shell-docs relative to the cwd.
import { SHELL_DOCS_DATA, SHELL_DOCS_ROOT } from "./shell-docs-cwd";

import { isRouteGroupSegment } from "../../lib/docs-searchable/route-groups";
import {
  canonicalDocsSlug,
  getSearchablePages,
} from "../../lib/docs-searchable/searchable-pages";
import { SCRIPTS_DIR } from "../paths";

/**
 * The build contract behind docs search, ported from shell-docs'
 * search-index-build-contract and search-index-navigability tests.
 *
 * `generate-search-index.ts` decides which docs pages a reader can reach by
 * running lib/docs-searchable/emit-searchable-pages.ts as a subprocess, with
 * shell-docs as its working directory. The showcase shell image stages only
 * `showcase/scripts` (npm-installed), `shell-docs/src/content` and the
 * registry generate-registry writes (showcase/shell/Dockerfile), and its
 * header search links across to the docs. It once staged the content tree
 * and nothing else, and the showcase app's index went from 678 docs rows to
 * zero while the build stayed green on a warning. These tests run the real
 * generator in a tree staged the same way, outside the repo, so a Dockerfile
 * or dependency change that breaks it fails here first.
 */

const SHOWCASE_ROOT = path.resolve(SCRIPTS_DIR, "..");
const SCRIPTS_MODULES = path.join(SCRIPTS_DIR, "node_modules");
const SHOWCASE_HOST_DESTINATIONS = ["/", "/integrations", "/matrix"];
const staged: string[] = [];

afterAll(() => {
  for (const dir of staged.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A showcase tree with the generator and only showcase/scripts' dependencies:
 * no shell-docs install, package.json or tsconfig.
 */
function stageShowcase(contentRoots: Array<"docs" | "reference">): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "search-index-build-"));
  staged.push(root);
  const scripts = path.join(root, "scripts");
  fs.mkdirSync(scripts);
  for (const file of ["generate-search-index.ts", "package.json"]) {
    fs.copyFileSync(path.join(SCRIPTS_DIR, file), path.join(scripts, file));
  }
  fs.cpSync(path.join(SCRIPTS_DIR, "lib"), path.join(scripts, "lib"), {
    recursive: true,
  });
  fs.symlinkSync(SCRIPTS_MODULES, path.join(scripts, "node_modules"));
  fs.symlinkSync(path.join(SHOWCASE_ROOT, "shared"), path.join(root, "shared"));
  const content = path.join(root, "shell-docs/src/content");
  fs.mkdirSync(content, { recursive: true });
  for (const name of contentRoots) {
    fs.symlinkSync(
      path.join(SHELL_DOCS_ROOT, "src/content", name),
      path.join(content, name),
    );
  }
  const data = path.join(root, "shell-docs/src/data");
  fs.mkdirSync(data, { recursive: true });
  for (const file of ["registry.json", "frontend-registry.json"]) {
    fs.copyFileSync(path.join(SHELL_DOCS_DATA, file), path.join(data, file));
  }
  return root;
}

function runGenerator(root: string) {
  return spawnSync(
    process.execPath,
    [
      path.join(SCRIPTS_MODULES, "tsx/dist/cli.mjs"),
      path.join(root, "scripts/generate-search-index.ts"),
    ],
    {
      encoding: "utf8",
      timeout: 60_000,
      // Only what a Docker build has: no inherited NODE_PATH.
      env: { ...process.env, NODE_PATH: "" },
    },
  );
}

interface SearchEntry {
  type: string;
  title: string;
  href: string;
}

const readIndex = (root: string, app: "shell" | "shell-docs") =>
  JSON.parse(
    fs.readFileSync(path.join(root, app, "src/data/search-index.json"), "utf8"),
  ) as SearchEntry[];

const docsRows = (entries: SearchEntry[]) =>
  entries.filter((entry) => entry.href.startsWith("/docs"));

describe("search index built with only showcase/scripts installed", () => {
  let root = "";
  let docsIndex: SearchEntry[] = [];
  let showcaseIndex: SearchEntry[] = [];

  beforeAll(() => {
    root = stageShowcase(["docs", "reference"]);
    const result = runGenerator(root);
    expect(result.status, result.stderr).toBe(0);
    docsIndex = readIndex(root, "shell-docs");
    showcaseIndex = readIndex(root, "shell");
  }, 90_000);

  it("emits the reachable docs into the showcase app's index", () => {
    expect(docsRows(showcaseIndex).length).toBeGreaterThan(0);
    expect(showcaseIndex.map((entry) => entry.href)).toContain(
      "/docs/human-in-the-loop",
    );
  });

  it("offers no destination that would take a redirect hop", () => {
    const withRouteGroup = docsIndex.filter((entry) =>
      entry.href.split("/").some(isRouteGroupSegment),
    );
    expect(withRouteGroup.map((entry) => entry.href)).toEqual([]);
  });

  it("never sends two rows to the same place", () => {
    const seen = new Map<string, number>();
    for (const entry of docsIndex) {
      seen.set(entry.href, (seen.get(entry.href) ?? 0) + 1);
    }
    expect(
      [...seen].filter(([, count]) => count > 1).map(([href]) => href),
    ).toEqual([]);
  });

  it("keeps one entry for Vue's docs guide at its canonical route", () => {
    const entries = docsIndex.filter(
      (entry) => entry.href === "/vue/using-these-docs",
    );
    expect(entries).toHaveLength(1);
    // The shared frontends/docs-status page is gone; Vue's own
    // frontends/vue/using-these-docs page is the row now.
    expect(entries[0]?.title).toBe("Using these docs");
  });

  it("leaves the docs for no showcase-host destination", () => {
    expect(
      docsIndex
        .filter((entry) => SHOWCASE_HOST_DESTINATIONS.includes(entry.href))
        .map((entry) => entry.href),
    ).toEqual([]);
  });

  it("offers only docs pages a reader can reach from some sidebar", () => {
    const searchable = getSearchablePages();
    const unreachable = docsRows(docsIndex)
      // Channel guides are index keys the shell re-routes onto Slack and
      // Teams, not docs-navigation destinations.
      .filter(
        (entry) =>
          entry.href !== "/docs/channels" &&
          !entry.href.startsWith("/docs/channels/"),
      )
      .filter((entry) => !searchable.slugs.has(canonicalDocsSlug(entry.href)));
    expect(unreachable.map((entry) => entry.href)).toEqual([]);
  });
});

describe("partially staged content", () => {
  it.each([["reference"], ["docs"]] as const)(
    "rejects a build containing only %j before writing either index",
    (only) => {
      const root = stageShowcase([only]);
      for (const app of ["shell-docs", "shell"]) {
        const data = path.join(root, app, "src/data");
        fs.mkdirSync(data, { recursive: true });
        fs.writeFileSync(path.join(data, "search-index.json"), "existing");
      }
      const result = runGenerator(root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("incomplete content tree");
      for (const app of ["shell-docs", "shell"]) {
        expect(
          fs.readFileSync(
            path.join(root, app, "src/data/search-index.json"),
            "utf8",
          ),
        ).toBe("existing");
      }
    },
  );
});
