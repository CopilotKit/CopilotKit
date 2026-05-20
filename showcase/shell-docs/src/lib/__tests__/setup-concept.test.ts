import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  resolveSetupConcept,
  __resetSetupConceptCacheForTest,
} from "../docs-render";

// `scratch` is the test's own dedicated parent dir; `tmp` is the
// `integrationsRoot` we hand to `resolveSetupConcept`. Nesting `tmp`
// inside `scratch` means the path-traversal test can plant a decoy
// in `scratch` (i.e. *outside* `tmp` but *inside* our isolated
// scratch tree) without racing against any other process writing
// directly to `/tmp`. If we instead placed the decoy at
// `path.dirname(tmp)` (the system tmp root), two concurrent runs of
// this test would race on the same shared path.
let scratch = "";
let tmp = "";

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "setup-concept-"));
  tmp = fs.mkdtempSync(path.join(scratch, "root-"));
  __resetSetupConceptCacheForTest();
});

afterEach(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = "";
  tmp = "";
});

function writeConcept(slug: string, concept: string, body: string): void {
  const dir = path.join(tmp, slug, "docs", "setup");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${concept}.mdx`), body);
}

describe("resolveSetupConcept", () => {
  it("returns the file contents when the concept exists", () => {
    writeConcept("langgraph", "copilot-middleware", "# hello world\n");
    expect(resolveSetupConcept(tmp, "langgraph", "copilot-middleware")).toBe(
      "# hello world\n",
    );
  });

  it("returns null when the concept file is missing", () => {
    expect(resolveSetupConcept(tmp, "langgraph", "absent-concept")).toBeNull();
  });

  it("returns null when the concept file is empty or whitespace-only", () => {
    writeConcept("langgraph", "empty", "");
    writeConcept("langgraph", "blank", "   \n\t\n  ");
    expect(resolveSetupConcept(tmp, "langgraph", "empty")).toBeNull();
    expect(resolveSetupConcept(tmp, "langgraph", "blank")).toBeNull();
  });

  it("returns null on path-traversal attempts via the concept arg", () => {
    // Plant a decoy *outside* `integrationsRoot` (which is `tmp`) but
    // *inside* the per-test scratch directory. A successful escape from
    // `<tmp>/<docsFolder>/docs/setup/` must land on a path that actually
    // exists — otherwise the test would pass for the wrong reason
    // (file-not-found at the resolved location rather than the
    // path-traversal defense kicking in).
    //
    // `concept` is joined with "docs/setup/" before resolution, so to
    // reach the decoy at `<scratch>/secrets.mdx` from
    // `<tmp>/<docsFolder>/docs/setup/`, the normalized form needs to
    // walk up four levels: `docs` + `setup` + `<docsFolder>` + `tmp`
    // ⇒ `scratch`. Four `..` segments suffice; the concrete count is
    // implementation-defined, so the test asserts the *outcome* (null)
    // rather than the path math.
    fs.writeFileSync(path.join(scratch, "secrets.mdx"), "should never read");
    expect(
      resolveSetupConcept(tmp, "langgraph", "../../../../secrets"),
    ).toBeNull();
    // No manual cleanup needed — afterEach rmSyncs the entire `scratch`.
  });

  it("returns null on path-traversal attempts via the docsFolder arg", () => {
    expect(resolveSetupConcept(tmp, "../etc", "passwd")).toBeNull();
  });
});
