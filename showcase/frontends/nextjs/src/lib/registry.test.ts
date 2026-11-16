import { describe, expect, it } from "vitest";
import {
  getDemo,
  getIntegration,
  getIntegrations,
  parseDemoPath,
} from "@/lib/registry";

// These read the real registry that generate-registry.ts builds from
// showcase/integrations/*/manifest.yaml. Expected values are literals from
// the strands and mastra manifests.

function demoName(integration: string, demo: string) {
  return getDemo(integration, demo)?.demo.name;
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
      demo: { id: "agentic-chat", name: "Agentic Chat" },
    });
  });

  it("returns undefined for a demo only another integration lists", () => {
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
