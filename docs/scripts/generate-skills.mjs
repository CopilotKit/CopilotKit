#!/usr/bin/env node
/**
 * Generates a single CopilotKit Claude Code skill from docs/content/docs.
 *
 * Output:
 *   skills/copilotkit/
 *     - SKILL.md
 *     - built-in-agent-quickstart.md
 *     - topic-*.md
 *     - framework-*.md
 *     - partner-frameworks.md
 *     - sources.md
 *
 * Usage:
 *   node scripts/generate-skills.mjs
 *   node scripts/generate-skills.mjs --dry-run
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..", "..");
const docsContentDir = path.join(repoRoot, "docs", "content", "docs");
const snippetsDir = path.join(repoRoot, "docs", "snippets");
const skillsRoot = path.join(repoRoot, "skills");
const skillDir = path.join(skillsRoot, "copilotkit");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

const integrationLabelOverrides = {
  adk: "ADK",
  a2a: "A2A",
  ag2: "AG2",
  agno: "Agno",
  "agent-spec": "Open Agent Spec",
  "aws-strands": "AWS Strands",
  "crewai-flows": "CrewAI Flows",
  langgraph: "LangGraph",
  llamaindex: "LlamaIndex",
  mastra: "Mastra",
  "microsoft-agent-framework": "Microsoft Agent Framework",
  "pydantic-ai": "Pydantic AI",
};

const mdxBodyCache = new Map();
const docCache = new Map();

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosixPath(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function listFilesRecursive(dirPath, fileFilter) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const results = [];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (!fileFilter || fileFilter(absolute)) {
        results.push(absolute);
      }
    }
  }

  return results;
}

function parseFrontmatter(rawContent) {
  const frontmatterMatch = rawContent.match(
    /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/,
  );
  if (!frontmatterMatch) {
    return { data: {}, body: rawContent };
  }

  const frontmatterBlock = frontmatterMatch[1];
  const body = rawContent.slice(frontmatterMatch[0].length);
  const data = {};

  for (const line of frontmatterBlock.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)\s*$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }

  return { data, body };
}

/**
 * Detects whether an integration MDX file is a "thin snippet wrapper" —
 * one that simply re-exports shared content with no framework-specific value.
 *
 * A file is thin if it has:
 *   1. NO imports from `@/snippets/integrations/` (framework-specific snippets)
 *   2. No substantive markdown content (≤5 non-blank lines after stripping
 *      imports, JSX tags, exports, and prop-like lines)
 */
function isThinSnippetWrapper(relativeDocPath) {
  const absolutePath = path.join(docsContentDir, relativeDocPath);
  if (!fs.existsSync(absolutePath)) {
    return false;
  }

  const raw = fs.readFileSync(absolutePath, "utf8");
  const { body } = parseFrontmatter(raw);

  // Check for framework-specific snippet imports
  if (/@\/snippets\/integrations\//.test(body)) {
    return false;
  }

  // Strip imports, JSX tags, exports, props, and blanks — count what's left
  const substantiveLines = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (t === "") return false;
      if (t.startsWith("import ")) return false;
      if (t.startsWith("export ")) return false;
      if (/^<[A-Z]/.test(t) || /^<\/[A-Z]/.test(t)) return false;
      if (t === "/>" || t === ">") return false;
      if (/^[A-Za-z0-9_.:-]+\s*=\s*/.test(t)) return false;
      return true;
    });

  return substantiveLines.length <= 5;
}

function resolveSnippetImport(snippetRelativePath) {
  return path.join(snippetsDir, snippetRelativePath);
}

function removeTopLevelMdxImports(body) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const outputLines = [];

  let inCodeFence = false;
  let inImportBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      outputLines.push(line);
      continue;
    }

    if (inCodeFence) {
      outputLines.push(line);
      continue;
    }

    if (inImportBlock) {
      if (trimmed.endsWith(";")) {
        inImportBlock = false;
      }
      continue;
    }

    if (trimmed.startsWith("import ")) {
      if (!trimmed.endsWith(";")) {
        inImportBlock = true;
      }
      continue;
    }

    outputLines.push(line);
  }

  return outputLines.join("\n");
}

function loadMdxBodyWithSnippetInlining(absolutePath, trail = new Set()) {
  const normalizedAbsolutePath = path.resolve(absolutePath);
  if (mdxBodyCache.has(normalizedAbsolutePath)) {
    return mdxBodyCache.get(normalizedAbsolutePath);
  }
  if (trail.has(normalizedAbsolutePath)) {
    return "";
  }
  trail.add(normalizedAbsolutePath);

  const raw = fs.readFileSync(normalizedAbsolutePath, "utf8");
  const { body } = parseFrontmatter(raw);

  const snippetImports = [];
  const snippetImportRegex =
    /^import\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+["']@\/snippets\/([^"']+\.mdx)["'];?\s*$/gm;
  let match = snippetImportRegex.exec(body);
  while (match) {
    snippetImports.push({
      alias: match[1],
      snippetRelativePath: match[2],
    });
    match = snippetImportRegex.exec(body);
  }

  let expanded = removeTopLevelMdxImports(body);
  for (const snippetImport of snippetImports) {
    const snippetAbsolutePath = resolveSnippetImport(
      snippetImport.snippetRelativePath,
    );
    if (!fs.existsSync(snippetAbsolutePath)) {
      continue;
    }

    const replacement = loadMdxBodyWithSnippetInlining(
      snippetAbsolutePath,
      new Set(trail),
    );
    const selfClosingTagRegex = new RegExp(
      `<${snippetImport.alias}(\\s[^>]*)?\\s*\\/\\s*>`,
      "g",
    );
    const blockTagRegex = new RegExp(
      `<${snippetImport.alias}(\\s[^>]*)?>[\\s\\S]*?<\\/${snippetImport.alias}>`,
      "g",
    );

    expanded = expanded
      .replace(blockTagRegex, replacement)
      .replace(selfClosingTagRegex, replacement);
  }

  trail.delete(normalizedAbsolutePath);
  mdxBodyCache.set(normalizedAbsolutePath, expanded);
  return expanded;
}

function stripLowSignalMdxLines(inlinedBody) {
  const lines = inlinedBody.replace(/\r\n/g, "\n").split("\n");
  const outputLines = [];

  let inCodeFence = false;
  let inImportBlock = false;

  for (const originalLine of lines) {
    const trimmedLine = originalLine.trim();

    if (trimmedLine.startsWith("```")) {
      inCodeFence = !inCodeFence;
      outputLines.push(trimmedLine);
      continue;
    }

    if (inCodeFence) {
      outputLines.push(originalLine);
      continue;
    }

    if (inImportBlock) {
      if (trimmedLine.endsWith(";")) {
        inImportBlock = false;
      }
      continue;
    }

    if (trimmedLine.startsWith("import ")) {
      if (!trimmedLine.endsWith(";")) {
        inImportBlock = true;
      }
      continue;
    }

    if (trimmedLine === "") {
      if (outputLines.length === 0 || outputLines[outputLines.length - 1] === "") {
        continue;
      }
      outputLines.push("");
      continue;
    }

    if (trimmedLine.startsWith("export ")) {
      continue;
    }
    if (trimmedLine === "{" || trimmedLine === "}" || trimmedLine === '{" "}') {
      continue;
    }
    if (trimmedLine.startsWith("<") || trimmedLine.startsWith("</")) {
      continue;
    }
    if (trimmedLine.endsWith("/>") || trimmedLine === ">" || trimmedLine === "/>") {
      continue;
    }
    if (/^[A-Za-z0-9_.:-]+\s*=\s*.*$/.test(trimmedLine)) {
      continue;
    }
    if (/^[A-Za-z0-9_.:-]+\s*:\s*["'`].*["'`],?$/.test(trimmedLine)) {
      continue;
    }
    if (/^\}\s*from\s+["'][^"']+["'];?$/.test(trimmedLine)) {
      continue;
    }
    if (/^[\[\]\{\},]+$/.test(trimmedLine)) {
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*,\s*$/.test(trimmedLine)) {
      continue;
    }
    if (/^[a-z][A-Za-z0-9]*$/.test(trimmedLine)) {
      continue;
    }
    if (
      trimmedLine.includes(' from "@/') ||
      trimmedLine.includes(" from \"@/") ||
      trimmedLine.includes(' from "@') ||
      trimmedLine.includes(" from \"@")
    ) {
      continue;
    }

    let normalizedLine = originalLine;
    normalizedLine = normalizedLine.replace(/\{\/\*.*?\*\/\}/g, "");
    normalizedLine = normalizedLine.replace(/\[!code[^\]]*\]/g, "");
    normalizedLine = normalizedLine.replace(/<[^>]+>/g, "");
    normalizedLine = normalizedLine.replace(/\s+$/, "");

    if (normalizedLine.trim() === "") {
      if (outputLines.length === 0 || outputLines[outputLines.length - 1] === "") {
        continue;
      }
      outputLines.push("");
      continue;
    }

    outputLines.push(normalizedLine);
  }

  while (outputLines.length > 0 && outputLines[outputLines.length - 1] === "") {
    outputLines.pop();
  }

  return outputLines;
}

function filterExcludedSections(lines) {
  const excludedHeadingMatchers = [
    /^vibe coding mcp$/i,
    /^cursor$/i,
    /^claude web$/i,
    /^claude desktop$/i,
    /^claude code$/i,
    /^windsurf$/i,
    /^cline$/i,
    /^state machine$/i,
    /^mcp\s+/i,
    /model context protocol/i,
    /state machine/i,
  ];

  const output = [];
  const isCodeFenceLine = (line) => line.trim().startsWith("```");
  let inCodeFence = false;
  let skipUntilHeadingLevel = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (isCodeFenceLine(line)) {
      inCodeFence = !inCodeFence;
      if (skipUntilHeadingLevel === null) {
        output.push(line);
      }
      continue;
    }

    if (!inCodeFence) {
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2].trim();

        if (skipUntilHeadingLevel !== null && level <= skipUntilHeadingLevel) {
          skipUntilHeadingLevel = null;
        }

        if (
          skipUntilHeadingLevel === null &&
          excludedHeadingMatchers.some((matcher) => matcher.test(headingText))
        ) {
          skipUntilHeadingLevel = level;
          continue;
        }
      }
    }

    if (skipUntilHeadingLevel === null) {
      output.push(line);
    }
  }

  const normalized = [];
  for (const line of output) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (normalized.length === 0 || normalized[normalized.length - 1] === "") {
        continue;
      }
      normalized.push("");
    } else {
      normalized.push(line);
    }
  }
  while (normalized.length > 0 && normalized[normalized.length - 1] === "") {
    normalized.pop();
  }

  return normalized;
}

function buildDocContent(lines) {
  return lines.join("\n").trim();
}

function toDocsRoute(relativeDocPath) {
  const routeParts = relativeDocPath.replace(/\.mdx$/, "").split("/");

  if (routeParts[0] === "(root)") {
    routeParts.shift();
  } else if (routeParts[0] === "integrations") {
    routeParts.shift();
  }

  const cleanedParts = routeParts.filter((part) => part !== "(other)");
  if (cleanedParts[cleanedParts.length - 1] === "index") {
    cleanedParts.pop();
  }

  if (cleanedParts.length === 0) {
    return "/";
  }
  return `/${cleanedParts.join("/")}`;
}

function humanizeSlug(raw) {
  return raw
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function loadDoc(relativeDocPath) {
  if (docCache.has(relativeDocPath)) {
    return docCache.get(relativeDocPath);
  }

  const absolutePath = path.join(docsContentDir, relativeDocPath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  const raw = fs.readFileSync(absolutePath, "utf8");
  const { data } = parseFrontmatter(raw);
  const inlined = loadMdxBodyWithSnippetInlining(absolutePath);
  const filteredLines = filterExcludedSections(stripLowSignalMdxLines(inlined));
  const content = buildDocContent(filteredLines);

  const title =
    typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : humanizeSlug(path.basename(relativeDocPath, ".mdx"));
  const description =
    typeof data.description === "string" && data.description.trim()
      ? data.description.trim()
      : "";

  const doc = {
    title,
    description,
    route: toDocsRoute(relativeDocPath),
    relativeDocPath,
    content,
  };

  docCache.set(relativeDocPath, doc);
  return doc;
}

function getAllDocRelativePaths() {
  const absolutePaths = listFilesRecursive(
    docsContentDir,
    (candidate) => candidate.endsWith(".mdx"),
  );
  return absolutePaths
    .map((absolutePath) => toPosixPath(path.relative(docsContentDir, absolutePath)))
    .sort();
}

function getIntegrationOrder() {
  const integrationsMetaPath = path.join(
    docsContentDir,
    "integrations",
    "meta.json",
  );
  if (!fs.existsSync(integrationsMetaPath)) {
    return [];
  }

  const raw = fs.readFileSync(integrationsMetaPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.pages)) {
    return [];
  }

  return parsed.pages.filter(
    (item) =>
      typeof item === "string" &&
      !item.startsWith("---") &&
      !item.startsWith("..."),
  );
}

function pickDocByExactPath(paths, candidate) {
  return paths.includes(candidate) ? candidate : null;
}

function pickFirstDocByPattern(paths, pattern) {
  return paths.find((docPath) => pattern.test(docPath)) || null;
}

function pickIntegrationDocs(allDocPaths, integrationId) {
  const integrationPrefix = `integrations/${integrationId}/`;
  const integrationDocPaths = allDocPaths
    .filter((docPath) => docPath.startsWith(integrationPrefix))
    .map((docPath) => docPath.slice(integrationPrefix.length))
    .filter((integrationDocPath) => !integrationDocPath.startsWith("(other)/"))
    .filter((integrationDocPath) => !/mcp/i.test(integrationDocPath))
    .filter((integrationDocPath) => !/state[- ]?machine/i.test(integrationDocPath))
    .sort();

  return integrationDocPaths
    .map((integrationDocPath) => `${integrationPrefix}${integrationDocPath}`)
    .filter((fullPath) => !isThinSnippetWrapper(fullPath));
}

function resolveDocs(allDocPaths, candidatePaths) {
  const filteredPaths = candidatePaths.filter((docPath) =>
    allDocPaths.includes(docPath),
  );
  return filteredPaths.map((docPath) => loadDoc(docPath)).filter(Boolean);
}

function renderDocSections(docs) {
  const meaningfulDocs = docs.filter((doc) => Boolean(doc.content));

  if (meaningfulDocs.length === 0) {
    return "_No source docs were resolved for this topic._";
  }

  return meaningfulDocs
    .map((doc) => {
      const details = [
        `### ${doc.title}`,
        `- Route: \`${doc.route}\``,
        `- Source: \`docs/content/docs/${doc.relativeDocPath}\``,
      ];
      if (doc.description) {
        details.push(`- Description: ${doc.description}`);
      }

      details.push("", doc.content);
      return details.join("\n");
    })
    .join("\n\n");
}

function renderSourceLinks(docs) {
  if (docs.length === 0) {
    return "- _No routes resolved_";
  }

  return docs
    .map((doc) => `- \`${doc.route}\` (\`docs/content/docs/${doc.relativeDocPath}\`)`)
    .join("\n");
}

function renderGuideDoc({ title, summary, docs, crossRefNote }) {
  const crossRef = crossRefNote
    ? `> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.\n\n`
    : "";

  return `# ${title}

${summary}

${crossRef}## Guidance
${renderDocSections(docs)}
`;
}

function renderBuiltInAgentQuickstartDoc(docs) {
  return `# BuiltInAgent Quickstart

Use this as the default path when a user asks to build a basic CopilotKit app fast.

## Minimal stack
- Runtime endpoint on your backend (\`@copilotkit/runtime\`)
- \`BuiltInAgent\` registered as the default agent
- \`CopilotKit\` provider in the frontend
- One chat UI component (\`CopilotSidebar\` or \`CopilotChat\`)

## Canonical starter (Next.js App Router)

\`\`\`ts title="app/api/copilotkit/route.ts"
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { NextRequest } from "next/server";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: "You are a helpful assistant.",
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
});
const serviceAdapter = new ExperimentalEmptyAdapter();

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
\`\`\`

\`\`\`tsx title="app/layout.tsx"
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>
      </body>
    </html>
  );
}
\`\`\`

\`\`\`tsx title="app/page.tsx"
"use client";

import { CopilotSidebar } from "@copilotkit/react-ui";

export default function Page() {
  return <CopilotSidebar defaultOpen />;
}
\`\`\`

## Checklist
1. Install packages: \`@copilotkit/react-core\`, \`@copilotkit/react-ui\`, \`@copilotkit/runtime\`
2. Set provider runtime URL to your backend endpoint.
3. Set an LLM API key (\`OPENAI_API_KEY\` or provider equivalent) in env.
4. Confirm the runtime route and UI route are both running.
5. Expand with frontend tools, context, shared state, or a framework integration as needed.

## Additional guidance from docs
${renderDocSections(docs)}
`;
}

function renderPartnerFrameworksOverview(frameworkEntries) {
  const links = frameworkEntries
    .map((entry) => `- [${entry.label}](framework-${entry.id}.md)`)
    .join("\n");

  return `# Partner Frameworks

Use this index to jump to partner-framework-specific implementation guides.

${links}
`;
}

function renderSkillMd({ topicFiles, frameworkEntries }) {
  const majorLinks = topicFiles
    .map((topicFile) => `- [${topicFile.label}](${topicFile.fileName})`)
    .join("\n");

  const frameworkLinks = frameworkEntries
    .map((entry) => `- [${entry.label}](framework-${entry.id}.md)`)
    .join("\n");

  return `---
name: copilotkit
description: Single CopilotKit implementation skill with BuiltInAgent starter path and linked subtopic guides.
argument-hint: "<task>"
user-invocable: true
---

Use this skill for any CopilotKit implementation, debugging, migration, or architecture request.

## Default Path: Build A Basic CopilotKit App (BuiltInAgent)

Follow this path first unless the user explicitly asks for a specific framework:
1. Create runtime endpoint with \`CopilotRuntime\` and \`BuiltInAgent\`.
2. Register the agent as \`default\` in runtime config.
3. Wrap the app with \`<CopilotKit runtimeUrl="/api/copilotkit">\`.
4. Add \`CopilotSidebar\` (or \`CopilotChat\`) to the page.
5. Verify end-to-end request flow before adding advanced features.

Use [BuiltInAgent Quickstart](built-in-agent-quickstart.md) for the full code scaffold and checklist.

## Major Topics
${majorLinks}

## Partner Frameworks
Framework index: [Partner Frameworks Overview](partner-frameworks.md)

${frameworkLinks}

## Navigation Hints
- Start with BuiltInAgent quickstart for generic requests.
- For framework-specific asks, jump directly to that framework doc.
- For architecture and cross-cutting concerns, use the major topic docs.
- Each linked guide includes route-level source pointers back to docs content.
`;
}

function removeLegacyGeneratedSkills() {
  if (!fs.existsSync(skillsRoot)) {
    ensureDir(skillsRoot);
  }

  const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("autogen-")) {
      fs.rmSync(path.join(skillsRoot, entry.name), { recursive: true, force: true });
    }
  }

  const legacyFiles = [
    "AUTOGEN_MANIFEST.json",
    "AUTOGEN_README.md",
  ];
  for (const legacyFile of legacyFiles) {
    const legacyPath = path.join(skillsRoot, legacyFile);
    if (fs.existsSync(legacyPath)) {
      fs.rmSync(legacyPath, { force: true });
    }
  }

  // Previous generator versions wrote to .claude/skills.
  // We clean only the generated copilotkit folder there to avoid confusion.
  const oldClaudeSkillsDir = path.join(repoRoot, ".claude", "skills");
  const oldGeneratedSkillDir = path.join(oldClaudeSkillsDir, "copilotkit");
  if (fs.existsSync(oldGeneratedSkillDir)) {
    fs.rmSync(oldGeneratedSkillDir, { recursive: true, force: true });
  }
}

function buildTopicSpecs() {
  return [
    {
      fileName: "built-in-agent-quickstart.md",
      label: "BuiltInAgent Quickstart",
      summary:
        "Minimal end-to-end setup path using Copilot Runtime + BuiltInAgent.",
      docPaths: [
        "(root)/backend/copilot-runtime.mdx",
        "(root)/generative-ui/mcp-apps.mdx",
        "integrations/built-in-agent/quickstart.mdx",
      ],
      kind: "builtin",
    },
    {
      fileName: "topic-backend.md",
      label: "Backend",
      summary:
        "Runtime architecture, endpoint setup, AG-UI protocol, and backend integration.",
      docPaths: [
        "(root)/backend/copilot-runtime.mdx",
        "(root)/backend/ag-ui.mdx",
        "(root)/ag-ui-middleware.mdx",
        "learn/connect-mcp-servers.mdx",
      ],
    },
    {
      fileName: "topic-agentic-chat-ui.md",
      label: "Agentic Chat UI",
      summary:
        "Chat UI integration patterns, prebuilt components, and customization entry points.",
      docPaths: [
        "(root)/agentic-chat-ui.mdx",
        "(root)/prebuilt-components.mdx",
        "(root)/programmatic-control.mdx",
        "(root)/custom-look-and-feel/headless-ui.mdx",
        "(root)/custom-look-and-feel/slots.mdx",
      ],
    },
    {
      fileName: "topic-frontend-tools.md",
      label: "Frontend Tools",
      summary: "Client-side tool patterns and UI-side execution guidance.",
      docPaths: [
        "(root)/frontend-tools.mdx",
        "(root)/frontend-actions.mdx",
        "(root)/copilot-suggestions.mdx",
      ],
    },
    {
      fileName: "topic-shared-state.md",
      label: "Shared State",
      summary: "Patterns for app/agent state synchronization and control.",
      docPaths: [
        "(root)/shared-state.mdx",
      ],
    },
    {
      fileName: "topic-human-in-the-loop.md",
      label: "Human In The Loop",
      summary: "User interruption, approval, and checkpoint design patterns.",
      docPaths: [
        "(root)/human-in-the-loop.mdx",
      ],
    },
    {
      fileName: "topic-generative-ui.md",
      label: "Generative UI",
      summary: "Streaming UI patterns, rendering tools, and generative UI specs.",
      docPaths: [
        "learn/generative-ui/index.mdx",
        "learn/generative-ui/specs/index.mdx",
        "(root)/generative-ui/tool-rendering.mdx",
        "(root)/generative-ui/your-components/display-only.mdx",
        "(root)/generative-ui/your-components/interactive.mdx",
      ],
    },
    {
      fileName: "topic-agentic-protocols.md",
      label: "Agentic Protocols",
      summary: "AG-UI, MCP, and A2A protocol-level integration guidance.",
      docPaths: [
        "learn/agentic-protocols.mdx",
        "learn/ag-ui-protocol.mdx",
        "learn/connect-mcp-servers.mdx",
        "learn/a2a-protocol.mdx",
      ],
    },
    {
      fileName: "topic-reference-v2.md",
      label: "V2 API Reference",
      summary: "V2 hooks/components references and API-oriented documentation.",
      docPaths: [
        "reference/v2/index.mdx",
        "reference/v2/hooks/useAgent.mdx",
        "reference/v2/hooks/useFrontendTool.mdx",
        "reference/v2/hooks/useAgentContext.mdx",
        "reference/v2/components/CopilotChat.mdx",
        "reference/v2/components/CopilotSidebar.mdx",
      ],
    },
    {
      fileName: "topic-troubleshooting.md",
      label: "Troubleshooting",
      summary: "Common failures, debugging patterns, and migration notes.",
      docPaths: [
        "(root)/troubleshooting/common-issues.mdx",
        "(root)/troubleshooting/error-debugging.mdx",
        "(root)/troubleshooting/migrate-to-v2.mdx",
        "(root)/troubleshooting/migrate-to-1.10.X.mdx",
        "(root)/premium/observability.mdx",
        "(root)/inspector.mdx",
      ],
    },
  ];
}

function main() {
  const allDocPaths = getAllDocRelativePaths();
  const integrationIds = getIntegrationOrder();

  const frameworkEntries = integrationIds.map((id) => {
    const docs = resolveDocs(allDocPaths, pickIntegrationDocs(allDocPaths, id));
    return {
      id,
      label: integrationLabelOverrides[id] || humanizeSlug(id),
      docs,
    };
  });

  const topicSpecs = buildTopicSpecs();
  const topicFiles = topicSpecs.map((topicSpec) => ({
    fileName: topicSpec.fileName,
    label: topicSpec.label,
    summary: topicSpec.summary,
    kind: topicSpec.kind || "topic",
    docs: resolveDocs(allDocPaths, topicSpec.docPaths),
  }));

  const filesToWrite = new Map();

  for (const topicFile of topicFiles) {
    if (topicFile.kind === "builtin") {
      filesToWrite.set(
        topicFile.fileName,
        renderBuiltInAgentQuickstartDoc(topicFile.docs),
      );
    } else {
      filesToWrite.set(
        topicFile.fileName,
        renderGuideDoc({
          title: topicFile.label,
          summary: topicFile.summary,
          docs: topicFile.docs,
        }),
      );
    }
  }

  filesToWrite.set(
    "partner-frameworks.md",
    renderPartnerFrameworksOverview(frameworkEntries),
  );

  for (const frameworkEntry of frameworkEntries) {
    filesToWrite.set(
      `framework-${frameworkEntry.id}.md`,
      renderGuideDoc({
        title: `${frameworkEntry.label} Integration`,
        summary: `CopilotKit implementation guide for ${frameworkEntry.label}.`,
        docs: frameworkEntry.docs,
        crossRefNote: true,
      }),
    );
  }

  const allResolvedDocs = [
    ...topicFiles.flatMap((topicFile) => topicFile.docs),
    ...frameworkEntries.flatMap((frameworkEntry) => frameworkEntry.docs),
  ];
  const uniqueSourcePaths = Array.from(
    new Set(allResolvedDocs.map((doc) => doc.relativeDocPath)),
  ).sort();

  filesToWrite.set(
    "sources.md",
    `# Sources\n\n${uniqueSourcePaths
      .map((docPath) => `- \`docs/content/docs/${docPath}\``)
      .join("\n")}\n`,
  );

  filesToWrite.set(
    "SKILL.md",
    renderSkillMd({ topicFiles, frameworkEntries }),
  );

  if (dryRun) {
    console.log("Dry run: copilotkit skill files");
    for (const [fileName] of filesToWrite) {
      console.log(`- ${fileName}`);
    }
    console.log(
      `Framework guides: ${frameworkEntries.length}, topic guides: ${topicFiles.length}`,
    );
    return;
  }

  ensureDir(skillsRoot);
  removeLegacyGeneratedSkills();
  fs.rmSync(skillDir, { recursive: true, force: true });
  ensureDir(skillDir);

  for (const [fileName, content] of filesToWrite) {
    fs.writeFileSync(path.join(skillDir, fileName), content, "utf8");
  }

  console.log(
    `Generated copilotkit skill at skills/copilotkit with ${filesToWrite.size} files`,
  );
}

main();
