import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import demoContent from "@/data/demo-content.json";
import { loadDoc } from "../docs-render";
import {
  getAllLlmPages,
  renderPageToLlmText,
  rewriteScopedDocsLinks,
} from "../llm-text";

test("expands Intelligence capability cards into readable Markdown links", () => {
  const page = getAllLlmPages().find(
    (entry) => entry.url === "intelligence/overview",
  );
  expect(page).toBeDefined();
  const output = renderPageToLlmText(page!);

  for (const href of [
    "/threads",
    "/intelligence/memories",
    "/learning",
    "/intelligence/analytics",
    "/intelligence/channels",
    "/inspector",
  ]) {
    expect(output).toContain(`](${href})`);
  }
  expect(output).not.toContain("<IntelligenceFeatureCards");
});

test("renders selected channel guide axes and scopes prose links", () => {
  const doc = loadDoc("channels/tools");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText({
    url: "teams/mastra/tools",
    title: doc!.fm.title,
    description: doc!.fm.description,
    filePath: doc!.filePath,
    loadSlug: "channels/tools",
    frontend: "teams",
    framework: "mastra",
  });

  expect(output).toContain("](/teams/mastra/interactive)");
  expect(output).toContain("](/reference/channels/classes/Channel)");
  expect(output).toContain("Microsoft Teams Adaptive Card");
  expect(output).not.toContain("Slack Block Kit");
  expect(output).not.toContain('provider: "teams"');
  expect(output).not.toContain('provider: "slack"');
});

test("rewrites scoped prose links without changing backtick or tilde fences", () => {
  const tripleFence = [
    '```ts title="triple"',
    'const href = "/channels/tools";',
    "```",
  ].join("\n");
  const longFence = [
    '````md title="long"',
    "[leave this](/channels/tools)",
    "````",
  ].join("\n");
  const tildeFence = [
    '~~~tsx title="tilde"',
    '<a href="/channels/tools">leave this</a>',
    "~~~",
  ].join("\n");
  const body = [
    "[rewrite this](/channels/tools)",
    tripleFence,
    longFence,
    tildeFence,
    '<a href="/reference/channels/classes/Thread">leave this global</a>',
  ].join("\n");

  const output = rewriteScopedDocsLinks(body, {
    url: "slack/mastra/tools",
    title: "Tools",
    filePath: "/tmp/tools.mdx",
    loadSlug: "channels/tools",
    frontend: "slack",
    framework: "mastra",
  });

  expect(output).toContain("[rewrite this](/slack/mastra/tools)");
  expect(output).toContain(
    '<a href="/reference/channels/classes/Thread">leave this global</a>',
  );
  expect(output).toContain(tripleFence);
  expect(output).toContain(longFence);
  expect(output).toContain(tildeFence);
});

test("swaps only frontend-specific Runtime code in LLM output", () => {
  const doc = loadDoc("backend/copilot-runtime");
  expect(doc).not.toBeNull();
  const page = {
    url: "angular/backend/copilot-runtime",
    title: doc!.fm.title,
    description: doc!.fm.description,
    filePath: doc!.filePath,
    loadSlug: "backend/copilot-runtime",
  };

  const angular = renderPageToLlmText(page, { frontend: "angular" });
  const react = renderPageToLlmText(page, { frontend: "react" });

  expect(angular).toContain("@copilotkit/angular");
  expect(angular).not.toContain("@copilotkit/react-core");
  expect(react).toContain("@copilotkit/react-core");
  expect(react).not.toContain("@copilotkit/angular");
  expect(angular).not.toContain("<FrontendOnly");
});

test("keeps Angular Markdown links inside the Angular surface", () => {
  const overview = loadDoc("concepts/generative-ui-overview");
  expect(overview).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "angular/concepts/generative-ui-overview",
      title: overview!.fm.title,
      description: overview!.fm.description,
      filePath: overview!.filePath,
      loadSlug: "concepts/generative-ui-overview",
    },
    { frontend: "angular" },
  );

  expect(output).toContain("](/angular/guides/frontend-tools-generative-ui)");
  expect(output).toContain(
    'href="/angular/guides/frontend-tools-generative-ui"',
  );
  expect(output).not.toContain("](/generative-ui/");
  expect(output).not.toContain('href="/generative-ui/');
});

test("keeps cross-backend and root-only Markdown links resolvable", () => {
  const quickstart = loadDoc("frontends/angular");
  expect(quickstart).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "angular/langgraph-python/quickstart",
      title: quickstart!.fm.title,
      description: quickstart!.fm.description,
      filePath: quickstart!.filePath,
      loadSlug: "frontends/angular",
      framework: "langgraph-python",
    },
    { frontend: "angular", framework: "langgraph-python" },
  );

  expect(output).toContain("](/angular/model-selection)");
  expect(output).toContain(
    "](/angular/langgraph-python/backend/copilot-runtime)",
  );
  expect(output).not.toContain("/angular/langgraph-python/angular/");
});

test("keeps only the Angular quickstart branch for the selected backend", () => {
  const quickstart = loadDoc("frontends/angular");
  expect(quickstart).not.toBeNull();
  const page = {
    url: "angular/quickstart",
    title: quickstart!.fm.title,
    description: quickstart!.fm.description,
    filePath: quickstart!.filePath,
    loadSlug: "frontends/angular",
  };

  const standalone = renderPageToLlmText(page, { frontend: "angular" });
  const langGraph = renderPageToLlmText(
    {
      ...page,
      url: "angular/langgraph-python/quickstart",
      framework: "langgraph-python",
    },
    { frontend: "angular", framework: "langgraph-python" },
  );

  expect(standalone).toContain("new BuiltInAgent");
  expect(standalone).not.toContain("<FrameworkSetup");
  expect(langGraph).toContain("CopilotKitMiddleware");
  expect(langGraph).not.toContain("<FrameworkSetup");
  expect(langGraph).not.toContain("new BuiltInAgent");
  expect(`${standalone}\n${langGraph}`).not.toContain("<WhenAngularBackend");
});

test("expands canonical Angular Showcase regions in LLM output", () => {
  const doc = loadDoc("frontends/angular/guides/frontend-tools-generative-ui");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText({
    url: "angular/guides/frontend-tools-generative-ui",
    title: doc!.fm.title,
    description: doc!.fm.description,
    filePath: doc!.filePath,
    loadSlug: "frontends/angular/guides/frontend-tools-generative-ui",
  });

  expect(output).toContain("features/tools/tool-feature-model.ts");
  expect(output).toContain('name: "change_background"');
  expect(output).not.toContain("<AngularSnippet");
});

// Synthetic branch bodies exercise the real renderer without pinning guide prose.
test.each([
  ["langgraph-python", "schema-loading"],
  ["mastra", "llm-driven"],
])(
  "renders only the selected framework branch for %s",
  (framework, selected) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-branches-"));
    const filePath = path.join(dir, "branches.mdx");
    const patterns = ["schema-loading", "schema-inline", "llm-driven"];
    try {
      fs.writeFileSync(
        filePath,
        patterns
          .map(
            (pattern) =>
              '<WhenFrameworkHas flag="a2ui_pattern" equals="' +
              pattern +
              '">\n' +
              "fixture-" +
              pattern +
              "\n</WhenFrameworkHas>",
          )
          .join("\n"),
      );
      const output = renderPageToLlmText({
        url: framework + "/branches",
        title: "Branches",
        filePath,
        loadSlug: "__reference__/branches",
        framework,
      });
      expect(output).not.toContain("WhenFrameworkHas");
      for (const pattern of patterns) {
        expect(output.includes("fixture-" + pattern)).toBe(
          pattern === selected,
        );
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test.each([
  {
    framework: "langgraph-python",
    slug: "generative-ui/interactive",
    notice: "Not supported on LangGraph (Python)",
  },
  {
    framework: "strands",
    slug: "shared-state/streaming",
    notice: "Not supported on AWS Strands (Python)",
  },
  {
    framework: "built-in-agent",
    slug: "human-in-the-loop/headless",
    notice: "Not supported on CopilotKit's Built-in Agent",
  },
])(
  "matches the HTML unsupported state in raw Markdown for $framework/$slug",
  ({ framework, slug, notice }) => {
    const doc = loadDoc(slug);
    expect(doc).not.toBeNull();

    const output = renderPageToLlmText({
      url: `${framework}/${slug}`,
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug: slug,
      framework,
    });

    expect(output).toContain(notice);
    expect(output).not.toContain(`<!-- interactive demo:`);
  },
);

test("does not fall back to another demo for a no-demo unsupported framework cell", () => {
  const doc = loadDoc("human-in-the-loop/headless");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText({
    url: "google-adk/human-in-the-loop/headless",
    title: doc!.fm.title,
    description: doc!.fm.description,
    filePath: doc!.filePath,
    loadSlug: "human-in-the-loop/headless",
    framework: "google-adk",
  });

  expect(output).toContain("Not supported on Google ADK");
  expect(output).not.toContain("<!-- interactive demo: interrupt-headless -->");
});

test("keeps the live demo marker for a supported wired framework cell", () => {
  const doc = loadDoc("human-in-the-loop");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText({
    url: "google-adk/human-in-the-loop",
    title: doc!.fm.title,
    description: doc!.fm.description,
    filePath: doc!.filePath,
    loadSlug: "human-in-the-loop",
    framework: "google-adk",
  });

  expect(output).toContain("<!-- interactive demo: hitl-in-chat -->");
  expect(output).not.toContain("Not supported on Google ADK");
});

// A requested framework is authoritative in raw Markdown, exactly as in the
// HTML <Snippet>: a missing cell yields a marker, never another framework's
// code. These fixtures run a synthetic MDX file through the real renderer
// (`__reference__/` pages are read from `filePath`).
const donor = (() => {
  const demos = (
    demoContent as {
      demos: Record<string, { regions?: Record<string, { code: string }> }>;
    }
  ).demos;
  const [region, entry] =
    Object.entries(demos["langgraph-python::agentic-chat"]?.regions ?? {}).find(
      ([, candidate]) => candidate.code.trim().length >= 40,
    ) ?? [];
  if (!region || !entry) {
    throw new Error("langgraph-python::agentic-chat has no bundled region");
  }
  return { cell: "agentic-chat", region, code: entry.code };
})();

function renderSyntheticGuide(body: string, framework?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-text-"));
  const filePath = path.join(dir, "guide.mdx");
  fs.writeFileSync(
    filePath,
    `---\ntitle: Synthetic guide\nsnippet_cell: ${donor.cell}\n---\n\n${body}\n`,
  );
  try {
    return renderPageToLlmText(
      {
        url: framework ? `${framework}/synthetic-guide` : "synthetic-guide",
        title: "Synthetic guide",
        filePath,
        loadSlug: "__reference__/synthetic-guide",
        framework,
      },
      { framework },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("marks a requested framework's missing snippet instead of substituting another framework", () => {
  const output = renderSyntheticGuide(
    `<Snippet region="${donor.region}" />`,
    "synthetic-framework",
  );

  expect(output).toContain(
    `<!-- snippet skipped: no demo for synthetic-framework::${donor.cell} -->`,
  );
  expect(output).not.toContain(donor.code);
});

test("marks a requested framework's missing InlineDemo instead of implying a runnable demo", () => {
  const output = renderSyntheticGuide(
    `<InlineDemo demo="${donor.cell}" />`,
    "synthetic-framework",
  );

  expect(output).toContain(
    `<!-- interactive demo skipped: no demo for synthetic-framework::${donor.cell} -->`,
  );
  expect(output).not.toContain(`<!-- interactive demo: ${donor.cell} -->`);
});

test("honors an explicit framework attribute, as the HTML Snippet does", () => {
  const output = renderSyntheticGuide(
    `<Snippet framework="langgraph-python" region="${donor.region}" />`,
    "synthetic-framework",
  );

  expect(output).toContain(donor.code);
  expect(output).not.toContain("snippet skipped");
});

test("keeps the preference fallback only for an unscoped render", () => {
  const output = renderSyntheticGuide(`<Snippet region="${donor.region}" />`);

  expect(output).toContain(donor.code);
  expect(output).not.toContain("snippet skipped");
});

test("inlines shared snippets used inside a framework setup", () => {
  const doc = loadDoc("frontend-tools");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "langgraph-python/frontend-tools",
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug: "frontend-tools",
      framework: "langgraph-python",
    },
    { framework: "langgraph-python" },
  );

  expect(output).toContain("### Install the LangGraph Python SDK");
  expect(output).toContain("uv add copilotkit");
  expect(output).not.toContain("<InstallPythonSDK");
});
