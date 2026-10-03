import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import setupContentData from "@/data/setup-content.json";
import { resolveDocsHref } from "../docs-link-rewrite";
import { matchesSeoRedirectSource } from "../seo-redirects";
import type { SetupContentBundle } from "../setup-content";

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

  it("keeps Angular links inside the active Angular surface", () => {
    expect(
      resolveDocsHref("/angular/guides/frontend-tools-generative-ui", {
        slugHrefPrefix: "/angular",
        frameworkOverride: "built-in-agent",
      }),
    ).toBe("/angular/guides/frontend-tools-generative-ui");

    expect(
      resolveDocsHref("/backend/copilot-runtime", {
        slugHrefPrefix: "/angular",
        frameworkOverride: "built-in-agent",
      }),
    ).toBe("/angular/backend/copilot-runtime");

    expect(
      resolveDocsHref("/angular/features", {
        slugHrefPrefix: "/angular/langgraph-python",
        frameworkOverride: "langgraph-python",
      }),
    ).toBe("/angular/langgraph-python/features");

    expect(
      resolveDocsHref("/model-selection", {
        slugHrefPrefix: "/angular/langgraph-python",
        frameworkOverride: "langgraph-python",
      }),
    ).toBe("/angular/model-selection");

    expect(
      resolveDocsHref("/deepagents/quickstart", {
        slugHrefPrefix: "/angular/langgraph-python",
        frameworkOverride: "langgraph-python",
      }),
    ).toBe("/angular/deepagents/quickstart");

    expect(
      resolveDocsHref("/angular/langgraph-python/features", {
        slugHrefPrefix: "/angular/langgraph-python",
        frameworkOverride: "langgraph-python",
      }),
    ).toBe("/angular/langgraph-python/features");

    expect(
      resolveDocsHref("/angular/deepagents/quickstart", {
        slugHrefPrefix: "/angular/langgraph-python",
        frameworkOverride: "langgraph-python",
      }),
    ).toBe("/angular/deepagents/quickstart");

    expect(
      resolveDocsHref("/agentic-protocols/ag-ui", {
        slugHrefPrefix: "/angular",
        frameworkOverride: "built-in-agent",
      }),
    ).toBe("/angular/agentic-protocols/ag-ui");
  });

  it("collapses React-specific topic links to Angular-native guides", () => {
    const options = {
      slugHrefPrefix: "/angular",
      frameworkOverride: "built-in-agent",
    };

    expect(resolveDocsHref("/generative-ui/tool-based", options)).toBe(
      "/angular/guides/frontend-tools-generative-ui",
    );
    expect(resolveDocsHref("/a2a-protocol", options)).toBe(
      "/angular/agentic-protocols/a2a",
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
    expect(resolveDocsHref("/channels/intelligence", options)).toBe(
      "/channels/intelligence",
    );
  });

  it("scopes shared Channels guides to the selected Slack or Teams journey", () => {
    const mastraSlack = {
      slugHrefPrefix: "/slack/mastra",
      frameworkOverride: "mastra",
      frontendOverride: "slack" as const,
    };

    expect(resolveDocsHref("/channels/interactive", mastraSlack)).toBe(
      "/slack/mastra/interactive",
    );
    expect(resolveDocsHref("/channels", mastraSlack)).toBe("/slack/mastra");
    expect(
      resolveDocsHref("/reference/channels/classes/Thread#state", {
        ...mastraSlack,
        slugHrefPrefix: "/teams/mastra",
        frontendOverride: "teams",
      }),
    ).toBe("/reference/channels/classes/Thread#state");
    expect(
      resolveDocsHref("/channels/tools?view=compact#context", mastraSlack),
    ).toBe("/slack/mastra/tools?view=compact#context");
  });

  it("preserves the active backend for same-channel connection links", () => {
    expect(
      resolveDocsHref("/slack", {
        slugHrefPrefix: "/slack/mastra",
        frameworkOverride: "mastra",
        frontendOverride: "slack",
      }),
    ).toBe("/slack/mastra");
    expect(
      resolveDocsHref("/teams#verify", {
        slugHrefPrefix: "/teams/mastra",
        frameworkOverride: "mastra",
        frontendOverride: "teams",
      }),
    ).toBe("/teams/mastra#verify");
    expect(
      resolveDocsHref("/slack/connect", {
        slugHrefPrefix: "/slack/mastra",
        frameworkOverride: "mastra",
        frontendOverride: "slack",
      }),
    ).toBe("/slack/mastra/connect");
  });

  it("keeps explicit cross-channel root links unchanged", () => {
    expect(
      resolveDocsHref("/teams", {
        slugHrefPrefix: "/slack/mastra",
        frameworkOverride: "mastra",
        frontendOverride: "slack",
      }),
    ).toBe("/teams");
    expect(
      resolveDocsHref("/slack", {
        slugHrefPrefix: "/teams/mastra",
        frameworkOverride: "mastra",
        frontendOverride: "teams",
      }),
    ).toBe("/slack");
  });

  it("collapses explicit Built-in Agent paths on the active channel", () => {
    const builtInSlack = {
      slugHrefPrefix: "/slack",
      frameworkOverride: "built-in-agent",
      frontendOverride: "slack" as const,
    };

    expect(resolveDocsHref("/slack", builtInSlack)).toBe("/slack");
    expect(resolveDocsHref("/slack/built-in-agent", builtInSlack)).toBe(
      "/slack",
    );
    expect(
      resolveDocsHref("/slack/built-in-agent/tools#context", builtInSlack),
    ).toBe("/slack/tools#context");
  });

  it("keeps ordinary Built-in Agent docs links on the root surface for channel guides", () => {
    const builtInSlack = {
      slugHrefPrefix: "/slack",
      frameworkOverride: "built-in-agent",
      frontendOverride: "slack" as const,
    };
    const builtInTeams = {
      slugHrefPrefix: "/teams",
      frameworkOverride: "built-in-agent",
      frontendOverride: "teams" as const,
    };

    expect(resolveDocsHref("/human-in-the-loop", builtInSlack)).toBe(
      "/human-in-the-loop",
    );
    expect(resolveDocsHref("/threads", builtInSlack)).toBe("/threads");
    expect(resolveDocsHref("/human-in-the-loop#approval", builtInTeams)).toBe(
      "/human-in-the-loop#approval",
    );
    expect(resolveDocsHref("/threads", builtInTeams)).toBe("/threads");

    expect(resolveDocsHref("/slack", builtInSlack)).toBe("/slack");
    expect(resolveDocsHref("/channels/interactive", builtInSlack)).toBe(
      "/slack/interactive",
    );
    expect(resolveDocsHref("/teams", builtInTeams)).toBe("/teams");
    expect(resolveDocsHref("/channels/interactive", builtInTeams)).toBe(
      "/teams/interactive",
    );
  });

  it("keeps ordinary docs links scoped for explicit channel frameworks", () => {
    expect(
      resolveDocsHref("/human-in-the-loop", {
        slugHrefPrefix: "/slack/mastra",
        frameworkOverride: "mastra",
        frontendOverride: "slack",
      }),
    ).toBe("/slack/mastra/human-in-the-loop");
    expect(
      resolveDocsHref("/threads", {
        slugHrefPrefix: "/slack/mastra",
        frameworkOverride: "mastra",
        frontendOverride: "slack",
      }),
    ).toBe("/slack/mastra/threads");
    expect(
      resolveDocsHref("/human-in-the-loop#approval", {
        slugHrefPrefix: "/teams/mastra",
        frameworkOverride: "mastra",
        frontendOverride: "teams",
      }),
    ).toBe("/teams/mastra/human-in-the-loop#approval");
    expect(
      resolveDocsHref("/threads", {
        slugHrefPrefix: "/teams/mastra",
        frameworkOverride: "mastra",
        frontendOverride: "teams",
      }),
    ).toBe("/teams/mastra/threads");
  });

  it("keeps universal protocol links unscoped in channel guides", () => {
    const href = "/agentic-protocols/ag-ui";

    expect(
      resolveDocsHref(href, {
        slugHrefPrefix: "/slack",
        frameworkOverride: "built-in-agent",
        frontendOverride: "slack",
      }),
    ).toBe(href);
    expect(
      resolveDocsHref(href, {
        slugHrefPrefix: "/teams/mastra",
        frameworkOverride: "mastra",
        frontendOverride: "teams",
      }),
    ).toBe(href);
  });

  it("keeps bundled framework quickstart handoffs global in channel guides", () => {
    const setupContent = setupContentData as SetupContentBundle;
    const channelSetups = Object.values(setupContent.concepts).filter(
      (entry) => entry.concept === "channels-agent-setup",
    );
    const quickstartLinks: Array<{ framework: string; href: string }> = [];

    expect(channelSetups).toHaveLength(20);
    for (const { framework, source } of channelSetups) {
      for (const match of source.matchAll(/\]\((\/[^)\s]*\/?quickstart)\)/g)) {
        quickstartLinks.push({ framework, href: match[1] });
      }
    }

    // CrewAI links to its showcase source instead of an internal quickstart.
    expect(quickstartLinks).toHaveLength(18);
    for (const { framework, href } of quickstartLinks) {
      expect(
        resolveDocsHref(href, {
          slugHrefPrefix:
            framework === "built-in-agent" ? "/slack" : `/slack/${framework}`,
          frameworkOverride: framework,
          frontendOverride: "slack",
        }),
        `Slack ${framework}`,
      ).toBe(href);
      expect(
        resolveDocsHref(href, {
          slugHrefPrefix:
            framework === "built-in-agent" ? "/teams" : `/teams/${framework}`,
          frameworkOverride: framework,
          frontendOverride: "teams",
        }),
        `Teams ${framework}`,
      ).toBe(href);
    }
  });

  it("keeps the Channels reference and non-channel surfaces global", () => {
    const mastraSlack = {
      slugHrefPrefix: "/slack/mastra",
      frameworkOverride: "mastra",
      frontendOverride: "slack" as const,
    };

    expect(
      resolveDocsHref("/reference/channels/classes/Channel", mastraSlack),
    ).toBe("/reference/channels/classes/Channel");
    expect(
      resolveDocsHref("/reference/channels/types/JSXCallbacks", mastraSlack),
    ).toBe("/reference/channels/types/JSXCallbacks");
    expect(resolveDocsHref("/channels/not-a-guide", mastraSlack)).toBe(
      "/channels/not-a-guide",
    );
    expect(
      resolveDocsHref("/channels/tools", {
        ...mastraSlack,
        slugHrefPrefix: "/vue/mastra",
        frontendOverride: "vue",
      }),
    ).toBe("/channels/tools");
    expect(resolveDocsHref("/teams/mastra/tools", mastraSlack)).toBe(
      "/teams/mastra/tools",
    );
    expect(resolveDocsHref("`/channels/tools`", mastraSlack)).toBe(
      "`/channels/tools`",
    );
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
    expect(resolveDocsHref("/threads", options)).toBe("/mastra/threads");
    expect(resolveDocsHref("/headless-threads", options)).toBe(
      "/mastra/headless-threads",
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
