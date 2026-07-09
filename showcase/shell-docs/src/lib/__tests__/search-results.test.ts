import { describe, expect, it } from "vitest";

import {
  buildQuickSearchResults,
  buildSearchResults,
  groupSearchResults,
} from "@/lib/search-results";
import type { SearchIndexEntry } from "@/lib/search-results";
import type { Integration, Registry } from "@/lib/registry";

const shellHost = "https://showcase.test";

function integration(
  slug: string,
  name: string,
  description = `${name} agent framework`,
): Integration {
  return {
    name,
    slug,
    category: "popular",
    language: "typescript",
    description,
    partner_docs: null,
    repo: "",
    copilotkit_version: "",
    backend_url: "",
    deployed: true,
    docs_mode: "generated",
    features: [],
    demos: [],
  };
}

function registry(integrations: Integration[]): Registry {
  return {
    integrations,
    feature_registry: {
      version: "test",
      categories: [{ id: "interaction", name: "Interaction" }],
      features: [
        {
          id: "agent-state",
          name: "Agent state",
          category: "interaction",
          description: "Share agent state with an application",
        },
      ],
    },
  };
}

const pages: SearchIndexEntry[] = [
  {
    type: "page",
    title: "Home",
    subtitle: "Documentation home",
    section: "",
    href: "/",
  },
  {
    type: "page",
    title: "Integrations",
    subtitle: "All integrations",
    section: "",
    href: "/integrations",
  },
  {
    type: "page",
    title: "API Reference",
    subtitle: "Components and hooks",
    section: "",
    href: "/reference",
  },
  {
    type: "page",
    title: "AG-UI Overview",
    subtitle: "Agent-user interaction protocol",
    section: "",
    href: "/ag-ui",
  },
  {
    type: "page",
    title: "Agent quickstart",
    subtitle: "Build a LangGraph agent",
    section: "Integrations",
    href: "/docs/integrations/langgraph/quickstart",
  },
  {
    type: "reference",
    title: "useAgent",
    subtitle: "Access the current agent",
    section: "Hooks",
    href: "/reference/hooks/useAgent",
  },
  {
    type: "reference",
    title: "useAgent duplicate",
    subtitle: "Duplicate generated entry",
    section: "Hooks",
    href: "/reference/hooks/useAgent",
  },
  {
    type: "ag-ui",
    title: "Agent events",
    subtitle: "Stream agent events",
    section: "Events",
    href: "/ag-ui/concepts/events",
  },
];

describe("search result construction", () => {
  it("preserves representative href rewrites and prefers the selected framework", () => {
    const results = buildSearchResults({
      query: "agent",
      pages,
      registryData: registry([
        integration("mastra", "Mastra"),
        integration("langgraph-python", "LangGraph Python"),
      ]),
      selectedFramework: "langgraph-python",
      shellHost,
      activeFrontend: null,
    });

    expect(results[0]).toMatchObject({
      title: "Agent quickstart",
      href: "/langgraph-python/quickstart",
      group: "Documentation",
      selectedFramework: true,
    });
    expect(results).toContainEqual(
      expect.objectContaining({
        title: "useAgent",
        href: "/reference/hooks/useAgent",
        group: "API Reference",
      }),
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        title: "LangGraph Python",
        href: `${shellHost}/integrations/langgraph-python`,
        group: "Integrations",
        selectedFramework: true,
      }),
    );
  });

  it("deduplicates by destination, orders groups deterministically, and caps results", () => {
    const repeatedPages = Array.from({ length: 8 }, (_, index) => ({
      type: "page" as const,
      title: `Agent guide ${String(index).padStart(2, "0")}`,
      subtitle: "Agent documentation",
      section: "Guides",
      href: `/docs/agent-guide-${index}`,
    }));
    const results = buildSearchResults({
      query: "agent",
      pages: [...pages, ...repeatedPages],
      registryData: registry([integration("langgraph-python", "LangGraph")]),
      selectedFramework: "langgraph-python",
      shellHost,
      activeFrontend: null,
    });

    expect(results).toHaveLength(12);
    expect(
      results.filter((result) => result.href === "/reference/hooks/useAgent"),
    ).toHaveLength(1);
    expect(groupSearchResults(results).map((group) => group.label)).toEqual([
      "Documentation",
      "API Reference",
      "AG-UI",
      "Integrations",
    ]);
  });

  it("derives empty-query destinations from the generated index", () => {
    expect(buildQuickSearchResults(pages, shellHost)).toEqual([
      expect.objectContaining({ title: "Home", href: "/" }),
      expect.objectContaining({
        title: "API Reference",
        href: "/reference",
      }),
      expect.objectContaining({ title: "AG-UI Overview", href: "/ag-ui" }),
      expect.objectContaining({
        title: "Integrations",
        href: `${shellHost}/integrations`,
      }),
    ]);
  });
});
