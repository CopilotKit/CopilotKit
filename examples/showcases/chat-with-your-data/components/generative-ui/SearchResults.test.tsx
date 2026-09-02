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

test("links absolute HTTP and HTTPS search results", () => {
  const markup = renderToStaticMarkup(
    <SearchResults
      query="CopilotKit v2 migration"
      status="complete"
      result={JSON.stringify({
        results: [
          {
            title: "HTTP result",
            url: "http://example.com/http-result",
            content: "An HTTP search result.",
          },
          {
            title: "HTTPS result",
            url: "https://example.com/https-result",
            content: "An HTTPS search result.",
          },
        ],
      })}
    />,
  );

  assert.match(markup, /href="http:\/\/example\.com\/http-result"/);
  assert.match(markup, /href="https:\/\/example\.com\/https-result"/);
});

test("does not link unsafe or invalid search-result URLs", () => {
  const markup = renderToStaticMarkup(
    <SearchResults
      query="CopilotKit v2 migration"
      status="complete"
      result={JSON.stringify({
        results: [
          {
            title: "Unsafe result",
            url: "javascript:alert('unsafe')",
            content: "A result with an unsafe scheme.",
          },
          {
            title: "Invalid result",
            url: "not a URL",
            content: "A result with an invalid URL.",
          },
        ],
      })}
    />,
  );

  assert.match(markup, /Unsafe result/);
  assert.match(markup, /Invalid result/);
  assert.doesNotMatch(markup, /href=/);
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
