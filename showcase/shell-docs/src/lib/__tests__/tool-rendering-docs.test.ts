import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { inlineSnippets, loadDoc } from "../docs-render";

const shellDocsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const integrationsRoot = path.resolve(shellDocsRoot, "../integrations");

test("the visual docs path inlines one dependency-complete shared frontend example", () => {
  const doc = loadDoc("generative-ui/tool-rendering");
  expect(doc).not.toBeNull();

  const rendered = inlineSnippets(doc!.source, "generative-ui/tool-rendering");

  expect(rendered).not.toContain("<ToolRenderingPerToolExample />");
  expect(rendered).not.toContain('framework="langgraph-python"');
  expect(rendered).toContain("export function WeatherCard");
  expect(rendered).toContain("export function FlightListCard");
  expect(rendered).toContain("export function parseJsonResult");
  expect(rendered).toContain("interface WeatherResult");
  expect(rendered).toContain("interface FlightSearchResult");
  expect(
    rendered.match(/const parsed = parseJsonResult<WeatherResult>\(result\);/g),
  ).toHaveLength(1);
  expect(
    rendered.match(
      /const parsed = parseJsonResult<FlightSearchResult>\(result\);/g,
    ),
  ).toHaveLength(1);
});

test("the tool-rendering runtime frontend remains identical across integrations", () => {
  const page = (framework: string) =>
    fs.readFileSync(
      path.join(
        integrationsRoot,
        framework,
        "src/app/demos/tool-rendering/page.tsx",
      ),
      "utf8",
    );

  const googleAdk = page("google-adk");
  expect(page("langgraph-python")).toBe(googleAdk);
  expect(page("mastra")).toBe(googleAdk);
});
