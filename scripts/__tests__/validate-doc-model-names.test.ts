import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadAllowlist,
  stripProviderPrefix,
  looksLikeModelName,
  extractModelNames,
  validateFiles,
} from "../validate-doc-model-names";

// ---------------------------------------------------------------------------
// stripProviderPrefix
// ---------------------------------------------------------------------------

describe("stripProviderPrefix", () => {
  it("strips known provider prefixes", () => {
    expect(stripProviderPrefix("openai/gpt-5.4")).toBe("gpt-5.4");
    expect(stripProviderPrefix("anthropic/claude-sonnet-4-6")).toBe(
      "claude-sonnet-4-6",
    );
    expect(stripProviderPrefix("google/gemini-2.5-pro")).toBe("gemini-2.5-pro");
    expect(stripProviderPrefix("cohere/command-r-plus")).toBe("command-r-plus");
    expect(stripProviderPrefix("meta/llama-4-scout")).toBe("llama-4-scout");
    expect(stripProviderPrefix("mistral/mistral-large")).toBe("mistral-large");
    expect(stripProviderPrefix("azure/gpt-4o")).toBe("gpt-4o");
    expect(stripProviderPrefix("bedrock/claude-sonnet-4-6")).toBe(
      "claude-sonnet-4-6",
    );
    expect(stripProviderPrefix("vertex/gemini-2.5-flash")).toBe(
      "gemini-2.5-flash",
    );
  });

  it("returns the name unchanged when no prefix matches", () => {
    expect(stripProviderPrefix("gpt-5.4")).toBe("gpt-5.4");
    expect(stripProviderPrefix("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });
});

// ---------------------------------------------------------------------------
// looksLikeModelName
// ---------------------------------------------------------------------------

describe("looksLikeModelName", () => {
  it("recognizes known model prefixes", () => {
    expect(looksLikeModelName("gpt-5.4")).toBe(true);
    expect(looksLikeModelName("claude-sonnet-4-6")).toBe(true);
    expect(looksLikeModelName("gemini-2.5-pro")).toBe(true);
    expect(looksLikeModelName("o1")).toBe(true);
    expect(looksLikeModelName("o1-mini")).toBe(true);
    expect(looksLikeModelName("o3-mini")).toBe(true);
    expect(looksLikeModelName("o4-mini")).toBe(true);
    expect(looksLikeModelName("command-r-plus")).toBe(true);
    expect(looksLikeModelName("command-a")).toBe(true);
    expect(looksLikeModelName("mistral-large")).toBe(true);
    expect(looksLikeModelName("llama-4-scout")).toBe(true);
  });

  it("rejects non-model strings", () => {
    expect(looksLikeModelName("react")).toBe(false);
    expect(looksLikeModelName("next.js")).toBe(false);
    expect(looksLikeModelName("typescript")).toBe(false);
    expect(looksLikeModelName("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractModelNames
// ---------------------------------------------------------------------------

describe("extractModelNames", () => {
  it('extracts model from model="..." in fenced code block', () => {
    const content = [
      "Some text",
      "```python",
      'ChatOpenAI(model="gpt-5.4-mini")',
      "```",
    ].join("\n");

    const results = extractModelNames(content);
    expect(results).toEqual([{ model: "gpt-5.4-mini", line: 3 }]);
  });

  it('extracts model from model: "..." pattern', () => {
    const content = [
      "```tsx",
      'const config = { model: "claude-sonnet-4-6" };',
      "```",
    ].join("\n");

    const results = extractModelNames(content);
    expect(results).toEqual([{ model: "claude-sonnet-4-6", line: 2 }]);
  });

  it('extracts model from "model": "..." JSON pattern', () => {
    const content = [
      "```json",
      "{",
      '  "model": "gemini-2.5-flash"',
      "}",
      "```",
    ].join("\n");

    const results = extractModelNames(content);
    expect(results).toEqual([{ model: "gemini-2.5-flash", line: 3 }]);
  });

  it("extracts model from single-quoted values", () => {
    const content = ["```python", "model='gpt-4o'", "```"].join("\n");

    const results = extractModelNames(content);
    expect(results).toEqual([{ model: "gpt-4o", line: 2 }]);
  });

  it("extracts model from inline code", () => {
    const content = 'Use `model="gpt-5.4"` for best results.';

    const results = extractModelNames(content);
    expect(results).toEqual([{ model: "gpt-5.4", line: 1 }]);
  });

  it("strips provider prefixes from model names", () => {
    const content = ["```tsx", 'model="openai/gpt-5.4-mini"', "```"].join("\n");

    const results = extractModelNames(content);
    expect(results).toEqual([{ model: "gpt-5.4-mini", line: 2 }]);
  });

  it("handles bare provider-prefixed names", () => {
    const content = ["```", "openai/gpt-4o-mini", "```"].join("\n");

    const results = extractModelNames(content);
    expect(results).toEqual([{ model: "gpt-4o-mini", line: 2 }]);
  });

  it("extracts multiple models from one file", () => {
    const content = [
      "```python",
      'a = ChatOpenAI(model="gpt-5.4")',
      'b = ChatAnthropic(model="claude-sonnet-4-6")',
      "```",
    ].join("\n");

    const results = extractModelNames(content);
    expect(results).toHaveLength(2);
    expect(results[0].model).toBe("gpt-5.4");
    expect(results[1].model).toBe("claude-sonnet-4-6");
  });

  it("ignores text outside code blocks", () => {
    const content = [
      'We recommend model="gpt-5.4" for production.',
      "",
      "This is plain text, not code.",
    ].join("\n");

    // No fenced block, no inline code — nothing extracted
    const results = extractModelNames(content);
    expect(results).toEqual([]);
  });

  it("ignores empty and whitespace-only strings", () => {
    const content = ["```", 'model=""', "model=' '", "```"].join("\n");

    const results = extractModelNames(content);
    expect(results).toEqual([]);
  });

  it("does not extract non-model strings from code blocks", () => {
    const content = [
      "```tsx",
      'const name = "react-component";',
      'import something from "next/router";',
      "```",
    ].join("\n");

    const results = extractModelNames(content);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadAllowlist
// ---------------------------------------------------------------------------

describe("loadAllowlist", () => {
  it("loads all model names from allowlist JSON", () => {
    const allowlistPath = path.resolve(
      __dirname,
      "../../showcase/shell-docs/model-allowlist.json",
    );
    const allowed = loadAllowlist(allowlistPath);

    expect(allowed.has("gpt-5.4")).toBe(true);
    expect(allowed.has("claude-sonnet-4-6")).toBe(true);
    expect(allowed.has("gemini-2.5-pro")).toBe(true);
    expect(allowed.has("command-r-plus")).toBe(true);
    expect(allowed.has("llama-4-scout")).toBe(true);
  });

  it("excludes the _comment field", () => {
    const allowlistPath = path.resolve(
      __dirname,
      "../../showcase/shell-docs/model-allowlist.json",
    );
    const allowed = loadAllowlist(allowlistPath);

    // _comment value should not be in the set
    expect(
      allowed.has(
        "Maintained list of valid AI model names for docs. Update when providers release new models. CI validates docs against this list.",
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateFiles (integration)
// ---------------------------------------------------------------------------

describe("validateFiles", () => {
  function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "model-validate-"));
  }

  it("returns no violations when all models are in the allowlist", () => {
    const dir = createTempDir();
    const allowlist = path.join(dir, "allowlist.json");

    fs.writeFileSync(
      allowlist,
      JSON.stringify({
        openai: ["gpt-5.4"],
        anthropic: ["claude-sonnet-4-6"],
      }),
    );
    fs.writeFileSync(
      path.join(dir, "test.mdx"),
      ["```python", 'ChatOpenAI(model="gpt-5.4")', "```"].join("\n"),
    );

    const violations = validateFiles(dir, allowlist);
    expect(violations).toEqual([]);

    fs.rmSync(dir, { recursive: true });
  });

  it("flags model names not in the allowlist", () => {
    const dir = createTempDir();
    const allowlist = path.join(dir, "allowlist.json");

    fs.writeFileSync(allowlist, JSON.stringify({ openai: ["gpt-5.4"] }));
    fs.writeFileSync(
      path.join(dir, "test.mdx"),
      ["```python", 'model="gpt-99"', "```"].join("\n"),
    );

    const violations = validateFiles(dir, allowlist);
    expect(violations).toHaveLength(1);
    expect(violations[0].model).toBe("gpt-99");
    expect(violations[0].file).toBe("test.mdx");

    fs.rmSync(dir, { recursive: true });
  });

  it("scans subdirectories for .mdx files", () => {
    const dir = createTempDir();
    const sub = path.join(dir, "guides");
    fs.mkdirSync(sub);
    const allowlist = path.join(dir, "allowlist.json");

    fs.writeFileSync(allowlist, JSON.stringify({ openai: ["gpt-5.4"] }));
    fs.writeFileSync(
      path.join(sub, "deep.mdx"),
      ["```", 'model="gpt-unknown"', "```"].join("\n"),
    );

    const violations = validateFiles(dir, allowlist);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("guides/deep.mdx");

    fs.rmSync(dir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Ship vs recognize (PE-70)
// ---------------------------------------------------------------------------

/**
 * The allowlist used to answer one question: is this a real model name? Every
 * stale pin passed, because `gpt-3.5-turbo` is as real as `gpt-5.5`. A starter
 * a developer clones has to answer a second question: is this one we still
 * ship? Documentation may name an old model; a starter may not pin one.
 */

describe("ship and recognize tiers", () => {
  function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "model-tier-"));
  }

  const split = {
    openai: {
      ship: ["gpt-5-mini"],
      recognize: ["gpt-4o", "gpt-4o-mini"],
    },
  };

  it("ship returns only what we still put in a starter", () => {
    const dir = createTempDir();
    const allowlist = path.join(dir, "allowlist.json");
    fs.writeFileSync(allowlist, JSON.stringify(split));

    expect([...loadAllowlist(allowlist, "ship")].sort()).toEqual([
      "gpt-5-mini",
    ]);

    fs.rmSync(dir, { recursive: true });
  });

  it("all returns every name we recognize, for prose that names an old one", () => {
    const dir = createTempDir();
    const allowlist = path.join(dir, "allowlist.json");
    fs.writeFileSync(allowlist, JSON.stringify(split));

    expect([...loadAllowlist(allowlist, "all")].sort()).toEqual([
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-5-mini",
    ]);

    fs.rmSync(dir, { recursive: true });
  });

  it("a flat provider list still means both tiers", () => {
    const dir = createTempDir();
    const allowlist = path.join(dir, "allowlist.json");
    fs.writeFileSync(allowlist, JSON.stringify({ openai: ["gpt-5-mini"] }));

    expect([...loadAllowlist(allowlist, "ship")]).toEqual(["gpt-5-mini"]);
    expect([...loadAllowlist(allowlist, "all")]).toEqual(["gpt-5-mini"]);

    fs.rmSync(dir, { recursive: true });
  });

  it("a starter tree flags a model we only recognize", () => {
    const dir = createTempDir();
    const allowlist = path.join(dir, "allowlist.json");
    fs.writeFileSync(allowlist, JSON.stringify(split));
    fs.writeFileSync(
      path.join(dir, "agent.py"),
      'agent = ChatOpenAI(model="gpt-4o-mini")\n',
    );

    const violations = validateFiles(dir, allowlist, {
      tier: "ship",
      extensions: [".py"],
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].model).toBe("gpt-4o-mini");

    fs.rmSync(dir, { recursive: true });
  });

  it("the same model passes where prose may name it", () => {
    const dir = createTempDir();
    const allowlist = path.join(dir, "allowlist.json");
    fs.writeFileSync(allowlist, JSON.stringify(split));
    fs.writeFileSync(
      path.join(dir, "page.mdx"),
      ["```python", 'ChatOpenAI(model="gpt-4o-mini")', "```"].join("\n"),
    );

    expect(validateFiles(dir, allowlist, { tier: "all" })).toEqual([]);

    fs.rmSync(dir, { recursive: true });
  });
});

/**
 * A source file is not MDX. The whole file is code, so nothing is inside a
 * fence, and the .NET starter names its model as a call argument rather than a
 * `model=` attribute. The line that produced PE-70 is the .cs one below.
 */

describe("source files", () => {
  function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "model-source-"));
  }

  const allowOnlyNew = { openai: { ship: ["gpt-5-mini"], recognize: [] } };

  it.each([
    ["agent.py", 'llm = ChatOpenAI(model="gpt-4o-mini")\n'],
    [
      "agent.ts",
      'const agent = new BuiltInAgent({ model: "openai/gpt-4o-mini" });\n',
    ],
    ["Program.cs", '_openAiClient.GetChatClient("gpt-4o-mini").AsAIAgent(\n'],
  ])("finds the pin in %s", (name, body) => {
    const dir = createTempDir();
    const allowlist = path.join(dir, "allowlist.json");
    fs.writeFileSync(allowlist, JSON.stringify(allowOnlyNew));
    fs.writeFileSync(path.join(dir, name), body);

    const violations = validateFiles(dir, allowlist, {
      tier: "ship",
      extensions: [path.extname(name)],
    });

    expect(violations.map((v) => v.model)).toEqual(["gpt-4o-mini"]);

    fs.rmSync(dir, { recursive: true });
  });

  it("does not treat an English sentence as a call argument", () => {
    const dir = createTempDir();
    const allowlist = path.join(dir, "allowlist.json");
    fs.writeFileSync(allowlist, JSON.stringify(allowOnlyNew));
    fs.writeFileSync(
      path.join(dir, "notes.py"),
      '# We moved off the old model last year. See print("done")\n',
    );

    expect(
      validateFiles(dir, allowlist, { tier: "ship", extensions: [".py"] }),
    ).toEqual([]);

    fs.rmSync(dir, { recursive: true });
  });
});

/**
 * Three shapes the widened scan met on its first run over the starter trees.
 * None is a stale pin, and all three would have to be silenced by hand if the
 * gate could not tell them apart.
 */

describe("what the shipped scan must not flag", () => {
  function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "model-noise-"));
  }

  const allowlist = { openai: { ship: ["gpt-5-mini"], recognize: [] } };

  function scan(dir: string, listPath: string) {
    return validateFiles(dir, listPath, {
      tier: "ship",
      extensions: [".ts", ".md"],
    });
  }

  it("a wildcard in prose is not a model name", () => {
    const dir = createTempDir();
    const list = path.join(dir, "allowlist.json");
    fs.writeFileSync(list, JSON.stringify(allowlist));
    // `examples/slack/README.md` names a family, not a version.
    fs.writeFileSync(
      path.join(dir, "README.md"),
      "Gemini (`google/gemini-2.5-*`) models are supported.\n",
    );

    expect(scan(dir, list)).toEqual([]);

    fs.rmSync(dir, { recursive: true });
  });

  it("a test file is not a shipped pin", () => {
    const dir = createTempDir();
    const list = path.join(dir, "allowlist.json");
    fs.writeFileSync(list, JSON.stringify(allowlist));
    fs.writeFileSync(
      path.join(dir, "adapter.test.ts"),
      'expect(normalize({ model: "gpt-4o-mini" })).toBe("x");\n',
    );

    expect(scan(dir, list)).toEqual([]);

    fs.rmSync(dir, { recursive: true });
  });

  it("a line marked ignore is a deliberate mention", () => {
    const dir = createTempDir();
    const list = path.join(dir, "allowlist.json");
    fs.writeFileSync(list, JSON.stringify(allowlist));
    // The Claude adapter normalizes a legacy spelling, so it has to name it.
    fs.writeFileSync(
      path.join(dir, "adapter.ts"),
      'return model === "claude-sonnet-4.6" ? "claude-sonnet-4-6" : model; // model-allowlist-ignore\n',
    );

    expect(scan(dir, list)).toEqual([]);

    fs.rmSync(dir, { recursive: true });
  });

  it("an unmarked stale pin in the same file still fails", () => {
    const dir = createTempDir();
    const list = path.join(dir, "allowlist.json");
    fs.writeFileSync(list, JSON.stringify(allowlist));
    fs.writeFileSync(
      path.join(dir, "agent.ts"),
      [
        'const legacy = "gpt-4o"; // model-allowlist-ignore',
        'const agent = { model: "gpt-4o-mini" };',
      ].join("\n"),
    );

    expect(scan(dir, list).map((v) => v.model)).toEqual(["gpt-4o-mini"]);

    fs.rmSync(dir, { recursive: true });
  });
});
