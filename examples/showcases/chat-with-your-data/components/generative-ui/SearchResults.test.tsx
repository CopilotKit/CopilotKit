import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SearchResults } from "./SearchResults";

test("renders an in-progress search state", () => {
  const markup = renderToStaticMarkup(
    <SearchResults
      query="CopilotKit v2 migration"
      status="inProgress"
      result={undefined}
    />,
  );

  assert.match(markup, /Processing\.\.\./);
  assert.doesNotMatch(markup, />Complete</);
  assert.doesNotMatch(markup, />Error</);
});

test("renders completed search result data", () => {
  const props = {
    query: "CopilotKit v2 migration",
    status: "complete",
    result: JSON.stringify({
      answer: "Use the CopilotKit v2 migration guide.",
      results: [
        {
          title: "Migrate to CopilotKit v2",
          url: "https://docs.copilotkit.ai/migrate/v2",
          content: "Update hooks and runtime imports.",
        },
      ],
    }),
  } as const;

  const markup = renderToStaticMarkup(<SearchResults {...props} />);

  assert.match(markup, /Use the CopilotKit v2 migration guide\./);
  assert.match(markup, /Migrate to CopilotKit v2/);
  assert.match(markup, /Update hooks and runtime imports\./);
  assert.match(markup, />Complete</);
  assert.doesNotMatch(markup, />Error</);
});

test("renders a failed v2 tool result as an error", () => {
  const markup = renderToStaticMarkup(
    <SearchResults
      query="CopilotKit v2 migration"
      status="complete"
      result="Error: Tavily request failed"
    />,
  );

  assert.match(markup, />Error</);
  assert.match(markup, /Tavily request failed/);
  assert.doesNotMatch(markup, />Complete</);
});

test("renders a plain-text result when the response is not JSON", () => {
  const props = {
    query: "CopilotKit v2 migration",
    status: "complete",
    result: "Use the CopilotKit v2 migration guide.",
  } as const;

  const markup = renderToStaticMarkup(<SearchResults {...props} />);

  assert.match(markup, /Use the CopilotKit v2 migration guide\./);
});
