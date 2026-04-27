import { describe, it, expect } from "vitest";
import {
  resolveIntegration,
  isIntegrationSlug,
  stripIntegrationPrefix,
} from "./integration";
import {
  getSupportedIntegrations,
  isCanonicalSupported,
  type PageDef,
} from "../../integrations.config";

describe("resolveIntegration", () => {
  it('returns "built-in" for the root path', () => {
    expect(resolveIntegration("/")).toBe("built-in");
  });

  it('returns "built-in" for unprefixed pages', () => {
    expect(resolveIntegration("/quickstart")).toBe("built-in");
    expect(resolveIntegration("/frontend-tools")).toBe("built-in");
  });

  it("returns the integration slug when prefixed", () => {
    expect(resolveIntegration("/langgraph/quickstart")).toBe("langgraph");
    expect(resolveIntegration("/adk/quickstart")).toBe("adk");
  });

  it("handles trailing slashes", () => {
    expect(resolveIntegration("/langgraph/")).toBe("langgraph");
    expect(resolveIntegration("/langgraph")).toBe("langgraph");
  });

  it('returns "built-in" for unknown prefixes (defensive)', () => {
    expect(resolveIntegration("/unknown-integration/page")).toBe("built-in");
  });
});

describe("isIntegrationSlug", () => {
  it("accepts known slugs", () => {
    expect(isIntegrationSlug("langgraph")).toBe(true);
    expect(isIntegrationSlug("adk")).toBe(true);
    expect(isIntegrationSlug("built-in")).toBe(true);
  });

  it("rejects unknown slugs", () => {
    expect(isIntegrationSlug("foo")).toBe(false);
    expect(isIntegrationSlug("")).toBe(false);
  });
});

describe("stripIntegrationPrefix", () => {
  it("strips a known prefix from a path", () => {
    expect(stripIntegrationPrefix("/langgraph/quickstart")).toBe("/quickstart");
    expect(stripIntegrationPrefix("/adk/shared-state")).toBe("/shared-state");
  });

  it("returns input unchanged when no prefix", () => {
    expect(stripIntegrationPrefix("/quickstart")).toBe("/quickstart");
    expect(stripIntegrationPrefix("/")).toBe("/");
  });

  it("handles edge cases", () => {
    expect(stripIntegrationPrefix("/langgraph")).toBe("/");
    expect(stripIntegrationPrefix("/langgraph/")).toBe("/");
  });
});

describe("getSupportedIntegrations", () => {
  it("returns all integrations when neither only nor except is set", () => {
    const page: PageDef = { slug: "foo", title: "Foo" };
    const supported = getSupportedIntegrations(page);
    expect(supported.length).toBeGreaterThan(1);
    expect(supported).toContain("built-in");
    expect(supported).toContain("langgraph");
    expect(supported).toContain("mastra");
  });

  it("honors `only` (allowlist) — page restricted to listed slugs", () => {
    const page: PageDef = {
      slug: "foo",
      title: "Foo",
      only: ["langgraph", "mastra"],
    };
    const supported = getSupportedIntegrations(page);
    expect(supported).toEqual(["langgraph", "mastra"]);
    expect(supported).not.toContain("built-in");
    expect(supported).not.toContain("adk");
  });

  it("honors `except` (denylist) — page hidden for listed slugs", () => {
    const page: PageDef = {
      slug: "foo",
      title: "Foo",
      except: ["langgraph", "a2a"],
    };
    const supported = getSupportedIntegrations(page);
    expect(supported).not.toContain("langgraph");
    expect(supported).not.toContain("a2a");
    expect(supported).toContain("built-in");
    expect(supported).toContain("mastra");
  });

  it("treats empty `only` as no restriction (defensive)", () => {
    const page: PageDef = { slug: "foo", title: "Foo", only: [] };
    const supported = getSupportedIntegrations(page);
    expect(supported.length).toBeGreaterThan(1);
  });

  it("treats empty `except` as no restriction (defensive)", () => {
    const page: PageDef = { slug: "foo", title: "Foo", except: [] };
    const supported = getSupportedIntegrations(page);
    expect(supported.length).toBeGreaterThan(1);
  });

  it("when both only and except are set, only wins", () => {
    const page: PageDef = {
      slug: "foo",
      title: "Foo",
      only: ["built-in"],
      // @ts-expect-error — exercise the runtime fallback even with conflicting input
      except: ["built-in"],
    };
    const supported = getSupportedIntegrations(page);
    expect(supported).toEqual(["built-in"]);
  });
});

describe("isCanonicalSupported", () => {
  it("is true when no gating is set", () => {
    const page: PageDef = { slug: "foo", title: "Foo" };
    expect(isCanonicalSupported(page)).toBe(true);
  });

  it("is true when only includes built-in", () => {
    const page: PageDef = {
      slug: "foo",
      title: "Foo",
      only: ["built-in", "langgraph"],
    };
    expect(isCanonicalSupported(page)).toBe(true);
  });

  it("is false when only excludes built-in", () => {
    const page: PageDef = {
      slug: "foo",
      title: "Foo",
      only: ["langgraph", "mastra"],
    };
    expect(isCanonicalSupported(page)).toBe(false);
  });

  it("is false when except includes built-in", () => {
    const page: PageDef = {
      slug: "foo",
      title: "Foo",
      except: ["built-in"],
    };
    expect(isCanonicalSupported(page)).toBe(false);
  });

  it("is true when except does not include built-in", () => {
    const page: PageDef = {
      slug: "foo",
      title: "Foo",
      except: ["langgraph"],
    };
    expect(isCanonicalSupported(page)).toBe(true);
  });
});
