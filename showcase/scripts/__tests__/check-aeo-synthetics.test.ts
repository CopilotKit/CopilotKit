import { describe, expect, it, vi } from "vitest";
import {
  formatSyntheticFailure,
  loadAeoSyntheticContract,
  runAeoSyntheticChecks,
  validateAeoSyntheticConfig,
} from "../check-aeo-synthetics";
import type { AeoSyntheticContract } from "../check-aeo-synthetics";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

function fixtureContract(): AeoSyntheticContract {
  return {
    schemaVersion: 1,
    policyUrl: "https://docs.copilotkit.ai/aeo",
    capabilitiesUrl:
      "https://docs.copilotkit.ai/.well-known/copilotkit-capabilities/v1.json",
    canonicalHosts: {
      website: "https://www.copilotkit.ai",
      docs: "https://docs.copilotkit.ai",
      docsMcp: "https://mcp.copilotkit.ai",
    },
    surfaces: [
      {
        id: "website-discovery",
        host: "website",
        contentTypes: ["text/html", "application/xml"],
      },
      {
        id: "docs-capabilities-v1",
        host: "docs",
        contentTypes: ["application/json"],
      },
      {
        id: "docs-mcp-discovery",
        host: "docsMcp",
        contentTypes: ["text/event-stream"],
      },
    ],
    syntheticMonitoring: {
      alertOwner: "#oss-alerts",
      cadence: "0 */6 * * *",
      runbook: {
        repositoryPath: ".claude/docs/aeo-synthetics.md",
        url: "https://github.com/CopilotKit/CopilotKit/blob/main/.claude/docs/aeo-synthetics.md",
      },
      userAgents: [
        {
          id: "oai-searchbot",
          value: "OAI-SearchBot/1.0",
          sourceUrl: "https://example.com/oai",
        },
        {
          id: "claude-searchbot",
          value: "Claude-SearchBot/1.0",
          sourceUrl: "https://example.com/claude",
        },
        {
          id: "perplexitybot",
          value: "PerplexityBot/1.0",
          sourceUrl: "https://example.com/perplexity",
        },
        {
          id: "googlebot",
          value: "Googlebot/2.1",
          sourceUrl: "https://example.com/google",
        },
      ],
      targets: [
        {
          surfaceId: "website-discovery",
          path: "/",
          contentType: "text/html",
          assertions: [
            "non-empty",
            "no-soft-404",
            "canonical-host",
            "open-graph-host",
            "structured-data",
          ],
        },
        {
          surfaceId: "website-discovery",
          path: "/sitemap.xml",
          contentType: "application/xml",
          assertions: ["non-empty", "sitemap-host", "sample-links"],
        },
        {
          surfaceId: "docs-capabilities-v1",
          path: "/.well-known/copilotkit-capabilities/v1.json",
          contentType: "application/json",
          assertions: ["non-empty", "required-contract-fields"],
        },
        {
          surfaceId: "docs-mcp-discovery",
          path: "/sse",
          contentType: "text/event-stream",
          assertions: ["non-empty"],
        },
      ],
    },
  };
}

describe("AEO production synthetics", () => {
  it("loads a committed baseline covering major crawler user agents", () => {
    const contract = loadAeoSyntheticContract(repositoryRoot);

    expect(validateAeoSyntheticConfig(contract)).toEqual([]);
    expect(contract.syntheticMonitoring.userAgents.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "oai-searchbot",
        "claude-searchbot",
        "perplexitybot",
        "googlebot",
      ]),
    );
  });

  it("passes canonical HTML, sitemap, capability, and streaming surfaces", async () => {
    const contract = fixtureContract();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/") {
        return new Response(
          '<html><head><link rel="canonical" href="https://www.copilotkit.ai/"><meta property="og:url" content="https://www.copilotkit.ai/"><script type="application/ld+json">{"@context":"https://schema.org"}</script></head><body>Home</body></html>',
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (url.pathname === "/sitemap.xml") {
        return new Response(
          "<urlset><url><loc>https://www.copilotkit.ai/</loc></url></urlset>",
          { headers: { "content-type": "application/xml" } },
        );
      }
      if (url.pathname.endsWith("v1.json")) {
        return Response.json({
          schemaVersion: 1,
          policyUrl: contract.policyUrl,
          capabilitiesUrl: contract.capabilitiesUrl,
          canonicalHosts: contract.canonicalHosts,
          classifications: [],
          owners: [{}],
          surfaces: [{}],
          compatibility: {},
          responseSemantics: {},
          reviewChecklist: [],
          syntheticMonitoring: contract.syntheticMonitoring,
        });
      }
      return new Response("event: endpoint\ndata: /messages\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    });

    const failures = await runAeoSyntheticChecks(contract, fetchImpl, {
      timeoutMs: 1_000,
    });

    expect(failures).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(20);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: { "User-Agent": "OAI-SearchBot/1.0" },
      }),
    );
  });

  it("reports status, content type, and soft-404 evidence with the URL", async () => {
    const contract = fixtureContract();
    contract.syntheticMonitoring.targets = [
      {
        surfaceId: "docs-capabilities-v1",
        path: "/.well-known/copilotkit-capabilities/v1.json",
        contentType: "application/json",
        assertions: ["non-empty", "no-soft-404"],
      },
    ];
    const fetchImpl = vi.fn(async () =>
      Response.json("Page not found", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const failures = await runAeoSyntheticChecks(contract, fetchImpl, {
      validateConfig: false,
    });

    expect(failures).toHaveLength(4);
    expect(formatSyntheticFailure(failures[0]!)).toContain(
      "https://docs.copilotkit.ai/.well-known/copilotkit-capabilities/v1.json",
    );
    expect(formatSyntheticFailure(failures[0]!)).toContain(
      "observed HTTP 200 text/html",
    );
    expect(formatSyntheticFailure(failures[0]!)).toContain("Page not found");
  });

  it("rejects a capability document missing required contract fields", async () => {
    const contract = fixtureContract();
    contract.syntheticMonitoring.targets =
      contract.syntheticMonitoring.targets.filter(
        ({ surfaceId }) => surfaceId === "docs-capabilities-v1",
      );

    const failures = await runAeoSyntheticChecks(
      contract,
      async () => Response.json({ schemaVersion: 1 }),
      { validateConfig: false },
    );

    expect(failures[0]?.reason).toContain(
      "required contract field canonicalHosts is missing",
    );
  });

  it("rejects malformed JSON-LD", async () => {
    const contract = fixtureContract();
    contract.syntheticMonitoring.targets = [
      {
        surfaceId: "website-discovery",
        path: "/",
        contentType: "text/html",
        assertions: ["non-empty", "structured-data"],
      },
    ];

    const failures = await runAeoSyntheticChecks(
      contract,
      async () =>
        new Response(
          '<script type="application/ld+json">{"@context":</script>',
          { headers: { "content-type": "text/html" } },
        ),
      { validateConfig: false },
    );

    expect(failures[0]?.reason).toContain(
      "no JSON-LD block parses successfully with a schema.org @context",
    );
  });

  it("rejects JSON-LD with a non-schema.org context", async () => {
    const contract = fixtureContract();
    contract.syntheticMonitoring.targets = [
      {
        surfaceId: "website-discovery",
        path: "/",
        contentType: "text/html",
        assertions: ["non-empty", "structured-data"],
      },
    ];

    const failures = await runAeoSyntheticChecks(
      contract,
      async () =>
        new Response(
          '<script type="application/ld+json">{"@context":"https://example.com"}</script>',
          { headers: { "content-type": "text/html" } },
        ),
      { validateConfig: false },
    );

    expect(failures[0]?.reason).toContain(
      "no JSON-LD block parses successfully with a schema.org @context",
    );
  });

  it("rejects leaked non-canonical CopilotKit hosts in machine indexes", async () => {
    const contract = fixtureContract();
    contract.syntheticMonitoring.targets = [
      {
        surfaceId: "docs-capabilities-v1",
        path: "/llms.txt",
        contentType: "text/plain",
        assertions: ["non-empty", "links-host"],
      },
    ];

    const failures = await runAeoSyntheticChecks(
      contract,
      async () =>
        new Response(
          "[Preview](https://docs-preview.up.railway.app/quickstart)",
          { headers: { "content-type": "text/plain" } },
        ),
      { validateConfig: false },
    );

    expect(failures[0]?.reason).toContain(
      "machine-content URL uses non-canonical production origin https://docs-preview.up.railway.app",
    );
  });

  it("rejects baseline targets that drift from their contract surface", () => {
    const contract = fixtureContract();
    contract.syntheticMonitoring.targets[0]!.surfaceId = "not-declared";
    contract.syntheticMonitoring.targets[1]!.contentType = "text/plain";

    expect(validateAeoSyntheticConfig(contract)).toEqual(
      expect.arrayContaining([
        "synthetic target references unknown surface: not-declared",
        "synthetic target website-discovery content type text/plain is not declared by its contract surface",
      ]),
    );
  });

  it("rejects a crawler baseline without an official source URL", () => {
    const contract = fixtureContract();
    contract.syntheticMonitoring.userAgents[0]!.sourceUrl = "";

    expect(validateAeoSyntheticConfig(contract)).toContain(
      "syntheticMonitoring.userAgents[0] is invalid",
    );
  });
});
