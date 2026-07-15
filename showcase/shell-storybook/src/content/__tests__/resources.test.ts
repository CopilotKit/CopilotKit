import { describe, expect, it } from "vitest";

import { curatedResources } from "../resources";
import type { ResourceRef } from "../types";
import {
  resolveDemo,
  resolveFeature,
  resolveResource,
} from "../../lib/registry";

const showcaseDemoHref =
  "https://showcase.copilotkit.ai/integrations/langgraph-python/beautiful-chat";

describe("resolveDemo", () => {
  it("resolves a runnable demo from the generated registry", () => {
    expect(resolveDemo("langgraph-python", "beautiful-chat")).toEqual({
      integrationName: "LangGraph (Python)",
      demoName: "Beautiful Chat",
      route: "/demos/beautiful-chat",
      repo: "https://github.com/CopilotKit/CopilotKit/tree/main/showcase/integrations/langgraph-python",
      storyHref: showcaseDemoHref,
      previewHref: `${showcaseDemoHref}/preview`,
      codeHref: `${showcaseDemoHref}/code`,
    });
  });

  it("names a missing integration in its error", () => {
    expect(() => resolveDemo("missing-integration", "beautiful-chat")).toThrow(
      /missing-integration/,
    );
  });

  it("names both IDs when a demo is missing", () => {
    expect(() => resolveDemo("langgraph-python", "missing-demo")).toThrow(
      /langgraph-python.*missing-demo|missing-demo.*langgraph-python/,
    );
  });

  it("rejects generated demos without a runnable route", () => {
    expect(() => resolveDemo("langgraph-python", "cli-start")).toThrow(
      /langgraph-python.*cli-start.*not runnable|cli-start.*langgraph-python.*not runnable/i,
    );
  });
});

describe("resolveResource", () => {
  it("resolves the curated Showcase home resource exactly", () => {
    expect(resolveResource({ kind: "curated", id: "showcase-home" })).toEqual({
      kind: "curated",
      label: "Open Showcase",
      href: "https://showcase.copilotkit.ai",
    });
  });

  it("fails loudly for an unknown curated resource that bypasses the type", () => {
    const unknownResource = {
      kind: "curated",
      id: "unknown-resource",
    } as unknown as ResourceRef;

    expect(() => resolveResource(unknownResource)).toThrow(/unknown-resource/);
  });

  it.each([
    ["story", `Open Beautiful Chat story`, showcaseDemoHref],
    ["preview", `Open Beautiful Chat live demo`, `${showcaseDemoHref}/preview`],
    ["code", `View Beautiful Chat code`, `${showcaseDemoHref}/code`],
  ] as const)(
    "resolves the exact %s view label and href for a demo resource",
    (view, label, href) => {
      expect(
        resolveResource({
          kind: "demo",
          integration: "langgraph-python",
          demo: "beautiful-chat",
          view,
        }),
      ).toEqual({ kind: "demo", label, href });
    },
  );

  it("resolves feature docs from the generated registry", () => {
    expect(
      resolveResource({ kind: "feature", feature: "beautiful-chat" }),
    ).toEqual({
      kind: "feature",
      label: "Read Beautiful Chat docs",
      href: "https://docs.copilotkit.ai/agentic-chat-ui",
    });
  });
});

describe("resolveFeature", () => {
  it("prefers the shell docs path and includes the category display name", () => {
    expect(resolveFeature("beautiful-chat")).toEqual({
      name: "Beautiful Chat",
      categoryName: "Dev Ex",
      docsHref: "https://docs.copilotkit.ai/agentic-chat-ui",
    });
  });

  it("fails loudly for a missing feature", () => {
    expect(() => resolveFeature("missing-feature")).toThrow(/missing-feature/);
  });
});

describe("curatedResources", () => {
  it("uses descriptive destination labels and HTTPS URLs", () => {
    for (const resource of Object.values(curatedResources)) {
      expect(resource.href).toMatch(/^https:\/\//);
      expect(resource.label).not.toMatch(
        /^(Learn more|Click here|Read more)$/i,
      );
    }
  });
});
