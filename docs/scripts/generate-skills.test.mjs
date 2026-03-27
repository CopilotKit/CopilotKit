#!/usr/bin/env node
/**
 * Tests for the CopilotKit skill generation pipeline.
 *
 * Runs the generator into a temp directory and validates the output
 * for correctness, completeness, and quality.
 *
 * Usage:
 *   node --test docs/scripts/generate-skills.test.mjs
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const skillDir = path.join(repoRoot, "skills", "copilotkit");

// ─── Helpers ───────────────────────────────────────────────────────────────

function readSkill(filename) {
  return fs.readFileSync(path.join(skillDir, filename), "utf8");
}

function allSkillFiles() {
  return fs.readdirSync(skillDir).filter((f) => f.endsWith(".md")).sort();
}

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)\s*$/);
    if (m) data[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return data;
}

// ─── Regenerate before tests ───────────────────────────────────────────────

before(() => {
  execFileSync("node", [path.join(__dirname, "generate-skills.mjs")], {
    cwd: repoRoot,
    stdio: "pipe",
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Generation output structure
// ═══════════════════════════════════════════════════════════════════════════

describe("generation output structure", () => {
  it("produces the skills directory", () => {
    assert.ok(fs.existsSync(skillDir), "skills/copilotkit/ should exist");
  });

  it("produces SKILL.md as the entry point", () => {
    assert.ok(fs.existsSync(path.join(skillDir, "SKILL.md")));
  });

  it("produces sources.md", () => {
    assert.ok(fs.existsSync(path.join(skillDir, "sources.md")));
  });

  it("produces partner-frameworks.md", () => {
    assert.ok(fs.existsSync(path.join(skillDir, "partner-frameworks.md")));
  });

  it("produces built-in-agent-quickstart.md", () => {
    assert.ok(
      fs.existsSync(path.join(skillDir, "built-in-agent-quickstart.md")),
    );
  });

  it("produces topic files for all major topics", () => {
    const expectedTopics = [
      "topic-backend.md",
      "topic-agentic-chat-ui.md",
      "topic-frontend-tools.md",
      "topic-shared-state.md",
      "topic-human-in-the-loop.md",
      "topic-generative-ui.md",
      "topic-agentic-protocols.md",
      "topic-api-reference.md",
      "topic-troubleshooting.md",
    ];
    for (const topic of expectedTopics) {
      assert.ok(
        fs.existsSync(path.join(skillDir, topic)),
        `${topic} should exist`,
      );
    }
  });

  it("produces framework files for all integrations", () => {
    const files = allSkillFiles();
    const frameworkFiles = files.filter((f) => f.startsWith("framework-"));
    assert.ok(
      frameworkFiles.length >= 10,
      `Should have at least 10 framework files, got ${frameworkFiles.length}`,
    );
  });

  it("produces no empty files", () => {
    for (const file of allSkillFiles()) {
      const content = readSkill(file);
      assert.ok(
        content.trim().length > 10,
        `${file} should not be empty (got ${content.trim().length} chars)`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. SKILL.md quality
// ═══════════════════════════════════════════════════════════════════════════

describe("SKILL.md quality", () => {
  let content;
  let frontmatter;

  before(() => {
    content = readSkill("SKILL.md");
    frontmatter = parseFrontmatter(content);
  });

  it("has valid frontmatter with required fields", () => {
    assert.equal(frontmatter.name, "copilotkit");
    assert.ok(frontmatter.description, "description should be present");
    assert.ok(
      frontmatter["user-invocable"] === "true",
      "should be user-invocable",
    );
  });

  it("has a description with trigger keywords", () => {
    const desc = frontmatter.description.toLowerCase();
    assert.ok(desc.includes("copilotkit"), "description should mention CopilotKit");
    assert.ok(
      desc.includes("runtime") || desc.includes("agent"),
      "description should mention runtime or agent",
    );
  });

  it("has a description under 1024 chars", () => {
    assert.ok(
      frontmatter.description.length <= 1024,
      `description is ${frontmatter.description.length} chars, max is 1024`,
    );
  });

  it("links to all topic files that exist", () => {
    const linkPattern = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
    let match;
    while ((match = linkPattern.exec(content)) !== null) {
      const linkedFile = match[2];
      assert.ok(
        fs.existsSync(path.join(skillDir, linkedFile)),
        `SKILL.md links to ${linkedFile} but it doesn't exist`,
      );
    }
  });

  it("links to all generated topic files", () => {
    const topicFiles = allSkillFiles().filter((f) => f.startsWith("topic-"));
    for (const topic of topicFiles) {
      assert.ok(
        content.includes(topic),
        `SKILL.md should link to ${topic}`,
      );
    }
  });

  it("includes the default quickstart path", () => {
    assert.ok(
      content.includes("BuiltInAgent") && content.includes("quickstart"),
      "should reference BuiltInAgent quickstart as default path",
    );
  });

  it("body is under 500 lines (best practice)", () => {
    const lineCount = content.split("\n").length;
    assert.ok(
      lineCount <= 500,
      `SKILL.md is ${lineCount} lines, best practice is under 500`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. v1 content exclusion
// ═══════════════════════════════════════════════════════════════════════════

describe("v1 content exclusion", () => {
  it("no files contain reference/v1/ links", () => {
    for (const file of allSkillFiles()) {
      const content = readSkill(file);
      assert.ok(
        !content.includes("reference/v1/"),
        `${file} contains reference/v1/ links`,
      );
    }
  });

  it("no files reference migration docs", () => {
    for (const file of allSkillFiles()) {
      const content = readSkill(file);
      assert.ok(
        !content.includes("migrate-to-1."),
        `${file} references v1 migration docs (migrate-to-1.x)`,
      );
    }
  });

  it("no tutorial files are generated", () => {
    const files = allSkillFiles();
    const tutorialFiles = files.filter(
      (f) => f.includes("tutorial") && !f.includes("troubleshooting"),
    );
    assert.equal(
      tutorialFiles.length,
      0,
      `Should have no tutorial files, found: ${tutorialFiles.join(", ")}`,
    );
  });

  it("topic-reference-v2.md does not exist (renamed to topic-api-reference.md)", () => {
    assert.ok(
      !fs.existsSync(path.join(skillDir, "topic-reference-v2.md")),
      "topic-reference-v2.md should not exist",
    );
    assert.ok(
      fs.existsSync(path.join(skillDir, "topic-api-reference.md")),
      "topic-api-reference.md should exist",
    );
  });

  it("sources.md does not list v1 reference docs", () => {
    const sources = readSkill("sources.md");
    assert.ok(
      !sources.includes("reference/v1/"),
      "sources.md should not list reference/v1/ docs",
    );
  });

  it("sources.md does not list migration docs", () => {
    const sources = readSkill("sources.md");
    assert.ok(
      !sources.includes("migrate-to-1."),
      "sources.md should not list v1 migration docs",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. MDX artifact cleanup
// ═══════════════════════════════════════════════════════════════════════════

describe("MDX artifact cleanup", () => {
  it("no files contain MDX import statements", () => {
    for (const file of allSkillFiles()) {
      const content = readSkill(file);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Skip lines inside code fences
        if (line.startsWith("```")) continue;
        // Check for MDX-style imports (not inside code blocks)
        if (line.startsWith("import ") && line.includes("from ")) {
          // Allow imports inside code blocks by checking fence context
          let inFence = false;
          for (let j = 0; j < i; j++) {
            if (lines[j].trim().startsWith("```")) inFence = !inFence;
          }
          if (!inFence) {
            assert.fail(
              `${file}:${i + 1} contains an MDX import: "${line.slice(0, 80)}"`,
            );
          }
        }
      }
    }
  });

  it("no files contain unresolved JSX component tags outside code blocks", () => {
    for (const file of allSkillFiles()) {
      const content = readSkill(file);
      const lines = content.split("\n");
      let inFence = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("```")) {
          inFence = !inFence;
          continue;
        }
        if (!inFence && /^<[A-Z][A-Za-z]+[\s/>]/.test(line)) {
          // Allow common markdown/HTML-like patterns
          if (
            line.startsWith("<CopilotKit") ||
            line.startsWith("<CopilotSidebar") ||
            line.startsWith("<CopilotChat") ||
            line.startsWith("<CopilotPopup")
          ) {
            continue; // These appear in inline code discussion
          }
          assert.fail(
            `${file}:${i + 1} contains unresolved JSX: "${line.slice(0, 80)}"`,
          );
        }
      }
    }
  });

  it("no files contain MDX export statements outside code blocks", () => {
    for (const file of allSkillFiles()) {
      const content = readSkill(file);
      const lines = content.split("\n");
      let inFence = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("```")) {
          inFence = !inFence;
          continue;
        }
        if (!inFence && line.startsWith("export ")) {
          assert.fail(
            `${file}:${i + 1} contains MDX export: "${line.slice(0, 80)}"`,
          );
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Internal link integrity
// ═══════════════════════════════════════════════════════════════════════════

describe("internal link integrity", () => {
  it("all markdown links between skill files resolve", () => {
    const broken = [];
    for (const file of allSkillFiles()) {
      const content = readSkill(file);
      const linkPattern = /\[([^\]]*)\]\(([^)]+\.md)\)/g;
      let match;
      while ((match = linkPattern.exec(content)) !== null) {
        const target = match[2];
        // Only check relative links (not URLs)
        if (target.startsWith("http")) continue;
        if (!fs.existsSync(path.join(skillDir, target))) {
          broken.push({ from: file, to: target, label: match[1] });
        }
      }
    }
    if (broken.length > 0) {
      const details = broken
        .map((b) => `  ${b.from} -> ${b.to} ("${b.label}")`)
        .join("\n");
      assert.fail(`Found ${broken.length} broken internal links:\n${details}`);
    }
  });

  it("partner-frameworks.md links match actual framework files", () => {
    const content = readSkill("partner-frameworks.md");
    const linkPattern = /\(framework-([^)]+\.md)\)/g;
    let match;
    while ((match = linkPattern.exec(content)) !== null) {
      const target = `framework-${match[1]}`;
      assert.ok(
        fs.existsSync(path.join(skillDir, target)),
        `partner-frameworks.md links to ${target} which doesn't exist`,
      );
    }
  });

  it("split framework index files link to their sub-guides", () => {
    // Find index files (small framework files that link to sub-guides)
    for (const file of allSkillFiles()) {
      if (!file.startsWith("framework-")) continue;
      const content = readSkill(file);
      if (!content.includes("Sub-guides")) continue;

      const linkPattern = /\(framework-[^)]+\.md\)/g;
      let match;
      while ((match = linkPattern.exec(content)) !== null) {
        const target = match[0].slice(1, -1);
        assert.ok(
          fs.existsSync(path.join(skillDir, target)),
          `Index file ${file} links to missing sub-guide ${target}`,
        );
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Content quality
// ═══════════════════════════════════════════════════════════════════════════

describe("content quality", () => {
  it("every framework file has at least one code example", () => {
    for (const file of allSkillFiles()) {
      if (!file.startsWith("framework-")) continue;
      const content = readSkill(file);
      // Skip small index files
      if (content.length < 1000) continue;
      assert.ok(
        content.includes("```"),
        `${file} has no code examples`,
      );
    }
  });

  it("every topic file has meaningful content (>500 chars)", () => {
    for (const file of allSkillFiles()) {
      if (!file.startsWith("topic-")) continue;
      const content = readSkill(file);
      assert.ok(
        content.length > 500,
        `${file} is too short (${content.length} chars)`,
      );
    }
  });

  it("built-in-agent-quickstart.md contains a working code scaffold", () => {
    const content = readSkill("built-in-agent-quickstart.md");
    assert.ok(content.includes("CopilotRuntime"), "should have CopilotRuntime");
    assert.ok(content.includes("BuiltInAgent"), "should have BuiltInAgent");
    assert.ok(content.includes("CopilotKit"), "should have CopilotKit provider");
    assert.ok(
      content.includes("CopilotSidebar") || content.includes("CopilotChat"),
      "should have a chat UI component",
    );
    assert.ok(
      content.includes("copilotRuntimeNextJSAppRouterEndpoint"),
      "should have the endpoint helper",
    );
  });

  it("quickstart canonical starter uses current v2 import paths", () => {
    const content = readSkill("built-in-agent-quickstart.md");
    // Check the canonical starter section (before "Additional guidance")
    const canonicalSection = content.split("## Additional guidance")[0];
    assert.ok(
      canonicalSection.includes('@copilotkit/runtime/v2'),
      "canonical starter should import BuiltInAgent from @copilotkit/runtime/v2",
    );
    assert.ok(
      !canonicalSection.includes("ExperimentalEmptyAdapter"),
      "canonical starter should not use deprecated ExperimentalEmptyAdapter",
    );
  });

  it("no file contains 'Coming soon' placeholder without other content", () => {
    for (const file of allSkillFiles()) {
      const content = readSkill(file);
      if (content.includes("Coming soon")) {
        // It's okay if the file has substantial other content
        const withoutPlaceholder = content.replace(/Coming soon\.?/g, "").trim();
        assert.ok(
          withoutPlaceholder.length > 200,
          `${file} is mostly a 'Coming soon' placeholder`,
        );
      }
    }
  });

  it("sources.md lists at least 50 source docs", () => {
    const sources = readSkill("sources.md");
    const sourceCount = (sources.match(/^- `/gm) || []).length;
    assert.ok(
      sourceCount >= 50,
      `sources.md lists only ${sourceCount} docs, expected at least 50`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. File size sanity
// ═══════════════════════════════════════════════════════════════════════════

describe("file size sanity", () => {
  it("SKILL.md is compact (<5KB)", () => {
    const size = fs.statSync(path.join(skillDir, "SKILL.md")).size;
    assert.ok(
      size < 5 * 1024,
      `SKILL.md is ${(size / 1024).toFixed(1)}KB, should be under 5KB`,
    );
  });

  it("no single file exceeds 200KB", () => {
    for (const file of allSkillFiles()) {
      const size = fs.statSync(path.join(skillDir, file)).size;
      assert.ok(
        size < 200 * 1024,
        `${file} is ${(size / 1024).toFixed(1)}KB, max is 200KB`,
      );
    }
  });

  it("split index files are small (<2KB)", () => {
    // Index files for split frameworks should be tiny navigation hubs
    for (const file of allSkillFiles()) {
      if (!file.startsWith("framework-")) continue;
      const content = readSkill(file);
      if (!content.includes("Sub-guides")) continue;
      const size = fs.statSync(path.join(skillDir, file)).size;
      assert.ok(
        size < 2 * 1024,
        `Split index ${file} is ${(size / 1024).toFixed(1)}KB, should be under 2KB`,
      );
    }
  });

  it("total skill size is reasonable (<2MB)", () => {
    let total = 0;
    for (const file of allSkillFiles()) {
      total += fs.statSync(path.join(skillDir, file)).size;
    }
    assert.ok(
      total < 2 * 1024 * 1024,
      `Total size is ${(total / 1024 / 1024).toFixed(1)}MB, should be under 2MB`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Framework coverage
// ═══════════════════════════════════════════════════════════════════════════

describe("framework coverage", () => {
  const expectedFrameworks = [
    "a2a",
    "adk",
    "ag2",
    "agent-spec",
    "agno",
    "aws-strands",
    "built-in-agent",
    "crewai-flows",
    "langgraph",
    "llamaindex",
    "mastra",
    "microsoft-agent-framework",
    "pydantic-ai",
  ];

  for (const fw of expectedFrameworks) {
    it(`has a framework file for ${fw}`, () => {
      assert.ok(
        fs.existsSync(path.join(skillDir, `framework-${fw}.md`)),
        `framework-${fw}.md should exist`,
      );
    });
  }

  it("partner-frameworks.md mentions all frameworks", () => {
    const content = readSkill("partner-frameworks.md").toLowerCase();
    const labels = [
      "a2a", "adk", "ag2", "agent spec", "agno", "aws strands",
      "built in agent", "crewai", "langgraph", "llamaindex",
      "mastra", "microsoft agent framework", "pydantic ai",
    ];
    for (const label of labels) {
      assert.ok(
        content.includes(label),
        `partner-frameworks.md should mention "${label}"`,
      );
    }
  });

  it("SKILL.md links to all frameworks (directly or via sub-guides)", () => {
    const content = readSkill("SKILL.md");
    for (const fw of expectedFrameworks) {
      // Split frameworks link to sub-guides (e.g. framework-langgraph-core.md)
      // instead of the index file directly
      assert.ok(
        content.includes(`framework-${fw}`),
        `SKILL.md should link to framework-${fw} (directly or via sub-guides)`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Dry run mode
// ═══════════════════════════════════════════════════════════════════════════

describe("dry run mode", () => {
  it("--dry-run produces output without writing files", () => {
    const output = execFileSync(
      "node",
      [path.join(__dirname, "generate-skills.mjs"), "--dry-run"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.ok(
      output.includes("Dry run"),
      "dry run should print a dry run message",
    );
    assert.ok(
      output.includes("SKILL.md"),
      "dry run should list SKILL.md",
    );
  });
});
