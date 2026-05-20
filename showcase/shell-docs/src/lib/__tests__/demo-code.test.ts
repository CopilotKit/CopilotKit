import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { extractRegion, inferLanguage } from "../demo-code";
import { rewriteDemoCode } from "../rewrite-demo-code";

// `procEnv.NODE_ENV` is typed as readonly under @types/node's strict
// view. Vitest mutates it at runtime — that's how its `NODE_ENV=test`
// override works — so this writable handle reflects what's actually
// available at runtime. Casting through `Record<string, string>` keeps
// the test bodies legible while satisfying tsc.
const procEnv = process.env as Record<string, string | undefined>;

describe("extractRegion (py comment syntax)", () => {
  it("returns the bounded region content with markers stripped", () => {
    const src = [
      "import os",
      "",
      "# region: middleware",
      "x = 1",
      "y = 2",
      "# endregion",
      "",
      "z = 3",
    ].join("\n");
    expect(extractRegion(src, "middleware", "py")).toBe("x = 1\ny = 2");
  });

  it("returns null when the region is missing", () => {
    const src = "# region: other\nfoo\n# endregion\n";
    expect(extractRegion(src, "missing", "py")).toBeNull();
  });

  it("throws in dev mode when the same region appears twice", () => {
    const src = [
      "# region: dup",
      "first",
      "# endregion",
      "# region: dup",
      "second",
      "# endregion",
    ].join("\n");
    const origEnv = procEnv.NODE_ENV;
    procEnv.NODE_ENV = "development";
    try {
      expect(() => extractRegion(src, "dup", "py")).toThrow(/duplicate region/i);
    } finally {
      procEnv.NODE_ENV = origEnv;
    }
  });

  it("concatenates duplicate regions in production mode", () => {
    const src = [
      "# region: dup",
      "first",
      "# endregion",
      "# region: dup",
      "second",
      "# endregion",
    ].join("\n");
    const origEnv = procEnv.NODE_ENV;
    procEnv.NODE_ENV = "production";
    try {
      expect(extractRegion(src, "dup", "py")).toBe("first\nsecond");
    } finally {
      procEnv.NODE_ENV = origEnv;
    }
  });

  it("throws in both modes when endregion is missing", () => {
    const src = "# region: orphan\nfoo\nbar\n";
    for (const env of ["development", "production"]) {
      const orig = procEnv.NODE_ENV;
      procEnv.NODE_ENV = env;
      try {
        expect(() => extractRegion(src, "orphan", "py")).toThrow(
          /unterminated region/i,
        );
      } finally {
        procEnv.NODE_ENV = orig;
      }
    }
  });

  it("tolerates leading whitespace on marker lines", () => {
    const src = [
      "class Foo:",
      "    # region: inner",
      "    x = 1",
      "    # endregion",
    ].join("\n");
    expect(extractRegion(src, "inner", "py")).toBe("    x = 1");
  });
});

describe("extractRegion (ts/js comment syntax)", () => {
  it("uses // for the .ts dispatch", () => {
    const src = [
      "import { foo } from 'bar';",
      "// region: setup",
      "const x = 1;",
      "// endregion",
      "export {};",
    ].join("\n");
    expect(extractRegion(src, "setup", "ts")).toBe("const x = 1;");
  });

  it("uses // for the .tsx dispatch", () => {
    const src = "// region: r\nconst a = 1;\n// endregion\n";
    expect(extractRegion(src, "r", "tsx")).toBe("const a = 1;");
  });

  it("uses // for the .js dispatch", () => {
    const src = "// region: r\nconst a = 1;\n// endregion\n";
    expect(extractRegion(src, "r", "js")).toBe("const a = 1;");
  });

  it("returns null for an extension with no comment syntax registered", () => {
    expect(extractRegion("region: r\nx\nendregion", "r", "unknown")).toBeNull();
  });
});

describe("rewriteDemoCode", () => {
  let tmp = "";
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rewrite-"));
  });
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  function plantSource(rel: string, contents: string): void {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }

  it("expands a static <DemoCode> reference into a fenced block", () => {
    plantSource(
      "src/agents/frontend_tools.py",
      [
        "# region: middleware",
        "graph = create_agent(middleware=[CopilotKitMiddleware()])",
        "# endregion",
      ].join("\n"),
    );
    const out = rewriteDemoCode(
      '<DemoCode file="src/agents/frontend_tools.py" region="middleware" />',
      tmp,
    );
    expect(out).toContain("~~~python");
    expect(out).toContain("CopilotKitMiddleware()");
    expect(out).toContain('title="frontend_tools.py"');
  });

  it("honors explicit language + title overrides", () => {
    plantSource(
      "src/util.go",
      ["// region: helper", "func Helper() {}", "// endregion"].join("\n"),
    );
    const out = rewriteDemoCode(
      '<DemoCode file="src/util.go" region="helper" language="golang" title="helper.go" />',
      tmp,
    );
    expect(out).toContain("~~~golang");
    expect(out).toContain('title="helper.go"');
  });

  it("leaves expression-valued <DemoCode> references intact", () => {
    const input = '<DemoCode file={someVar} region="x" />';
    expect(rewriteDemoCode(input, tmp)).toBe(input);
  });

  it("strips a missing-file reference to empty (logged)", () => {
    const out = rewriteDemoCode(
      '<DemoCode file="src/missing.py" region="x" />',
      tmp,
    );
    expect(out).toBe("");
  });

  it("strips a reference whose region isn't found to empty", () => {
    plantSource(
      "src/agents/foo.py",
      ["# region: other", "x", "# endregion"].join("\n"),
    );
    const out = rewriteDemoCode(
      '<DemoCode file="src/agents/foo.py" region="missing" />',
      tmp,
    );
    expect(out).toBe("");
  });
});

describe("inferLanguage", () => {
  it.each([
    ["agent.py", "python"],
    ["app.ts", "typescript"],
    ["page.tsx", "typescript"],
    ["script.js", "javascript"],
    ["app.jsx", "javascript"],
    ["App.java", "java"],
    ["Program.cs", "csharp"],
    ["main.go", "go"],
    ["app.kt", "kotlin"],
    ["main.rs", "rust"],
    ["weird.zzz", "plaintext"],
    ["no-extension", "plaintext"],
  ])("returns %s for %s", (file, lang) => {
    expect(inferLanguage(file)).toBe(lang);
  });
});
