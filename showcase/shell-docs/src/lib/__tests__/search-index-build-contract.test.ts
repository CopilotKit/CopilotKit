import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

/**
 * Guards the build contract behind the docs-search reachability filter.
 *
 * `generate-search-index.ts` lives in `showcase/scripts` but delegates the
 * "can a reader reach this page?" decision to shell-docs, which it runs as a
 * subprocess. Any app whose build stages the shell-docs CONTENT tree also
 * consumes docs rows, so it must stage what that subprocess needs — or its
 * search loses every docs row.
 *
 * That is not hypothetical. `showcase/shell/Dockerfile` staged the content
 * tree and nothing else, so the showcase app's index went from 678 docs rows
 * to zero while the build stayed green on a warning. The generator now fails
 * loudly instead, and this test states the contract where a future Dockerfile
 * edit will trip over it rather than discovering it in a deployed image.
 */

const SHOWCASE_ROOT = path.resolve(process.cwd(), "..");
const CONTENT_COPY = "showcase/shell-docs/src/content/";

/** Every `showcase/*\/Dockerfile` in the repo. */
function dockerfiles(): { app: string; path: string; source: string }[] {
  return fs
    .readdirSync(SHOWCASE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      app: entry.name,
      path: path.join(SHOWCASE_ROOT, entry.name, "Dockerfile"),
    }))
    .filter((candidate) => fs.existsSync(candidate.path))
    .map((candidate) => ({
      ...candidate,
      source: fs.readFileSync(candidate.path, "utf-8"),
    }));
}

describe("docs-search build contract", () => {
  const files = dockerfiles();

  it("finds Dockerfiles to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [file.app, file] as const))(
    "%s: staging docs content also stages the reachability toolchain",
    (_app, file) => {
      // Only builds that stage the docs content AND generate the search
      // index are bound by this. shell-docs' own image copies its whole
      // tree, so the content marker is absent there; shell-dashboard stages
      // the content for `probe-docs.ts` alone and never builds an index.
      if (!file.source.includes(CONTENT_COPY)) return;
      if (!file.source.includes("generate-search-index")) return;

      // The emit script, the library it imports, and the tsconfig that
      // resolves shell-docs' `@/…` alias.
      expect(file.source).toContain("showcase/shell-docs/src/lib/");
      expect(file.source).toContain("showcase/shell-docs/scripts/");
      expect(file.source).toContain("showcase/shell-docs/tsconfig.json");

      // No shell-docs install is required: the generator puts its own
      // node_modules on the child's NODE_PATH. What the image must carry is
      // the scripts install itself, which every such build already has
      // because the generator runs from there.
      expect(file.source).toMatch(/COPY showcase\/scripts\//);
    },
  );

  it("the emit script and its entry point exist where the contract says", () => {
    expect(
      fs.existsSync(
        path.join(process.cwd(), "scripts/emit-searchable-pages.ts"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(process.cwd(), "src/lib/searchable-pages.ts")),
    ).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "tsconfig.json"))).toBe(true);
  });

  it("declares gray-matter where the subprocess can resolve it", () => {
    // The shell image symlinks shell-docs/node_modules at the scripts
    // install, so `gray-matter` has to be a scripts dependency too — not
    // only a shell-docs one.
    const scriptsPkg = JSON.parse(
      fs.readFileSync(
        path.join(SHOWCASE_ROOT, "scripts/package.json"),
        "utf-8",
      ),
    ) as { dependencies?: Record<string, string> };
    expect(scriptsPkg.dependencies?.["gray-matter"]).toBeTruthy();
  });
});
