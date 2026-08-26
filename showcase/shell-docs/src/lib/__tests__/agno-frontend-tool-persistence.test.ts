import { expect, test } from "vitest";

import { inlineSnippets, loadDoc } from "../docs-render";
import { getAllLlmPages, renderPageToLlmText } from "../llm-text";

const agnoRoutes = [
  "frontend-tools",
  "human-in-the-loop",
  "generative-ui/your-components/display-only",
  "generative-ui/your-components/interactive",
];

function renderRoute(framework: string, route: string) {
  const page = getAllLlmPages().find(
    (candidate) => candidate.url === `${framework}/${route}`,
  );
  expect(page).toBeDefined();

  const doc = loadDoc(page!.loadSlug);
  expect(doc).not.toBeNull();

  return {
    visual: inlineSnippets(doc!.source, page!.loadSlug),
    llm: renderPageToLlmText(
      {
        ...page!,
        title: doc!.fm.title,
        description: doc!.fm.description,
        filePath: doc!.filePath,
      },
      { framework },
    ),
  };
}

test.each(agnoRoutes)("documents Agno session persistence on %s", (route) => {
  const output = renderRoute("agno", route);

  for (const content of [output.visual, output.llm]) {
    expect(content).toContain("Agno must store the paused run");
    expect(content).toContain("pip install sqlalchemy");
    expect(content).toContain("from agno.agent import Agent");
    expect(content).toContain("from agno.db.sqlite import SqliteDb");
    expect(content).toContain('SqliteDb(db_file="tmp/agno.db")');
    expect(content).toContain("db=db");
    expect(content).toContain("PgDb");
  }
});

test("keeps the Agno database requirement out of other frameworks", () => {
  const output = renderRoute(
    "langgraph-python",
    "generative-ui/your-components/display-only",
  );

  for (const content of [output.visual, output.llm]) {
    expect(content).not.toContain("Agno must store the paused run");
    expect(content).not.toContain("SqliteDb");
  }
});
