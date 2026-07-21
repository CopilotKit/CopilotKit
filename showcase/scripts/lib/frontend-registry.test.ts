import { expect, it } from "vitest";
import { normalizeFrontendRegistry } from "./frontend-registry.js";
import type { FeatureDefinition } from "./frontend-registry.js";

const features: readonly FeatureDefinition[] = [
  { id: "chat", kind: "primary" },
  { id: "cli-start", kind: "docs-only" },
  { id: "retired", deprecated: true },
];

function validRegistry(): unknown {
  return {
    version: "1.0.0",
    default_frontend: "react",
    frontends: [
      {
        id: "react",
        name: "React",
        icon: "react",
        summary: "React frontend.",
        runnable: true,
        feature_support_required: true,
      },
      {
        id: "angular",
        name: "Angular",
        icon: "angular",
        summary: "Angular frontend.",
        runnable: true,
        feature_support_required: true,
      },
      {
        id: "vue",
        name: "Vue",
        icon: "vue",
        summary: "Vue frontend.",
        runnable: false,
        feature_support_required: false,
      },
    ],
    feature_support: {
      chat: {
        react: { state: "supported" },
        angular: { state: "supported" },
      },
      "cli-start": {
        react: { state: "docs-only" },
        angular: { state: "docs-only" },
      },
    },
  };
}

it("returns a complete normalized registry", () => {
  expect(normalizeFrontendRegistry(validRegistry(), features)).toEqual(
    validRegistry(),
  );
});

it("rejects a missing active feature declaration", () => {
  const registry = validRegistry() as {
    feature_support: Record<string, unknown>;
  };
  delete registry.feature_support.chat;

  expect(() => normalizeFrontendRegistry(registry, features)).toThrow(
    'active feature "chat" is missing frontend support',
  );
});

it("rejects an unknown feature declaration", () => {
  const registry = validRegistry() as {
    feature_support: Record<string, unknown>;
  };
  registry.feature_support.orphan = {
    react: { state: "supported" },
    angular: { state: "supported" },
  };

  expect(() => normalizeFrontendRegistry(registry, features)).toThrow(
    'unknown or deprecated feature "orphan"',
  );
});

it("rejects missing required frontend declarations", () => {
  const registry = validRegistry() as {
    feature_support: Record<string, Record<string, unknown>>;
  };
  delete registry.feature_support.chat.angular;

  expect(() => normalizeFrontendRegistry(registry, features)).toThrow(
    'feature "chat" is missing required frontend "angular"',
  );
});

it("requires React and Angular as explicit support dimensions", () => {
  const registry = validRegistry() as {
    frontends: Array<{ id: string }>;
    feature_support: Record<string, Record<string, unknown>>;
  };
  registry.frontends = registry.frontends.filter(
    (frontend) => frontend.id !== "angular",
  );
  delete registry.feature_support.chat.angular;
  delete registry.feature_support["cli-start"].angular;

  expect(() => normalizeFrontendRegistry(registry, features)).toThrow(
    'required frontend "angular" is not registered',
  );
});

it("rejects contradictory docs-only declarations", () => {
  const registry = validRegistry() as {
    feature_support: Record<string, Record<string, unknown>>;
  };
  registry.feature_support["cli-start"].angular = { state: "supported" };

  expect(() => normalizeFrontendRegistry(registry, features)).toThrow(
    'docs-only feature "cli-start" must be docs-only for "angular"',
  );
});

it("requires owned metadata for a permanent exclusion", () => {
  const registry = validRegistry() as {
    feature_support: Record<string, Record<string, unknown>>;
  };
  registry.feature_support.chat.angular = {
    state: "not-applicable",
    reason: "This renderer has no Angular execution model.",
    review_date: "2027-01-21",
  };

  expect(() => normalizeFrontendRegistry(registry, features)).toThrow(
    'feature "chat" frontend "angular" state "not-applicable" requires owner',
  );
});

it("requires issue metadata for a temporary quarantine", () => {
  const registry = validRegistry() as {
    feature_support: Record<string, Record<string, unknown>>;
  };
  registry.feature_support.chat.angular = {
    state: "quarantined",
    reason: "Temporarily disabled while a regression is repaired.",
    owner: "Angular SDK maintainers",
    review_date: "2026-08-21",
  };

  expect(() => normalizeFrontendRegistry(registry, features)).toThrow(
    'feature "chat" frontend "angular" state "quarantined" requires issue',
  );
});
