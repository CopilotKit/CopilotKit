import { describe, expect, it } from "vitest";
import { seoRedirects } from "../seo-redirects";

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

  it("points no live destination at the retired /built-in-agent prefix", () => {
    // /built-in-agent/* 308s back to /* (next.config.ts), so middleware
    // destinations under that prefix would force a redirect chain (or a
    // loop when the source is the bare root form). Sources under
    // /built-in-agent/* or /unselected/* are unreachable (next.config
    // intercepts them first), so generated legacy entries are exempt.
    const live = seoRedirects.filter(
      (entry) =>
        !entry.source.startsWith("/built-in-agent") &&
        !entry.source.startsWith("/unselected"),
    );
    const stale = live.filter((entry) =>
      entry.destination.startsWith("/built-in-agent"),
    );
    expect(stale).toEqual([]);
  });
});
