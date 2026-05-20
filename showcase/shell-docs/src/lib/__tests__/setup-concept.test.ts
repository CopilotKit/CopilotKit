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
    fs.writeFileSync(path.join(tmp, "secrets.mdx"), "should never read");
    expect(resolveSetupConcept(tmp, "langgraph", "../../secrets")).toBeNull();
  });

  it("returns null on path-traversal attempts via the docsFolder arg", () => {
    expect(resolveSetupConcept(tmp, "../etc", "passwd")).toBeNull();
  });
});
