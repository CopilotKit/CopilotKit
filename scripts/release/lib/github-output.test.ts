import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { emitGithubOutputs } from "./github-output.js";

let tmpDir: string;
let outputFile: string;
const originalGithubOutput = process.env.GITHUB_OUTPUT;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-output-"));
  outputFile = path.join(tmpDir, "output");
  fs.writeFileSync(outputFile, "");
  process.env.GITHUB_OUTPUT = outputFile;
});

afterEach(() => {
  // Restore spies first so they cannot leak into the env/fs cleanup below.
  vi.restoreAllMocks();
  if (originalGithubOutput === undefined) {
    delete process.env.GITHUB_OUTPUT;
  } else {
    process.env.GITHUB_OUTPUT = originalGithubOutput;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("emitGithubOutputs", () => {
  it("appends key=value lines to the GITHUB_OUTPUT file", () => {
    emitGithubOutputs({ version: "1.2.3-canary.42", scope: "monorepo" });

    expect(fs.readFileSync(outputFile, "utf8")).toBe(
      "version=1.2.3-canary.42\nscope=monorepo\n",
    );
  });

  it("appends without truncating prior outputs", () => {
    fs.writeFileSync(outputFile, "earlier=value\n");

    emitGithubOutputs({ version: "1.2.3" });

    expect(fs.readFileSync(outputFile, "utf8")).toBe(
      "earlier=value\nversion=1.2.3\n",
    );
  });

  it("is a no-op when GITHUB_OUTPUT is unset", () => {
    delete process.env.GITHUB_OUTPUT;
    const appendSpy = vi.spyOn(fs, "appendFileSync");

    expect(() => emitGithubOutputs({ version: "1.2.3" })).not.toThrow();
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("throws when a value contains a newline, naming the offending key", () => {
    expect(() =>
      emitGithubOutputs({ version: "1.2.3\nmalicious=evil" }),
    ).toThrow(/version/);
  });

  it("throws when a value contains a carriage return", () => {
    expect(() => emitGithubOutputs({ version: "1.2.3\r" })).toThrow(/version/);
  });

  it("throws when a key contains a newline", () => {
    expect(() => emitGithubOutputs({ "bad\nkey": "value" })).toThrow(
      /alphanumeric/,
    );
  });

  it("throws when a key contains '='", () => {
    expect(() => emitGithubOutputs({ "bad=key": "value" })).toThrow(
      /alphanumeric/,
    );
  });

  it("throws when a key contains a space", () => {
    expect(() => emitGithubOutputs({ "bad key": "value" })).toThrow(
      /alphanumeric/,
    );
  });

  it("throws when a key is empty", () => {
    expect(() => emitGithubOutputs({ "": "value" })).toThrow(/alphanumeric/);
  });

  it("accepts a value containing '=' and writes it verbatim", () => {
    emitGithubOutputs({ note: "a=b" });

    expect(fs.readFileSync(outputFile, "utf8")).toBe("note=a=b\n");
  });
});
