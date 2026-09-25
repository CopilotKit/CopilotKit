import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { docCandidateOrder, FRAMEWORK_WINS_SLUGS } from "../docs-render";

const FOLDER = "langgraph";

describe("docCandidateOrder", () => {
  it("gives an authored framework its own file first", () => {
    expect(docCandidateOrder("authored", FOLDER, "auth")).toEqual([
      `integrations/${FOLDER}/auth`,
      "auth",
    ]);
  });

  it("gives a generated framework the ROOT file first", () => {
    // This is the bug the shared helper exists to prevent: the metadata
    // resolver used to load the framework file here unconditionally, so a
    // generated page served root BODY under framework TITLE/DESCRIPTION.
    expect(docCandidateOrder("generated", FOLDER, "auth")).toEqual([
      "auth",
      `integrations/${FOLDER}/auth`,
    ]);
  });

  it.each([...FRAMEWORK_WINS_SLUGS])(
    "gives the framework file precedence for %s even when generated",
    (slug) => {
      expect(docCandidateOrder("generated", FOLDER, slug)).toEqual([
        `integrations/${FOLDER}/${slug}`,
        slug,
      ]);
    },
  );

  it("keeps threads-import in the framework-wins set", () => {
    // llms-mdx special-cased only `quickstart`, so raw Markdown disagreed with
    // the rendered page for /<framework>/threads-import.
    expect(FRAMEWORK_WINS_SLUGS.has("threads-import")).toBe(true);
    expect(FRAMEWORK_WINS_SLUGS.has("quickstart")).toBe(true);
  });
});

describe("every framework-scoped resolver uses the shared order", () => {
  // Guards against a FOURTH divergent copy. Each of these files previously
  // carried its own ordering logic and two of them had drifted.
  const callSites = [
    "src/app/[framework]/[[...slug]]/page.tsx",
    "src/app/llms-mdx/[[...slug]]/route.ts",
  ];

  it.each(callSites)("%s calls docCandidateOrder", (file) => {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    expect(source).toContain("docCandidateOrder(");
  });

  it("page.tsx resolves metadata and body through it, not ad hoc", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), callSites[0]),
      "utf8",
    );
    // Two call sites in this file: generateMetadata and the body resolver.
    expect(source.match(/docCandidateOrder\(/g)?.length).toBe(2);
    // The pre-fix shape must not come back.
    expect(source).not.toContain("frameworkScopedDoc");
  });
});
