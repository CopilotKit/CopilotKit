import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";
import { CONTENT_DIR } from "../docs-render";
import { getDocsFolder, getIntegrations } from "../registry";
import { buildDocsFileIndex } from "../searchable-pages";
import { matchesSeoRedirectSource, seoRedirects } from "../seo-redirects";

const LANGGRAPH_SCOPES = [
  "langgraph-python",
  "langgraph-typescript",
  "langgraph-fastapi",
] as const;

const REGISTRY_FRAMEWORK_SLUGS = new Set(
  getIntegrations().map((integration) => integration.slug),
);

function firstSegment(pathname: string): string | undefined {
  return pathname.split("/").filter(Boolean)[0];
}

/**
 * The seo redirect middleware.ts would fire for `pathname`, using the same
 * rules: an exact source first, then wildcards in declaration order, where a
 * framework-scoped path only takes a wildcard rooted in its own framework.
 */
function resolveSeoRedirect(
  pathname: string,
): { id: string; destination: string } | null {
  const exact = new Map<string, { id: string; destination: string }>();
  for (const entry of seoRedirects) {
    if (!entry.source.includes(":path*")) exact.set(entry.source, entry);
  }
  const exactHit = exact.get(pathname);
  if (exactHit && exactHit.destination !== pathname) return exactHit;

  const scope = firstSegment(pathname);
  const requestFramework =
    scope && REGISTRY_FRAMEWORK_SLUGS.has(scope) ? scope : undefined;
  for (const entry of seoRedirects) {
    const wildcardIndex = entry.source.indexOf(":path*");
    if (wildcardIndex === -1) continue;
    const prefix = entry.source.slice(0, wildcardIndex);
    if (!pathname.startsWith(prefix)) continue;
    if (requestFramework && firstSegment(prefix) !== requestFramework) {
      continue;
    }
    const destination = entry.destination.replace(
      ":path*",
      pathname.slice(prefix.length),
    );
    if (destination === pathname) continue;
    return { id: entry.id, destination };
  }
  return null;
}

/** The next.config.ts redirect that would fire for `pathname`, if any. */
async function resolveNextConfigRedirect(
  pathname: string,
): Promise<string | null> {
  const redirects = await nextConfig.redirects!();
  const hit = redirects.find(
    (redirect) =>
      getPathMatch(redirect.source, {
        removeUnnamedParams: true,
        strict: true,
      })(pathname) !== false,
  );
  return hit?.source ?? null;
}

const docsFileIndex = buildDocsFileIndex(CONTENT_DIR);

/**
 * True when a LangGraph-scoped URL renders an MDX page. Generated frameworks
 * resolve the shared root page first and then the framework's own folder.
 */
function isLiveLangGraphPage(pathname: string): boolean {
  const [scope, ...rest] = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  if (!(LANGGRAPH_SCOPES as readonly string[]).includes(scope)) return false;
  const topic = rest.join("/");
  if (topic === "") return true; // framework landing page
  return (
    docsFileIndex.has(topic) ||
    docsFileIndex.has(`integrations/${getDocsFolder(scope)}/${topic}`)
  );
}

function isLangGraphScoped(pathname: string): boolean {
  return (LANGGRAPH_SCOPES as readonly string[]).includes(
    firstSegment(pathname) ?? "",
  );
}

describe("LangGraph redirects", () => {
  it("lands legacy shared-state, context, and multi-agent URLs on live guides in one hop", async () => {
    const cases = [
      [
        "/langgraph/shared-state/in-app-agent-write",
        "/langgraph-python/shared-state/in-app-agent-write",
      ],
      [
        "/coagents/react-ui/in-app-agent-write",
        "/langgraph-python/shared-state/in-app-agent-write",
      ],
      [
        "/integrations/langgraph/shared-state/in-app-agent-write",
        "/langgraph-python/shared-state/in-app-agent-write",
      ],
      [
        "/langgraph/shared-state/state-inputs-outputs",
        "/langgraph-python/shared-state/state-inputs-outputs",
      ],
      [
        "/coagents/shared-state/state-inputs-outputs",
        "/langgraph-python/shared-state/state-inputs-outputs",
      ],
      [
        "/langgraph/shared-state/predictive-state-updates",
        "/langgraph-python/shared-state/predictive-state-updates",
      ],
      [
        "/coagents/shared-state/intermediate-state-streaming",
        "/langgraph-python/shared-state/predictive-state-updates",
      ],
      ["/langgraph/agent-app-context", "/langgraph-python/agent-app-context"],
      ["/langgraph/multi-agent-flows", "/langgraph-python/multi-agent-flows"],
      ["/coagents/multi-agent-flows", "/langgraph-python/multi-agent-flows"],
      ["/multi-agent-flows", "/langgraph-python/multi-agent-flows"],
      ["/coagents/tutorials", "/langgraph-python/quickstart"],
      [
        "/coagents/tutorials/ai-travel-app/overview",
        "/langgraph-python/quickstart",
      ],
    ] as const;

    for (const [source, destination] of cases) {
      expect(await resolveNextConfigRedirect(source), source).toBeNull();
      expect(resolveSeoRedirect(source)?.destination, source).toBe(destination);
      expect(resolveSeoRedirect(destination), destination).toBeNull();
      expect(
        await resolveNextConfigRedirect(destination),
        destination,
      ).toBeNull();
      expect(isLiveLangGraphPage(destination), destination).toBe(true);
    }
  });

  it("never redirects a live LangGraph guide away from itself", async () => {
    const guides = [
      "shared-state/in-app-agent-read",
      "shared-state/in-app-agent-write",
      "shared-state/state-inputs-outputs",
      "shared-state/predictive-state-updates",
      "agent-app-context",
      "multi-agent-flows",
    ];

    for (const scope of LANGGRAPH_SCOPES) {
      for (const guide of guides) {
        const url = `/${scope}/${guide}`;
        expect(isLiveLangGraphPage(url), url).toBe(true);
        expect(resolveSeoRedirect(url), url).toBeNull();
        expect(await resolveNextConfigRedirect(url), url).toBeNull();
      }
    }
  });

  it("sends no exact redirect to a LangGraph URL that redirects again", async () => {
    const chains: string[] = [];
    for (const entry of seoRedirects) {
      if (entry.destination.includes(":path*")) continue;
      if (!isLangGraphScoped(entry.destination)) continue;
      const seoHop = resolveSeoRedirect(entry.destination);
      const nextHop = await resolveNextConfigRedirect(entry.destination);
      if (seoHop || nextHop) {
        chains.push(
          `${entry.id}: ${entry.source} -> ${entry.destination} -> ${
            seoHop ? `${seoHop.id} ${seoHop.destination}` : nextHop
          }`,
        );
      }
    }
    expect(chains).toEqual([]);
  });
});

describe("seoRedirects", () => {
  it("consolidates Conversational Flow URLs under CrewAI", () => {
    expect(seoRedirects).toEqual(
      expect.arrayContaining([
        {
          id: "CF-mode-root",
          source: "/crewai-conversational-flows",
          destination: "/crewai-flows/conversational-flows",
        },
        {
          id: "CF-mode-wild",
          source: "/crewai-conversational-flows/:path*",
          destination: "/crewai-flows/:path*",
        },
        {
          id: "CF-mode-parity",
          source: "/crewai-conversational-flows/feature-parity",
          destination: "/crewai-flows/conversational-flows",
        },
      ]),
    );
  });

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

  it("redirects retired Intelligence observability URLs to overview pages", () => {
    expect(seoRedirects).toEqual(
      expect.arrayContaining([
        {
          id: "INTEL-observability-root",
          source: "/premium/observability",
          destination: "/intelligence/overview",
        },
        {
          id: "INTEL-observability×langgraph-python",
          source: "/langgraph-python/premium/observability",
          destination: "/langgraph-python/intelligence/overview",
        },
        {
          id: "INTEL-observability-connectors",
          source: "/troubleshooting/observability-connectors",
          destination: "/intelligence/overview",
        },
        {
          id: "INTEL-observability×built-in-agent",
          source: "/built-in-agent/premium/observability",
          destination: "/intelligence/overview",
        },
      ]),
    );
  });

  it("redirects the moved Intelligence inspector page instead of 404ing", () => {
    // cc8c945893 renamed `(root)/premium/inspector.mdx` to
    // `(root)/inspector.mdx` and added no redirect, so `/premium/inspector`
    // 404'd from 2026-02-23 on. The page still exists, so these forward to it
    // rather than falling back to the overview.
    expect(seoRedirects).toEqual(
      expect.arrayContaining([
        {
          id: "INTEL-inspector-root",
          source: "/premium/inspector",
          destination: "/inspector",
        },
        {
          id: "INTEL-inspector×langgraph-python",
          source: "/langgraph-python/premium/inspector",
          destination: "/langgraph-python/inspector",
        },
        {
          // Built-in Agent is served at the root, so its destination carries
          // no framework prefix.
          id: "INTEL-inspector×built-in-agent",
          source: "/built-in-agent/premium/inspector",
          destination: "/inspector",
        },
      ]),
    );
  });

  it("redirects the deleted /direct-to-llm/guides/premium pages to their current equivalents", () => {
    // Deleted in cc8c945893 without redirects. The R16
    // `/direct-to-llm/:path*` wildcard drops them on the docs home, which
    // reads as a working link while serving the wrong page.
    expect(seoRedirects).toEqual(
      expect.arrayContaining([
        {
          id: "INTEL-d2l-guides-overview",
          source: "/direct-to-llm/guides/premium/overview",
          destination: "/intelligence/overview",
        },
        {
          id: "INTEL-d2l-guides-headless-ui",
          source: "/direct-to-llm/guides/premium/headless-ui",
          destination: "/intelligence/headless-ui",
        },
        {
          id: "INTEL-d2l-guides-observability",
          source: "/direct-to-llm/guides/premium/observability",
          destination: "/intelligence/overview",
        },
        {
          id: "INTEL-d2l-guides-inspector",
          source: "/direct-to-llm/guides/premium/inspector",
          destination: "/inspector",
        },
      ]),
    );
  });

  it("matches the new exact sources before the premium rename wildcard", () => {
    // The whole point of exact entries here: INTEL-rename-wild would rewrite
    // these to `/intelligence/inspector`, which does not exist.
    expect(matchesSeoRedirectSource("/premium/inspector")).toBe(true);
    expect(
      matchesSeoRedirectSource("/langgraph-python/premium/inspector"),
    ).toBe(true);
    expect(
      matchesSeoRedirectSource("/direct-to-llm/guides/premium/headless-ui"),
    ).toBe(true);
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
