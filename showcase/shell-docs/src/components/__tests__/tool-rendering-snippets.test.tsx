import type { ReactElement } from "react";
import { expect, test } from "vitest";

import { Snippet } from "../snippet";

function visualSnippetCode(
  props: Parameters<typeof Snippet>[0],
): string {
  const element = Snippet(props) as ReactElement<{ code?: string }>;
  expect(element.props.code).toBeTypeOf("string");
  return element.props.code ?? "";
}

test("the Google ADK visual route renders the canonical frontend snippets and its own backend", () => {
  const canonicalProps = {
    framework: "langgraph-python",
    defaultFramework: "google-adk",
    cell: "tool-rendering",
    defaultCell: "tool-rendering",
  };

  const imports = visualSnippetCode({
    ...canonicalProps,
    region: "tool-rendering-imports",
  });
  const resultTypes = visualSnippetCode({
    ...canonicalProps,
    region: "tool-rendering-result-types",
  });
  const weatherRenderer = visualSnippetCode({
    ...canonicalProps,
    region: "render-weather-tool",
  });
  const flightRenderer = visualSnippetCode({
    ...canonicalProps,
    region: "render-flight-tool",
  });
  const weatherCard = visualSnippetCode({
    ...canonicalProps,
    file: "src/app/demos/tool-rendering/weather-card.tsx",
  });
  const flightCard = visualSnippetCode({
    ...canonicalProps,
    file: "src/app/demos/tool-rendering/flight-list-card.tsx",
  });
  const parser = visualSnippetCode({
    ...canonicalProps,
    file: "src/app/demos/_shared/parse-json-result.ts",
  });
  const googleBackend = visualSnippetCode({
    defaultFramework: "google-adk",
    defaultCell: "tool-rendering",
    region: "weather-tool-backend",
  });

  expect(imports).toContain(
    'import { WeatherCard } from "./weather-card";',
  );
  expect(imports).toContain(
    'import { parseJsonResult } from "../_shared/parse-json-result";',
  );
  expect(resultTypes).toContain("interface WeatherResult");
  expect(resultTypes).toContain("interface FlightSearchResult");
  expect(weatherRenderer).toContain(
    "const parsed = parseJsonResult<WeatherResult>(result);",
  );
  expect(weatherRenderer).not.toContain("FlightListCard");
  expect(flightRenderer).toContain(
    "const parsed = parseJsonResult<FlightSearchResult>(result);",
  );
  expect(flightRenderer).not.toContain("WeatherCard");
  expect(weatherCard).toContain("export function WeatherCard");
  expect(flightCard).toContain("export function FlightListCard");
  expect(parser).toContain("export function parseJsonResult");
  expect(googleBackend).toContain("from google.adk.tools import ToolContext");
  expect(googleBackend).not.toContain("from langchain.tools import tool");
});
