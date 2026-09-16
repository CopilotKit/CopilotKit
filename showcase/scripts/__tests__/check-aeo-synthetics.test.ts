import { describe, expect, it } from "vitest";
import {
  AEO_SYNTHETIC_CONFIG,
  formatSyntheticFailure,
  runAeoSyntheticChecks,
  validateAeoSyntheticConfig,
} from "../check-aeo-synthetics";
import type { AeoSyntheticConfig } from "../check-aeo-synthetics";

function fixtureConfig(): AeoSyntheticConfig {
  return {
    canonicalHosts: { ...AEO_SYNTHETIC_CONFIG.canonicalHosts },
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
  it("defines a valid website and docs baseline", () => {
    expect(validateAeoSyntheticConfig(AEO_SYNTHETIC_CONFIG)).toEqual([]);
  });

  it("checks the ten website/docs surfaces for four crawlers with bounded concurrency", async () => {
    const config = fixtureConfig();
    let active = 0;
    let maximumActive = 0;
    let requestCount = 0;

    const failures = await runAeoSyntheticChecks(
      config,
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
    const config = fixtureConfig();

    const failures = await runAeoSyntheticChecks(
      config,
      async () =>
        new Response(
          '<html><head><meta name="robots" content="noindex"></head><body>Page not found</body></html>',
          { status: 404, headers: { "content-type": "text/html" } },
        ),
      { validateConfig: false },
    );

    expect(failures).toHaveLength(40);
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
    const config = fixtureConfig();

    const failures = await runAeoSyntheticChecks(
      config,
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

  it("fails configuration when a canonical host is invalid", () => {
    const config = fixtureConfig();
    config.canonicalHosts.website = "http://www.copilotkit.ai/path";

    expect(validateAeoSyntheticConfig(config)).toContain(
      "website canonical host must be an HTTPS origin",
    );
  });
});
