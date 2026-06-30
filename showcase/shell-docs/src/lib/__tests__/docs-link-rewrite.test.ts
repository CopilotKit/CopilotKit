import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDocsHref } from "../docs-link-rewrite";
import { matchesSeoRedirectSource } from "../seo-redirects";

function listMdxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) return listMdxFiles(fullPath);
    if (stat.isFile() && fullPath.endsWith(".mdx")) return [fullPath];
    return [];
  });
}

describe("resolveDocsHref", () => {
  it("scopes root-relative links under the active framework", () => {
    expect(
      resolveDocsHref("/quickstart#install", {
        slugHrefPrefix: "/mastra",
        frameworkOverride: "mastra",
      }),
    ).toBe("/mastra/quickstart#install");
  });

  it("scopes links under frontend and framework when both axes are selected", () => {
    const options = {
      slugHrefPrefix: "/vue/langgraph-python",
      frameworkOverride: "langgraph-python",
    };

    expect(resolveDocsHref("/generative-ui/tool-rendering", options)).toBe(
      "/vue/langgraph-python/generative-ui/tool-rendering",
    );
    expect(resolveDocsHref("/langgraph-python/quickstart", options)).toBe(
      "/vue/langgraph-python/quickstart",
    );
  });

  it("does not scope cross-framework or reserved-route links", () => {
    const options = {
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
    };

    expect(resolveDocsHref("/langgraph-python/quickstart", options)).toBe(
      "/langgraph-python/quickstart",
    );
    expect(resolveDocsHref("/reference/v2", options)).toBe("/reference/v2");
  });

  it("does not scope SEO redirect source aliases", () => {
    const options = {
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
    };

    expect(resolveDocsHref("/integrations/langgraph/quickstart", options)).toBe(
      "/integrations/langgraph/quickstart",
    );
    expect(
      resolveDocsHref("/docs/integrations/langgraph/quickstart", options),
    ).toBe("/docs/integrations/langgraph/quickstart");
    expect(resolveDocsHref("/ag-ui-protocol", options)).toBe("/ag-ui-protocol");
    expect(resolveDocsHref("/a2a-protocol", options)).toBe("/a2a-protocol");
    expect(resolveDocsHref("/connect-mcp-servers", options)).toBe(
      "/connect-mcp-servers",
    );
    expect(resolveDocsHref("/langgraph/quickstart", options)).toBe(
      "/langgraph/quickstart",
    );
    expect(resolveDocsHref("/aws-strands/frontend-tools", options)).toBe(
      "/aws-strands/frontend-tools",
    );
    expect(resolveDocsHref("/guides/self-hosting", options)).toBe(
      "/guides/self-hosting",
    );
    expect(resolveDocsHref("/tutorials/ai-todo-app", options)).toBe(
      "/tutorials/ai-todo-app",
    );
    expect(resolveDocsHref("/generative-ui/display", options)).toBe(
      "/generative-ui/display",
    );
  });

  it("still scopes non-redirect sibling paths", () => {
    const options = {
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
    };

    expect(resolveDocsHref("/generative-ui/tool-rendering", options)).toBe(
      "/mastra/generative-ui/tool-rendering",
    );
    expect(resolveDocsHref("/custom-look-and-feel/slots", options)).toBe(
      "/mastra/custom-look-and-feel/slots",
    );
  });

  it("does not scope redirect-source links found in MDX content", () => {
    const options = {
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
    };
    const contentDir = join(process.cwd(), "src/content");
    const linkPattern = /(?:\]\(|href=\{?["'])(\/[^\s)"'`}]+)/g;
    const redirectLinks: string[] = [];
    const wronglyScoped: Array<{
      file: string;
      href: string;
      resolved: string;
    }> = [];

    for (const file of listMdxFiles(contentDir)) {
      const text = readFileSync(file, "utf8");
      let match: RegExpExecArray | null;

      while ((match = linkPattern.exec(text)) !== null) {
        const href = match[1];
        if (href.startsWith("//")) continue;
        if (!matchesSeoRedirectSource(href)) continue;

        // Built-in Agent moved to the root, so these legacy prefixes are
        // intentionally collapsed before general redirect-alias handling.
        if (
          href.startsWith("/built-in-agent") ||
          href.startsWith("/integrations/built-in-agent")
        ) {
          continue;
        }

        redirectLinks.push(href);
        const resolved = resolveDocsHref(href, options);
        if (resolved !== href) {
          wronglyScoped.push({ file, href, resolved: resolved ?? "" });
        }
      }
    }

    expect(redirectLinks.length).toBeGreaterThan(0);
    expect(wronglyScoped).toEqual([]);
  });

  it("strips retired built-in-agent prefixes on the root surface", () => {
    const options = {
      slugHrefPrefix: "",
      frameworkOverride: undefined,
    };

    expect(resolveDocsHref("/built-in-agent/quickstart", options)).toBe(
      "/quickstart",
    );
    expect(
      resolveDocsHref(
        "/integrations/built-in-agent/quickstart?copilot-hosting=self-hosted#set-up-a-copilot-runtime-endpoint",
        options,
      ),
    ).toBe(
      "/quickstart?copilot-hosting=self-hosted#set-up-a-copilot-runtime-endpoint",
    );
  });

  it("strips retired built-in-agent prefixes before framework scoping", () => {
    const options = {
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
    };

    expect(resolveDocsHref("/built-in-agent/server-tools", options)).toBe(
      "/server-tools",
    );
    expect(
      resolveDocsHref("/integrations/built-in-agent/model-selection", options),
    ).toBe("/model-selection");
  });
});
