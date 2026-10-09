import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";
import {
  getAllLlmPages,
  renderPageToLlmText,
  rewriteScopedDocsLinks,
} from "../llm-text";

test("Hashbrown guide exports each bundled framework's complete source", () => {
  const doc = loadDoc("generative-ui/hashbrown");
  expect(doc).not.toBeNull();
  const bundle = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "src/data/demo-content.json"),
      "utf8",
    ),
  ) as {
    demos: Record<
      string,
      {
        files: Array<{
          filename: string;
          content: string;
          highlighted?: boolean;
        }>;
      }
    >;
  };
  const entries = Object.entries(bundle.demos).filter(([key]) =>
    key.endsWith("::declarative-hashbrown"),
  );
  expect(entries.length).toBeGreaterThanOrEqual(15);

  for (const [key, demo] of entries) {
    const framework = key.split("::")[0];
    const output = renderPageToLlmText({
      url: `${framework}/generative-ui/hashbrown`,
      title: doc!.fm.title,
      filePath: doc!.filePath,
      loadSlug: "generative-ui/hashbrown",
      framework,
    });
    const demoFiles = demo.files.filter((file) =>
      file.filename.startsWith("src/app/demos/declarative-hashbrown/"),
    );
    expect(
      demoFiles.every((file) => file.highlighted),
      key,
    ).toBe(true);
    for (const name of ["page.tsx", "chat.tsx", "hashbrown-renderer.tsx"]) {
      const source = demoFiles.find((file) =>
        file.filename.endsWith(`/${name}`),
      );
      expect(source, `${key}: ${name}`).toBeDefined();
      expect(output, `${key}: ${name}`).toContain(source!.content.trimEnd());
    }
    expect(output, key).not.toContain("<!-- snippet skipped:");
    expect(output, key).not.toContain("useUiKit({ catalog, value:");
  }

  const output = renderPageToLlmText({
    url: "generative-ui/hashbrown",
    title: doc!.fm.title,
    filePath: doc!.filePath,
    loadSlug: "generative-ui/hashbrown",
  });
  expect(output).toContain("useJsonParser(content, kit.schema)");
  expect(output).not.toContain("<!-- snippet skipped:");
  const example = output.match(
    /```json title="example assistant message"\n([\s\S]*?)\n```/,
  );
  expect(example).not.toBeNull();
  const message = JSON.parse(example![1]) as {
    ui: Array<Record<string, { props: Record<string, unknown> }>>;
  };
  expect(message.ui.map((component) => Object.keys(component)[0])).toEqual([
    "metric",
    "pieChart",
  ]);
  const chartData = message.ui[1].pieChart.props.data;
  expect(typeof chartData).toBe("string");
  if (typeof chartData !== "string")
    throw new Error("chart data is not a string");
  expect(JSON.parse(chartData)).toHaveLength(3);
});

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
