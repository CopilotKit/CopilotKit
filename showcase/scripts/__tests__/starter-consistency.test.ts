/**
 * Cross-starter consistency tests.
 *
 * Verifies that all 17 generated starters share the same frontend file set,
 * renderer components, valid Dockerfile, and valid entrypoint.sh — beyond
 * what generate-starters.test.ts already checks.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { FRAMEWORKS } from "../generate-starters";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const STARTERS_DIR = path.join(ROOT, "showcase", "starters");
const TEMPLATE_DIR = path.join(STARTERS_DIR, "template", "frontend");
const EXPECTED_SLUGS = FRAMEWORKS.map((f) => f.slug);

/** Recursively collect relative file paths under a directory. */
function collectFiles(dir: string, base = dir): string[] {
  const result: string[] = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectFiles(full, base));
    } else {
      result.push(path.relative(base, full));
    }
  }
  return result.sort();
}

describe("Cross-starter consistency", () => {
  beforeAll(() => {
    if (!fs.existsSync(path.join(STARTERS_DIR, "langgraph-python"))) {
      throw new Error(
        "Starters not generated. Run: cd showcase/scripts && npx tsx generate-starters.ts",
      );
    }
  });

  describe("frontend file set matches template", () => {
    const templateFiles = collectFiles(TEMPLATE_DIR);

    for (const slug of EXPECTED_SLUGS) {
      it(`${slug} has all template frontend files`, () => {
        const starterSrcDir = path.join(STARTERS_DIR, slug, "src");
        const starterFiles = collectFiles(starterSrcDir);

        // Every template file should exist in the starter's src/
        for (const tf of templateFiles) {
          expect(
            starterFiles,
            `${slug} missing frontend file: ${tf}`,
          ).toContain(tf);
        }
      });
    }
  });

  describe("renderer components are identical across all starters", () => {
    // Use langgraph-python as the reference
    const refDir = path.join(
      STARTERS_DIR,
      "langgraph-python",
      "src",
      "components",
      "renderers",
    );
    const refFiles = collectFiles(refDir);

    for (const slug of EXPECTED_SLUGS) {
      if (slug === "langgraph-python") continue;

      it(`${slug} has identical renderer file set`, () => {
        const dir = path.join(
          STARTERS_DIR,
          slug,
          "src",
          "components",
          "renderers",
        );
        const files = collectFiles(dir);
        expect(files).toEqual(refFiles);
      });

      it(`${slug} has identical renderer file contents`, () => {
        for (const file of refFiles) {
          const refContent = fs.readFileSync(path.join(refDir, file), "utf-8");
          const starterContent = fs.readFileSync(
            path.join(
              STARTERS_DIR,
              slug,
              "src",
              "components",
              "renderers",
              file,
            ),
            "utf-8",
          );
          expect(starterContent, `${slug} renderer file differs: ${file}`).toBe(
            refContent,
          );
        }
      });
    }
  });

  describe("Dockerfile validity", () => {
    for (const slug of EXPECTED_SLUGS) {
      describe(slug, () => {
        const dockerPath = path.join(STARTERS_DIR, slug, "Dockerfile");

        it("has COPY for package.json", () => {
          const content = fs.readFileSync(dockerPath, "utf-8");
          expect(content).toContain("COPY package.json");
        });

        it("has npm install step", () => {
          const content = fs.readFileSync(dockerPath, "utf-8");
          expect(content).toMatch(/npm install/);
        });

        it("has npm run build step", () => {
          const content = fs.readFileSync(dockerPath, "utf-8");
          expect(content).toMatch(/npm run build/);
        });

        it("has COPY for entrypoint.sh", () => {
          const content = fs.readFileSync(dockerPath, "utf-8");
          expect(content).toContain("entrypoint.sh");
        });

        it("has CMD or ENTRYPOINT", () => {
          const content = fs.readFileSync(dockerPath, "utf-8");
          expect(content).toMatch(/CMD|ENTRYPOINT/);
        });

        it("has no template variables", () => {
          const content = fs.readFileSync(dockerPath, "utf-8");
          expect(content).not.toMatch(/\{\{[A-Z_]+\}\}/);
        });
      });
    }
  });

  describe("entrypoint.sh validity", () => {
    for (const slug of EXPECTED_SLUGS) {
      describe(slug, () => {
        const entryPath = path.join(STARTERS_DIR, slug, "entrypoint.sh");

        it("starts with shebang", () => {
          const content = fs.readFileSync(entryPath, "utf-8");
          expect(content.startsWith("#!/bin/bash")).toBe(true);
        });

        it("contains the correct slug", () => {
          const content = fs.readFileSync(entryPath, "utf-8");
          expect(content).toContain(slug);
        });

        it("starts Next.js on PORT", () => {
          const content = fs.readFileSync(entryPath, "utf-8");
          expect(content).toContain("next start");
          expect(content).toContain("PORT");
        });

        it("has cleanup trap", () => {
          const content = fs.readFileSync(entryPath, "utf-8");
          expect(content).toContain("trap cleanup EXIT");
        });

        it("has no template variables", () => {
          const content = fs.readFileSync(entryPath, "utf-8");
          expect(content).not.toMatch(/\{\{[A-Z_]+\}\}/);
        });
      });
    }
  });

  describe("framework-appropriate agent files", () => {
    const pythonFrameworks = FRAMEWORKS.filter((f) => f.language === "python");
    const tsFrameworks = FRAMEWORKS.filter((f) => f.language === "typescript");
    const javaFrameworks = FRAMEWORKS.filter((f) => f.language === "java");
    const csharpFrameworks = FRAMEWORKS.filter((f) => f.language === "csharp");

    for (const fw of pythonFrameworks) {
      it(`${fw.slug} has Python agent with requirements.txt`, () => {
        const agentDir = path.join(STARTERS_DIR, fw.slug, fw.agentDir);
        expect(fs.existsSync(path.join(agentDir, "requirements.txt"))).toBe(
          true,
        );
        // At least one .py file
        const pyFiles = fs.existsSync(agentDir)
          ? fs
              .readdirSync(agentDir, { recursive: true })
              .filter((f) => typeof f === "string" && f.endsWith(".py"))
          : [];
        expect(pyFiles.length).toBeGreaterThan(0);
      });
    }

    for (const fw of tsFrameworks) {
      // Mastra is special -- agent lives in src/mastra/
      if (fw.slug === "mastra") {
        it(`${fw.slug} has Mastra agent in src/mastra/`, () => {
          expect(
            fs.existsSync(path.join(STARTERS_DIR, fw.slug, "src", "mastra")),
          ).toBe(true);
        });
        continue;
      }

      it(`${fw.slug} has TypeScript agent`, () => {
        const agentDir = path.join(STARTERS_DIR, fw.slug, "agent");
        if (fs.existsSync(agentDir)) {
          const tsFiles = fs
            .readdirSync(agentDir, { recursive: true })
            .filter(
              (f) =>
                typeof f === "string" &&
                (f.endsWith(".ts") || f.endsWith(".tsx")),
            );
          expect(tsFiles.length).toBeGreaterThan(0);
        }
      });
    }

    for (const fw of javaFrameworks) {
      it(`${fw.slug} has Java agent with pom.xml`, () => {
        const agentDir = path.join(STARTERS_DIR, fw.slug, "agent");
        expect(fs.existsSync(path.join(agentDir, "pom.xml"))).toBe(true);
      });
    }

    for (const fw of csharpFrameworks) {
      it(`${fw.slug} has C# agent with .csproj`, () => {
        const agentDir = path.join(STARTERS_DIR, fw.slug, "agent");
        const csprojFiles = fs.existsSync(agentDir)
          ? fs.readdirSync(agentDir).filter((f) => f.endsWith(".csproj"))
          : [];
        expect(csprojFiles.length).toBeGreaterThan(0);
      });
    }
  });

  describe("showcase.json consistency", () => {
    for (const slug of EXPECTED_SLUGS) {
      it(`${slug} has consistent showcase.json`, () => {
        const meta = JSON.parse(
          fs.readFileSync(
            path.join(STARTERS_DIR, slug, "showcase.json"),
            "utf-8",
          ),
        );
        expect(meta.slug).toBe(slug);
        expect(meta.agentPort).toBe(8123);
        expect(meta.generated).toBe(true);
        // Should have a name matching the framework
        const fw = FRAMEWORKS.find((f) => f.slug === slug)!;
        expect(meta.name).toBe(fw.name);
        expect(meta.language).toBe(fw.language);
      });
    }
  });
});
