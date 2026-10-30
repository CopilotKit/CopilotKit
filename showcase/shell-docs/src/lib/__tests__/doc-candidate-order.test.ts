import { describe, expect, it } from "vitest";
import { docCandidateOrder, FRAMEWORK_WINS_SLUGS } from "../docs-render";
import { frontendAwareDocCandidateOrder } from "../frontend-doc-policy";

const FOLDER = "langgraph";

describe("frontend-aware document resolution", () => {
  it("prefers an existing Vue variant over backend-authored content", () => {
    expect(
      frontendAwareDocCandidateOrder(
        "vue",
        "authored",
        FOLDER,
        "generative-ui/tool-rendering",
      ),
    ).toEqual([
      "frontends/vue/generative-ui/tool-rendering",
      `integrations/${FOLDER}/generative-ui/tool-rendering`,
      "generative-ui/tool-rendering",
    ]);
  });

  it("preserves backend ordering when no Vue variant exists", () => {
    expect(
      frontendAwareDocCandidateOrder("vue", "generated", FOLDER, "auth"),
    ).toEqual(["auth", `integrations/${FOLDER}/auth`]);
  });
});

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
