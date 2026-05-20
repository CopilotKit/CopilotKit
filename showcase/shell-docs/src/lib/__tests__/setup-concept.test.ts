import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  resolveSetupConcept,
  __resetSetupConceptCacheForTest,
} from "../docs-render";

let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "setup-concept-"));
  __resetSetupConceptCacheForTest();
});

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
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
    // Place a decoy *outside* `integrationsRoot` so a successful escape would
    // resolve to a file that actually exists — otherwise the test would pass
    // for the wrong reason (file not found rather than path-traversal block).
    // The concept arg gets joined with "docs/setup/" before resolution; for the
    // composed path to escape `<integrationsRoot>/<docsFolder>/`, we need to
    // walk up far enough that `path.join` cannot normalize all `..` segments
    // away — three levels reach the parent of integrationsRoot.
    const parentDir = path.dirname(tmp);
    fs.writeFileSync(path.join(parentDir, "secrets.mdx"), "should never read");
    try {
      expect(
        resolveSetupConcept(tmp, "langgraph", "../../../../secrets"),
      ).toBeNull();
    } finally {
      fs.rmSync(path.join(parentDir, "secrets.mdx"), { force: true });
    }
  });

  it("returns null on path-traversal attempts via the docsFolder arg", () => {
    expect(resolveSetupConcept(tmp, "../etc", "passwd")).toBeNull();
  });
});
