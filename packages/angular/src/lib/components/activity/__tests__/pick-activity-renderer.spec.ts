import { describe, expect, it } from "vitest";
import {
  anyActivityContentSchema,
  type RenderActivityMessageConfig,
} from "../../../activity-renderer";
import { pickActivityRenderer } from "../pick-activity-renderer";
import {
  PrimaryActivityRenderer,
  SecondaryActivityRenderer,
  WildcardActivityRenderer,
} from "./activity-renderer-stubs";

const renderer = (
  overrides: Partial<RenderActivityMessageConfig> = {},
): RenderActivityMessageConfig => ({
  activityType: "a2ui-surface",
  content: anyActivityContentSchema,
  component: PrimaryActivityRenderer,
  ...overrides,
});

describe("pickActivityRenderer", () => {
  it("returns the renderer registered for the activity type", () => {
    const primary = renderer();
    const other = renderer({
      activityType: "other",
      component: SecondaryActivityRenderer,
    });

    expect(
      pickActivityRenderer({
        activityType: "a2ui-surface",
        renderers: [other, primary],
      }),
    ).toBe(primary);
  });

  it("prefers an agent-scoped renderer over a global one registered before it", () => {
    const global = renderer({ component: SecondaryActivityRenderer });
    const scoped = renderer({ agentId: "demo-button" });

    expect(
      pickActivityRenderer({
        activityType: "a2ui-surface",
        agentId: "demo-button",
        renderers: [global, scoped],
      }),
    ).toBe(scoped);
  });

  it("falls back to the global renderer when the agent has no scoped one", () => {
    const global = renderer({ component: SecondaryActivityRenderer });
    const scoped = renderer({ agentId: "other-agent" });

    expect(
      pickActivityRenderer({
        activityType: "a2ui-surface",
        agentId: "demo-button",
        renderers: [scoped, global],
      }),
    ).toBe(global);
  });

  it("ignores agent-scoped renderers when no agentId is given", () => {
    const scoped = renderer({ agentId: "demo-button" });
    const global = renderer({ component: SecondaryActivityRenderer });

    expect(
      pickActivityRenderer({
        activityType: "a2ui-surface",
        renderers: [scoped, global],
      }),
    ).toBe(global);
  });

  it("falls back to the wildcard renderer when no activity type matches", () => {
    const wildcard = renderer({
      activityType: "*",
      component: WildcardActivityRenderer,
    });

    expect(
      pickActivityRenderer({
        activityType: "unregistered",
        renderers: [renderer(), wildcard],
      }),
    ).toBe(wildcard);
  });

  it("returns undefined when nothing matches", () => {
    expect(
      pickActivityRenderer({
        activityType: "unregistered",
        renderers: [renderer()],
      }),
    ).toBeUndefined();
  });
});
