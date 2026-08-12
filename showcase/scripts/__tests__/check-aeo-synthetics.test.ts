import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatSyntheticFailure,
  loadAeoSyntheticContract,
  runAeoSyntheticChecks,
  validateAeoSyntheticConfig,
} from "../check-aeo-synthetics";
import type { AeoSyntheticContract } from "../check-aeo-synthetics";

const repositoryRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);

function fixtureContract(): AeoSyntheticContract {
  return {
    canonicalHosts: {
      website: "https://www.copilotkit.ai",
      docs: "https://docs.copilotkit.ai",
      docsMcp: "https://mcp.copilotkit.ai",
    },
    surfaces: [
      {
        id: "website-discovery",
        host: "website",
        classification: "standard",
        endpoints: [
          { path: "/", contentTypes: ["text/html"] },
          { path: "/robots.txt", contentTypes: ["text/plain"] },
          { path: "/sitemap.xml", contentTypes: ["application/xml"] },
        ],
      },
      {
        id: "website-llms-indexes",
        host: "website",
        classification: "community-convention",
        endpoints: [
          { path: "/llms.txt", contentTypes: ["text/plain"] },
          { path: "/llms-full.txt", contentTypes: ["text/plain"] },
        ],
      },
      {
        id: "docs-page-metadata",
        host: "docs",
        classification: "standard",
        endpoints: [{ path: "/**", contentTypes: ["text/html"] }],
      },
      {
        id: "docs-discovery",
        host: "docs",
        classification: "standard",
        endpoints: [
          { path: "/robots.txt", contentTypes: ["text/plain"] },
          { path: "/sitemap.xml", contentTypes: ["application/xml"] },
        ],
      },
      {
        id: "docs-llms-indexes",
        host: "docs",
        classification: "community-convention",
        endpoints: [
          { path: "/llms.txt", contentTypes: ["text/plain"] },
          { path: "/llms-full.txt", contentTypes: ["text/plain"] },
        ],
      },
      {
        id: "docs-capabilities-v1",
        host: "docs",
        classification: "copilotkit-contract",
        endpoints: [
          {
            path: "/.well-known/copilotkit-capabilities/v1.json",
            contentTypes: ["application/json"],
          },
        ],
      },
      {
        id: "docs-mcp-transport",
        host: "docsMcp",
        classification: "copilotkit-contract",
        endpoints: [{ path: "/sse", contentTypes: ["text/event-stream"] }],
      },
    ],
  };
}

function successfulResponse(rawUrl: string): Response {
  const url = new URL(rawUrl);
  const origin = url.origin;
  if (url.pathname === "/") {
    return new Response(
      `<html><head><link rel="canonical" href="${origin}/"></head><body>Home. This guide explains what happens when a page doesn't exist.</body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  if (url.pathname === "/robots.txt") {
    return new Response(`User-agent: *\nSitemap: ${origin}/sitemap.xml\n`, {
      headers: { "content-type": "text/plain" },
    });
  }
  if (url.pathname === "/sitemap.xml") {
    return new Response(`<urlset><url><loc>${origin}/</loc></url></urlset>`, {
      headers: { "content-type": "application/xml" },
    });
  }
  if (url.pathname === "/llms-full.txt") {
    return new Response(
      `## Source: ${origin}/\n\nSee [CopilotKit](https://copilotkit.ai/).`,
      { headers: { "content-type": "text/plain" } },
    );
  }
  return new Response(`[Home](${origin}/)`, {
    headers: { "content-type": "text/plain" },
  });
}

describe("AEO production synthetics", () => {
  it("derives only the website and docs baseline from the public contract", () => {
    const contract = loadAeoSyntheticContract(repositoryRoot);

    expect(validateAeoSyntheticConfig(contract)).toEqual([]);
    expect(contract).not.toHaveProperty("syntheticMonitoring");
  });

  it("checks the ten website/docs surfaces for four crawlers with bounded concurrency", async () => {
    const contract = fixtureContract();
    let active = 0;
    let maximumActive = 0;
    let requestCount = 0;

    const failures = await runAeoSyntheticChecks(
      contract,
      async (input) => {
        requestCount += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));
        active -= 1;
        return successfulResponse(String(input));
      },
      { timeoutMs: 1_000, maxConcurrency: 4 },
    );

    expect(failures).toEqual([]);
    expect(requestCount).toBe(48);
    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(4);
  });

  it("reports status, content type, and soft-404 evidence with the URL", async () => {
    const contract = fixtureContract();
    contract.surfaces = [contract.surfaces[0]!];

    const failures = await runAeoSyntheticChecks(
      contract,
      async () =>
        new Response(
          '<html><head><meta name="robots" content="noindex"></head><body>Page not found</body></html>',
          { status: 404, headers: { "content-type": "text/html" } },
        ),
      { validateConfig: false },
    );

    expect(failures).toHaveLength(12);
    expect(formatSyntheticFailure(failures[0]!)).toContain(
      "https://www.copilotkit.ai/",
    );
    expect(formatSyntheticFailure(failures[0]!)).toContain("soft-404 signal");
    expect(formatSyntheticFailure(failures[0]!)).toContain(
      "expected HTTP 200, received HTTP 404",
    );
    expect(formatSyntheticFailure(failures[1]!)).toContain(
      "expected Content-Type text/plain",
    );
  });

  it("rejects a canonical URL on the wrong host", async () => {
    const contract = fixtureContract();
    contract.surfaces = [
      {
        id: "website-home",
        host: "website",
        classification: "standard",
        endpoints: [{ path: "/", contentTypes: ["text/html"] }],
      },
    ];

    const failures = await runAeoSyntheticChecks(
      contract,
      async () =>
        new Response(
          '<link rel="canonical" href="https://preview.example.com/">Home',
          { headers: { "content-type": "text/html" } },
        ),
      { validateConfig: false },
    );

    expect(failures[0]?.reason).toContain(
      "canonical URL uses https://preview.example.com",
    );
  });

  it("fails configuration when the public contract loses an in-scope endpoint", () => {
    const contract = fixtureContract();
    contract.surfaces[0]!.endpoints = contract.surfaces[0]!.endpoints.filter(
      ({ path }) => path !== "/robots.txt",
    );

    expect(validateAeoSyntheticConfig(contract)).toContain(
      "website baseline is missing /robots.txt",
    );
  });
});
