import { describe, expect, it } from "vitest";
import { matchesSeoRedirectSource, seoRedirects } from "../seo-redirects";

describe("seoRedirects", () => {
  it("redirects old DeepAgents integration URLs to the framework root", () => {
    expect(seoRedirects).toContainEqual({
      id: "INT-wild×deepagents",
      source: "/integrations/deepagents/:path*",
      destination: "/deepagents/:path*",
    });
  });

  it("redirects old migration guide slugs to their new pages", () => {
    expect(seoRedirects).toEqual(
      expect.arrayContaining([
        {
          id: "MG2a",
          source: "/migration-guides/migrate-to-v2",
          destination: "/migrate/v2",
        },
        {
          id: "MG3a",
          source: "/migration-guides/migrate-to-1.10.X",
          destination: "/migrate/1.10.X",
        },
        {
          id: "MG4a",
          source: "/migration-guides/migrate-to-1.8.2",
          destination: "/migrate/1.8.2",
        },
      ]),
    );
  });

  it("redirects the last old docs URLs to their intended shell locations", () => {
    expect(seoRedirects).toEqual(
      expect.arrayContaining([
        {
          id: "R13",
          source: "/copilot-suggestions",
          destination: "/reference/v2/hooks/useSuggestions",
        },
        {
          id: "R15",
          source: "/integrations/built-in-agent",
          destination: "/",
        },
        {
          id: "R16A",
          source: "/integrations",
          destination: "/",
        },
        {
          id: "FE-frontends-wild",
          source: "/frontends/:path*",
          destination: "/:path*",
        },
        {
          id: "FE-teams",
          source: "/microsoft-teams",
          destination: "/teams",
        },
      ]),
    );
  });

  it("redirects retired Intelligence Platform observability URLs to overview pages", () => {
    expect(seoRedirects).toEqual(
      expect.arrayContaining([
        {
          id: "INTEL-observability-root",
          source: "/premium/observability",
          destination: "/premium/overview",
        },
        {
          id: "INTEL-observability×langgraph-python",
          source: "/langgraph-python/premium/observability",
          destination: "/langgraph-python/premium/overview",
        },
        {
          id: "INTEL-observability-connectors",
          source: "/troubleshooting/observability-connectors",
          destination: "/premium/overview",
        },
        {
          id: "INTEL-observability×built-in-agent",
          source: "/built-in-agent/premium/observability",
          destination: "/premium/overview",
        },
      ]),
    );
  });

  it("serves the Built-in Agent docs at the root: no redirect may capture a bare BIA page URL", () => {
    // These bare URLs render BIA-authored pages directly now. A
    // middleware entry whose source matches one of them would either
    // shadow the page or loop against next.config.ts's
    // /built-in-agent/:path* → /:path* rule.
    const rootBiaPages = [
      "/quickstart",
      "/server-tools",
      "/mcp-servers",
      "/model-selection",
      "/advanced-configuration",
      "/agent-app-context",
      "/telemetry",
    ];
    const captured = seoRedirects.filter((entry) =>
      rootBiaPages.includes(entry.source),
    );
    expect(captured).toEqual([]);
  });

  it("points no destination at the retired /built-in-agent prefix", () => {
    // /built-in-agent/* redirects back to /*, so middleware
    // destinations under that prefix force a redirect chain. Even
    // legacy /unselected/* sources should now land on the root BIA
    // surface directly.
    const stale = seoRedirects.filter((entry) =>
      entry.destination.startsWith("/built-in-agent"),
    );
    expect(stale).toEqual([]);
  });

  it("redirects unselected legacy paths directly to root Built-in Agent URLs", () => {
    expect(seoRedirects).toEqual(
      expect.arrayContaining([
        {
          id: "S3×unselected",
          source: "/unselected/frontend-actions",
          destination: "/frontend-tools",
        },
        {
          id: "SR-wild×unselected",
          source: "/unselected/:path*",
          destination: "/:path*",
        },
        {
          id: "P2×unselected",
          source: "/unselected",
          destination: "/",
        },
        {
          id: "T1×built-in-agent",
          source: "/built-in-agent/tutorials/:path*",
          destination: "/quickstart",
        },
      ]),
    );
  });

  it("matches exact and wildcard redirect source paths", () => {
    expect(matchesSeoRedirectSource("/a2a-protocol")).toBe(true);
    expect(matchesSeoRedirectSource("/connect-mcp-servers#learn")).toBe(true);
    expect(matchesSeoRedirectSource("/langgraph/quickstart")).toBe(true);
    expect(
      matchesSeoRedirectSource(
        "/integrations/langgraph/quickstart?copilot-hosting=self-hosted",
      ),
    ).toBe(true);
    expect(matchesSeoRedirectSource("/guides/self-hosting/")).toBe(true);
    expect(matchesSeoRedirectSource("/premium/observability")).toBe(true);
    expect(
      matchesSeoRedirectSource("/langgraph-python/premium/observability"),
    ).toBe(true);
    expect(
      matchesSeoRedirectSource("/troubleshooting/observability-connectors"),
    ).toBe(true);
  });

  it("does not match live non-redirect docs paths with similar roots", () => {
    expect(matchesSeoRedirectSource("/generative-ui/tool-rendering")).toBe(
      false,
    );
    expect(matchesSeoRedirectSource("/vue")).toBe(false);
    expect(matchesSeoRedirectSource("/slack")).toBe(false);
    expect(matchesSeoRedirectSource("/react-native")).toBe(false);
    expect(matchesSeoRedirectSource("/custom-look-and-feel/slots")).toBe(false);
  });
});
