// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolvePythonSource } from "../../../scripts/compatibility-audit/sources/python";
import type { LibraryMapping } from "../../../scripts/compatibility-audit/types";

const path = "showcase/integrations/example/requirements.txt";
const library: LibraryMapping = {
  name: "My_Project",
  registry: "pypi",
  role: "framework",
  required: true,
  reason: "framework dependency",
  source: { kind: "requirements", path },
  releasePolicy: "stable",
};

function resolve(contents: string) {
  return resolvePythonSource(library, (requested) => {
    expect(requested).toBe(path);
    return contents;
  });
}

describe("Python requirements source facts", () => {
  it("accepts canonical names, extras, inline comments and repeated identical exact pins", () => {
    expect(
      resolve(
        "other==9\nmy.project[tools,ui] == 1.2.3 # retained\nMY-PROJECT==1.2.3\n",
      ),
    ).toEqual({
      version: "1.2.3",
      basis: "source-declared",
      evidence: [path],
      reason: expect.any(String),
    });
  });

  it.each([
    ["My-Project>=1.2", /range|exact/i],
    ["my_project==1.*", /wildcard|exact/i],
    ["my-project", /unpinned|exact/i],
    ["my-project==1.2; python_version<'3.12'", /conditional|marker/i],
    ["my-project @ https://example.org/pkg.whl", /URL|direct/i],
    ["git+https://example.org/repo#egg=my_project", /URL|direct/i],
    ["-e git+https://example.org/repo#egg=my_project", /editable|URL/i],
    ["my-project==1.0\nmy_project==2.0", /conflict/i],
    ["my-project==1.0\nmy_project>=2", /exact|range/i],
  ])("marks ambiguous declaration unknown: %s", (contents, reason) => {
    expect(resolve(contents)).toMatchObject({
      version: null,
      basis: "unknown",
      evidence: [path],
      reason: expect.stringMatching(reason),
    });
  });

  it("ignores unrelated names and reports an absent mapped declaration", () => {
    expect(
      resolve("other==1\n# my-project==5\nmy-project-extra==2\n"),
    ).toMatchObject({
      version: null,
      basis: "unknown",
      evidence: [path],
      reason: expect.stringMatching(/absent|missing/i),
    });
  });

  it("does not infer absence through another requirements file", () => {
    expect(resolve("-r other-requirements.txt\nother==1")).toMatchObject({
      version: null,
      basis: "unknown",
      reason: expect.stringMatching(/include|indirect/i),
    });
  });
});
