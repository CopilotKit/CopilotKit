import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SearchResults } from "./SearchResults";

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
