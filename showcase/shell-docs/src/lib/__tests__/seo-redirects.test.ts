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
        {
          id: "MV-telemetry",
          source: "/telemetry",
          destination: "/built-in-agent/telemetry",
        },
      ]),
    );
  });
});
