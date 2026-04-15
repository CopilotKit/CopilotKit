/**
 * Unit tests for the starter generation script.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  substituteVars,
  rewritePythonImports,
  extractUvicornModule,
  getEntrypointBlock,
  FRAMEWORKS,
} from "../generate-starters";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const STARTERS_DIR = path.join(ROOT, "showcase", "starters");

// Derive expected slugs from FRAMEWORKS so they stay in sync automatically
const EXPECTED_SLUGS = FRAMEWORKS.map((f) => f.slug);
const PYTHON_SLUGS = FRAMEWORKS.filter((f) => f.language === "python").map(
  (f) => f.slug,
);

describe("generate-starters", () => {
  // Assumes starters have already been generated before running tests
  beforeAll(() => {
    const exists = fs.existsSync(path.join(STARTERS_DIR, "langgraph-python"));
    if (!exists) {
      throw new Error(
        "Starters not generated. Run: cd showcase/scripts && npx tsx generate-starters.ts",
      );
    }
  });

  describe("all 17 starters exist", () => {
    for (const slug of EXPECTED_SLUGS) {
      it(`${slug}/ directory exists`, () => {
        expect(fs.existsSync(path.join(STARTERS_DIR, slug))).toBe(true);
      });
    }
  });

  describe("each starter has required files", () => {
    for (const slug of EXPECTED_SLUGS) {
      describe(slug, () => {
        const dir = path.join(STARTERS_DIR, slug);

        it("has package.json", () => {
          expect(fs.existsSync(path.join(dir, "package.json"))).toBe(true);
          const pkg = JSON.parse(
            fs.readFileSync(path.join(dir, "package.json"), "utf-8"),
          );
          expect(pkg.name).toBe(`copilotkit-showcase-${slug}`);
          expect(pkg.scripts.build).toBe("next build");
          expect(pkg.scripts.dev).toBeTruthy();
        });

        it("has Dockerfile with HOSTNAME=0.0.0.0", () => {
          const dockerPath = path.join(dir, "Dockerfile");
          expect(fs.existsSync(dockerPath)).toBe(true);
          const content = fs.readFileSync(dockerPath, "utf-8");
          expect(content).toContain("ENV HOSTNAME=0.0.0.0");
        });

        it("has entrypoint.sh", () => {
          expect(fs.existsSync(path.join(dir, "entrypoint.sh"))).toBe(true);
          const content = fs.readFileSync(
            path.join(dir, "entrypoint.sh"),
            "utf-8",
          );
          expect(content).toContain(slug);
        });

        it("has showcase.json", () => {
          const meta = JSON.parse(
            fs.readFileSync(path.join(dir, "showcase.json"), "utf-8"),
          );
          expect(meta.slug).toBe(slug);
          expect(meta.agentPort).toBe(8123);
          expect(meta.generated).toBe(true);
        });

        it("has frontend source files", () => {
          expect(fs.existsSync(path.join(dir, "src", "app", "page.tsx"))).toBe(
            true,
          );
          expect(
            fs.existsSync(path.join(dir, "src", "app", "layout.tsx")),
          ).toBe(true);
          expect(
            fs.existsSync(
              path.join(dir, "src", "app", "api", "copilotkit", "route.ts"),
            ),
          ).toBe(true);
          expect(fs.existsSync(path.join(dir, "src", "types.ts"))).toBe(true);
        });

        it("has renderer components", () => {
          const renderersDir = path.join(dir, "src", "components", "renderers");
          expect(fs.existsSync(path.join(renderersDir, "types.ts"))).toBe(true);
          expect(
            fs.existsSync(path.join(renderersDir, "renderer-selector.tsx")),
          ).toBe(true);
          expect(
            fs.existsSync(path.join(renderersDir, "tool-based", "index.tsx")),
          ).toBe(true);
        });

        it("has next.config.ts without webpack alias", () => {
          const content = fs.readFileSync(
            path.join(dir, "next.config.ts"),
            "utf-8",
          );
          expect(content).not.toContain("webpack");
          expect(content).not.toContain("@copilotkit/showcase-shared");
        });

        it("has tsconfig.json without showcase-shared paths", () => {
          const content = fs.readFileSync(
            path.join(dir, "tsconfig.json"),
            "utf-8",
          );
          expect(content).not.toContain("showcase-shared");
          expect(content).not.toContain("shared_frontend");
        });
      });
    }
  });

  describe("no leftover shared imports", () => {
    it("no @copilotkit/showcase-shared-tools in any TypeScript file", () => {
      for (const slug of EXPECTED_SLUGS) {
        const dir = path.join(STARTERS_DIR, slug);
        const tsFiles = findFiles(dir, [".ts", ".tsx"]);
        for (const f of tsFiles) {
          const content = fs.readFileSync(f, "utf-8");
          expect(content, `leftover in ${f}`).not.toContain(
            "@copilotkit/showcase-shared-tools",
          );
        }
      }
    });
  });

  describe("no leftover template variables", () => {
    it("no {{...}} patterns in any generated file", () => {
      const templateVarRegex = /\{\{[A-Z_]+\}\}/;
      for (const slug of EXPECTED_SLUGS) {
        const dir = path.join(STARTERS_DIR, slug);
        const allFiles = findFiles(dir, [
          ".ts",
          ".tsx",
          ".json",
          ".css",
          ".html",
          ".mjs",
          ".sh",
        ]);
        for (const f of allFiles) {
          const content = fs.readFileSync(f, "utf-8");
          const match = content.match(templateVarRegex);
          expect(match, `leftover template var in ${f}`).toBeNull();
        }
      }
    });
  });

  describe("Python agents are self-contained", () => {
    for (const slug of PYTHON_SLUGS) {
      describe(slug, () => {
        const fw = FRAMEWORKS.find((f) => f.slug === slug)!;
        const agentDir = path.join(STARTERS_DIR, slug, fw.agentDir);

        it("has no sys.path.insert", () => {
          const pyFiles = findFiles(agentDir, [".py"]);
          for (const f of pyFiles) {
            const content = fs.readFileSync(f, "utf-8");
            expect(content).not.toContain("sys.path.insert");
          }
        });

        it("uses local imports for tools (relative or absolute)", () => {
          const pyFiles = findFiles(agentDir, [".py"]);
          const filesWithToolImport = pyFiles.filter((f) => {
            const content = fs.readFileSync(f, "utf-8");
            return (
              content.includes("from .tools import") ||
              content.includes("from .tools.") ||
              content.includes("from .tool_wrappers import") ||
              content.includes(".tools import") // absolute like src.agents.tools
            );
          });
          // At least one file should have tool imports
          expect(filesWithToolImport.length).toBeGreaterThan(0);
        });

        it("has self-contained tools/ directory", () => {
          expect(
            fs.existsSync(path.join(agentDir, "tools", "__init__.py")),
          ).toBe(true);
          expect(
            fs.existsSync(path.join(agentDir, "tools", "get_weather.py")),
          ).toBe(true);
        });

        it("has data/db.csv", () => {
          expect(fs.existsSync(path.join(agentDir, "data", "db.csv"))).toBe(
            true,
          );
        });

        it("has requirements.txt", () => {
          expect(fs.existsSync(path.join(agentDir, "requirements.txt"))).toBe(
            true,
          );
        });
      });
    }
  });

  describe("TypeScript agents are self-contained", () => {
    const TS_SLUGS = ["langgraph-typescript", "claude-sdk-typescript"];

    for (const slug of TS_SLUGS) {
      describe(slug, () => {
        const agentDir = path.join(STARTERS_DIR, slug, "agent");

        it("has shared-tools/ directory", () => {
          expect(fs.existsSync(path.join(agentDir, "shared-tools"))).toBe(true);
        });

        it("has no @copilotkit/showcase-shared-tools imports", () => {
          const tsFiles = findFiles(agentDir, [".ts", ".tsx"]);
          for (const f of tsFiles) {
            const content = fs.readFileSync(f, "utf-8");
            expect(content).not.toContain("@copilotkit/showcase-shared-tools");
          }
        });
      });
    }
  });

  describe("Mastra layout validation", () => {
    it("has src/mastra/ directory", () => {
      expect(
        fs.existsSync(path.join(STARTERS_DIR, "mastra", "src", "mastra")),
      ).toBe(true);
    });

    it("does NOT have agent/ directory at root", () => {
      expect(fs.existsSync(path.join(STARTERS_DIR, "mastra", "agent"))).toBe(
        false,
      );
    });
  });

  describe("spring-ai backend artifacts", () => {
    const agentDir = path.join(STARTERS_DIR, "spring-ai", "agent");

    it("has pom.xml", () => {
      expect(fs.existsSync(path.join(agentDir, "pom.xml"))).toBe(true);
    });

    it("has Maven standard src/main/java/ layout", () => {
      expect(fs.existsSync(path.join(agentDir, "src", "main", "java"))).toBe(
        true,
      );
    });

    it("has Maven standard src/main/resources/ layout", () => {
      expect(
        fs.existsSync(path.join(agentDir, "src", "main", "resources")),
      ).toBe(true);
    });

    it("does NOT have flattened java/ at agent root", () => {
      expect(fs.existsSync(path.join(agentDir, "java"))).toBe(false);
    });

    it("does NOT have flattened resources/ at agent root", () => {
      expect(fs.existsSync(path.join(agentDir, "resources"))).toBe(false);
    });
  });

  describe("ms-agent-dotnet backend artifacts", () => {
    const agentDir = path.join(STARTERS_DIR, "ms-agent-dotnet", "agent");

    it("has .csproj file", () => {
      const files = fs.existsSync(agentDir)
        ? fs.readdirSync(agentDir).filter((f) => f.endsWith(".csproj"))
        : [];
      expect(files.length).toBeGreaterThan(0);
    });

    it("has Program.cs", () => {
      expect(fs.existsSync(path.join(agentDir, "Program.cs"))).toBe(true);
    });
  });

  describe("substituteVars()", () => {
    it("replaces single variable", () => {
      expect(substituteVars("Hello {{NAME}}", { NAME: "World" })).toBe(
        "Hello World",
      );
    });

    it("replaces multiple occurrences", () => {
      expect(substituteVars("{{X}} and {{X}}", { X: "a" })).toBe("a and a");
    });

    it("replaces multiple variables", () => {
      expect(substituteVars("{{A}}-{{B}}", { A: "1", B: "2" })).toBe("1-2");
    });

    it("leaves unmatched variables untouched", () => {
      expect(substituteVars("{{UNKNOWN}}", { NAME: "x" })).toBe("{{UNKNOWN}}");
    });
  });

  describe("extractUvicornModule()", () => {
    it("extracts agent_server:app from pydantic-ai devScript", () => {
      const fw = FRAMEWORKS.find((f) => f.slug === "pydantic-ai")!;
      expect(extractUvicornModule(fw)).toBe("agent_server:app");
    });

    it("extracts agent_server:app from crewai-crews devScript", () => {
      const fw = FRAMEWORKS.find((f) => f.slug === "crewai-crews")!;
      expect(extractUvicornModule(fw)).toBe("agent_server:app");
    });

    it("extracts agent.main:app from langgraph-fastapi devScript", () => {
      const fw = FRAMEWORKS.find((f) => f.slug === "langgraph-fastapi")!;
      expect(extractUvicornModule(fw)).toBe("agent.main:app");
    });

    it("falls back to agent.main:app for non-uvicorn frameworks", () => {
      const fw = FRAMEWORKS.find((f) => f.slug === "langgraph-python")!;
      expect(extractUvicornModule(fw)).toBe("agent.main:app");
    });
  });

  describe("template variables are substituted", () => {
    it("layout.tsx has framework name, not template variable", () => {
      const content = fs.readFileSync(
        path.join(STARTERS_DIR, "langgraph-python", "src", "app", "layout.tsx"),
        "utf-8",
      );
      expect(content).toContain("LangGraph Python");
      expect(content).not.toContain("{{NAME}}");
    });

    it("health route has slug, not template variable", () => {
      const content = fs.readFileSync(
        path.join(
          STARTERS_DIR,
          "ag2",
          "src",
          "app",
          "api",
          "health",
          "route.ts",
        ),
        "utf-8",
      );
      expect(content).toContain('"ag2"');
      expect(content).not.toContain("{{SLUG}}");
    });
  });

  describe("rewritePythonImports()", () => {
    // We need the real function — import it dynamically since it does file I/O
    let tmpDir: string;

    function writeTmp(name: string, content: string): string {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "py-rewrite-"));
      tmpDir = dir;
      const filePath = path.join(dir, name);
      fs.writeFileSync(filePath, content);
      return filePath;
    }

    function readTmp(filePath: string): string {
      return fs.readFileSync(filePath, "utf-8");
    }

    afterEach(() => {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it("removes single-line sys.path.insert", () => {
      const fp = writeTmp(
        "test.py",
        [
          "import sys",
          "import os",
          'sys.path.insert(0, "/some/path")',
          "from tools import foo",
        ].join("\n"),
      );
      rewritePythonImports(fp, "agent");
      const result = readTmp(fp);
      expect(result).not.toContain("sys.path.insert");
      expect(result).not.toContain("import sys");
    });

    it("removes multi-line sys.path.insert with nested parens", () => {
      const fp = writeTmp(
        "test.py",
        [
          "import sys",
          "sys.path.insert(",
          "    0,",
          '    os.path.join(os.path.dirname(__file__), "..")',
          ")",
          "from tools import foo",
        ].join("\n"),
      );
      rewritePythonImports(fp, "agent");
      const result = readTmp(fp);
      expect(result).not.toContain("sys.path.insert");
    });

    it("rewrites 'from tools import X' to 'from .tools import X'", () => {
      const fp = writeTmp("test.py", "from tools import get_weather\n");
      rewritePythonImports(fp, "agent");
      expect(readTmp(fp)).toContain("from .tools import get_weather");
    });

    it("rewrites 'from src.agents.X import Y' to 'from .X import Y'", () => {
      const fp = writeTmp("test.py", "from src.agents.tools import helper\n");
      rewritePythonImports(fp, "agent");
      expect(readTmp(fp)).toContain("from .tools import helper");
    });

    it("leaves file unchanged when no patterns match", () => {
      const original = "import json\nprint('hello')\n";
      const fp = writeTmp("test.py", original);
      rewritePythonImports(fp, "agent");
      expect(readTmp(fp)).toBe(original);
    });

    it("cleans up triple blank lines", () => {
      const fp = writeTmp(
        "test.py",
        "import sys\nsys.path.insert(0, '.')\n\n\n\nfrom tools import x\n",
      );
      rewritePythonImports(fp, "agent");
      const result = readTmp(fp);
      expect(result).not.toMatch(/\n{3,}/);
    });
  });

  describe("getEntrypointBlock()", () => {
    it("Python: returns uvicorn command with correct module", () => {
      const fw = FRAMEWORKS.find((f) => f.slug === "pydantic-ai")!;
      const block = getEntrypointBlock(fw);
      expect(block).toContain("uvicorn agent_server:app");
      expect(block).toContain("kill -0");
    });

    it("Python langgraph: returns langgraph_cli dev command", () => {
      const fw = FRAMEWORKS.find((f) => f.slug === "langgraph-python")!;
      const block = getEntrypointBlock(fw);
      expect(block).toContain("langgraph_cli dev");
      expect(block).toContain("kill -0");
    });

    it("TypeScript langgraph: returns langgraph-cli dev", () => {
      const fw = FRAMEWORKS.find((f) => f.slug === "langgraph-typescript")!;
      const block = getEntrypointBlock(fw);
      expect(block).toContain("@langchain/langgraph-cli dev");
    });

    it("TypeScript mastra: returns mastra dev", () => {
      const fw = FRAMEWORKS.find((f) => f.slug === "mastra")!;
      const block = getEntrypointBlock(fw);
      expect(block).toContain("mastra dev");
    });

    it("TypeScript generic: returns npx tsx", () => {
      const fw = FRAMEWORKS.find((f) => f.slug === "claude-sdk-typescript")!;
      const block = getEntrypointBlock(fw);
      expect(block).toContain("npx tsx agent/index.ts");
    });

    it("Java: returns java -jar", () => {
      const fw = FRAMEWORKS.find((f) => f.slug === "spring-ai")!;
      const block = getEntrypointBlock(fw);
      expect(block).toContain("java -jar");
    });

    it("C#: returns dotnet run", () => {
      const fw = FRAMEWORKS.find((f) => f.slug === "ms-agent-dotnet")!;
      const block = getEntrypointBlock(fw);
      expect(block).toContain("dotnet ProverbsAgent.dll");
    });
  });
});

// Helper to recursively find files with given extensions
function findFiles(dir: string, extensions: string[]): string[] {
  const result: string[] = [];
  if (!fs.existsSync(dir)) return result;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === ".next") continue;

    if (entry.isDirectory()) {
      result.push(...findFiles(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      result.push(fullPath);
    }
  }
  return result;
}
