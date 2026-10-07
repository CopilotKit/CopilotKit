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
});
