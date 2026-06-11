import { describe, expect, it } from "vitest";
import { resolveDocsHostRedirect } from "./docs-redirects";

const DOCS_HOST = "https://docs.showcase.copilotkit.ai";
const SLUGS = new Set(["mastra", "agno", "langgraph-python"]);

describe("resolveDocsHostRedirect", () => {
  it("redirects /docs to the docs host root (prefix stripped)", () => {
    expect(resolveDocsHostRedirect("/docs", DOCS_HOST, SLUGS)).toBe(DOCS_HOST);
    expect(resolveDocsHostRedirect("/docs/quickstart", DOCS_HOST, SLUGS)).toBe(
      `${DOCS_HOST}/quickstart`,
    );
    expect(resolveDocsHostRedirect("/docs/guides/a/b", DOCS_HOST, SLUGS)).toBe(
      `${DOCS_HOST}/guides/a/b`,
    );
  });

  it("redirects /ag-ui and /reference keeping their prefix", () => {
    expect(resolveDocsHostRedirect("/ag-ui", DOCS_HOST, SLUGS)).toBe(
      `${DOCS_HOST}/ag-ui`,
    );
    expect(resolveDocsHostRedirect("/ag-ui/events", DOCS_HOST, SLUGS)).toBe(
      `${DOCS_HOST}/ag-ui/events`,
    );
    expect(resolveDocsHostRedirect("/reference", DOCS_HOST, SLUGS)).toBe(
      `${DOCS_HOST}/reference`,
    );
    expect(
      resolveDocsHostRedirect(
        "/reference/hooks/useCopilotKit",
        DOCS_HOST,
        SLUGS,
      ),
    ).toBe(`${DOCS_HOST}/reference/hooks/useCopilotKit`);
  });

  it("redirects framework-slug paths to the docs host, path preserved", () => {
    expect(resolveDocsHostRedirect("/mastra", DOCS_HOST, SLUGS)).toBe(
      `${DOCS_HOST}/mastra`,
    );
    expect(
      resolveDocsHostRedirect(
        "/langgraph-python/agentic-chat",
        DOCS_HOST,
        SLUGS,
      ),
    ).toBe(`${DOCS_HOST}/langgraph-python/agentic-chat`);
  });

  it("uses the provided (runtime) docs host — staging host wires through", () => {
    const staging = "https://docs-staging.example.com";
    expect(resolveDocsHostRedirect("/docs/quickstart", staging, SLUGS)).toBe(
      `${staging}/quickstart`,
    );
    expect(resolveDocsHostRedirect("/mastra", staging, SLUGS)).toBe(
      `${staging}/mastra`,
    );
  });

  it("does NOT redirect shell-owned routes", () => {
    expect(resolveDocsHostRedirect("/", DOCS_HOST, SLUGS)).toBeNull();
    expect(
      resolveDocsHostRedirect("/integrations", DOCS_HOST, SLUGS),
    ).toBeNull();
    expect(
      resolveDocsHostRedirect("/integrations/mastra", DOCS_HOST, SLUGS),
    ).toBeNull();
    expect(resolveDocsHostRedirect("/matrix", DOCS_HOST, SLUGS)).toBeNull();
    // Prefix lookalikes must not match (/docsify is not /docs/...).
    expect(resolveDocsHostRedirect("/docsify", DOCS_HOST, SLUGS)).toBeNull();
    expect(
      resolveDocsHostRedirect("/ag-ui-extra", DOCS_HOST, SLUGS),
    ).toBeNull();
    expect(resolveDocsHostRedirect("/references", DOCS_HOST, SLUGS)).toBeNull();
  });
});
