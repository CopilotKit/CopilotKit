import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import registryData from "@/data/registry.json";
import {
  getDemo,
  getIntegration,
  getIntegrations,
  hasDemo,
  parseDemoPath,
} from "@/lib/registry";

// These read the real data: the registry that generate-registry.ts builds from
// showcase/integrations/*/manifest.yaml, and the extra demos that
// collect-extra-demos.ts collects from src/integrations/*/extra-demos.json.
// Expected values are literals from those files.

// Each integration's own website keeps its demos in
// showcase/integrations/<slug>/src/app/demos/<id>/.
const INTEGRATIONS_DIR = fileURLToPath(
  new URL("../../../../integrations/", import.meta.url),
);

function demoName(integration: string, demo: string) {
  return getDemo(integration, demo)?.demo.name;
}

// The demo folders of an integration's website. A folder whose name starts
// with "_", such as _shared, holds helpers and is not a demo.
function websiteDemoIds(slug: string) {
  const demosDir = path.join(INTEGRATIONS_DIR, slug, "src", "app", "demos");
  const entries = fs.readdirSync(demosDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);
}

// The routes in an integration's manifest, read from registry.json directly.
function manifestRoutes(slug: string) {
  const manifest = registryData.integrations.find(
    (integration) => integration.slug === slug,
  );
  return manifest?.demos.map((demo) => demo.route) ?? [];
}

describe("getIntegration", () => {
  it("returns the integration a manifest describes", () => {
    const integration = getIntegration("strands");

    expect(integration?.slug).toBe("strands");
    expect(integration?.name).toBe("AWS Strands (Python)");
  });

  it("returns undefined for a slug no manifest has", () => {
    expect(getIntegration("no-such-integration")).toBeUndefined();
  });
});

describe("getDemo", () => {
  it("finds a demo page the manifest lists", () => {
    expect(getDemo("strands", "agentic-chat")).toMatchObject({
      integration: { slug: "strands", name: "AWS Strands (Python)" },
      demo: { id: "agentic-chat", name: "Agentic Chat", extra: false },
    });
  });

  it("finds an extra demo, named from its id when no manifest lists it", () => {
    expect(getDemo("strands", "threadid-frontend-tool-roundtrip")).toEqual({
      integration: expect.objectContaining({ slug: "strands" }),
      demo: {
        id: "threadid-frontend-tool-roundtrip",
        name: "Threadid Frontend Tool Roundtrip",
        description: "",
        extra: true,
      },
    });
  });

  it("names an extra demo after the first manifest that lists the page", () => {
    // The langgraph-python manifest has no /demos/hitl. In registry order,
    // mastra's manifest is the first that has it.
    expect(getDemo("langgraph-python", "hitl")?.demo).toEqual({
      id: "hitl",
      name: "Human in the Loop (Step Selection)",
      description: "",
      extra: true,
    });
  });

  it("returns undefined for a demo that is not in the manifest or the extra demos", () => {
    expect(demoName("mastra", "background-agents")).toBe("Background Agents");
    expect(getDemo("strands", "background-agents")).toBeUndefined();
  });

  it("returns undefined for an unknown integration", () => {
    expect(getDemo("no-such-integration", "agentic-chat")).toBeUndefined();
  });

  it("names a page two manifest entries share after the first entry", () => {
    expect(demoName("strands", "hitl-in-chat")).toBe(
      "In-Chat HITL (useHumanInTheLoop)",
    );
    const strands = getIntegration("strands");
    const hitlPages = strands?.demos.filter(
      (demo) => demo.id === "hitl-in-chat",
    );
    expect(hitlPages).toHaveLength(1);
  });

  it("returns undefined for an entry whose id is not a page", () => {
    // hitl-in-chat-booking routes to /demos/hitl-in-chat; cli-start is a
    // command with no route.
    expect(getDemo("strands", "hitl-in-chat-booking")).toBeUndefined();
    expect(getDemo("strands", "cli-start")).toBeUndefined();
  });
});

describe("extra demos", () => {
  const extraDemos = getIntegrations().flatMap((integration) =>
    integration.demos
      .filter((demo) => demo.extra)
      .map((demo) => ({ slug: integration.slug, id: demo.id })),
  );

  it("each names a demo folder of the integration's website", () => {
    const missing = extraDemos.filter(
      ({ slug, id }) => !websiteDemoIds(slug).includes(id),
    );

    expect(missing).toEqual([]);
  });

  it("is never a page the integration's manifest lists", () => {
    const listed = extraDemos.filter(({ slug, id }) =>
      manifestRoutes(slug).includes(`/demos/${id}`),
    );

    expect(listed).toEqual([]);
  });

  it("with the manifest pages, serves every demo folder of each website", () => {
    const unserved = getIntegrations().flatMap(({ slug }) =>
      websiteDemoIds(slug)
        .filter((id) => getDemo(slug, id) === undefined)
        .map((id) => ({ slug, id })),
    );

    expect(unserved).toEqual([]);
  });
});

describe("hasDemo", () => {
  it("is true for a demo in the integration's manifest", () => {
    expect(hasDemo("strands", "agentic-chat")).toBe(true);
  });

  it("is true for one of the integration's extra demos", () => {
    expect(hasDemo("strands", "threadid-frontend-tool-roundtrip")).toBe(true);
  });

  it("is false for a demo the integration does not serve", () => {
    expect(hasDemo("strands", "background-agents")).toBe(false);
  });

  it("is false for an unknown integration", () => {
    expect(hasDemo("no-such-integration", "agentic-chat")).toBe(false);
  });
});

describe("getIntegrations", () => {
  it("lists the integrations the manifests describe", () => {
    const slugs = getIntegrations().map((integration) => integration.slug);

    expect(slugs).toEqual(
      expect.arrayContaining(["built-in-agent", "mastra", "strands"]),
    );
  });
});

describe("parseDemoPath", () => {
  it("reads the integration and demo segments", () => {
    expect(parseDemoPath("/demos/strands/agentic-chat")).toEqual({
      integration: "strands",
      demo: "agentic-chat",
    });
  });

  it("leaves out the segments the path does not have", () => {
    expect(parseDemoPath("/demos/strands")).toEqual({
      integration: "strands",
      demo: undefined,
    });
  });

  it("returns no segments for a path outside /demos", () => {
    expect(parseDemoPath("/api/strands/agentic-chat")).toEqual({
      integration: undefined,
      demo: undefined,
    });
  });
});
