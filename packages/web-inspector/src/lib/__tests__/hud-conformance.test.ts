import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseHudFeed, resolveHudContent } from "../hud-config.js";
import type { HudContent, HudContext } from "../hud-config.js";
import { HUD_DEFAULT_CONTENT } from "../hud-defaults.js";
import { INSPECTOR_MENU_KEYS } from "../inspector-nav.js";
const fixture: {
  defaults: HudContent;
  supportedDestinations: string[];
  scenarios: {
    name: string;
    feed: unknown;
    cases: { name: string; context: HudContext; content: HudContent }[];
  }[];
  invalidFeeds: { name: string; feed: unknown }[];
  validFeeds: { name: string; feed: unknown }[];
} = JSON.parse(
  readFileSync("src/lib/__tests__/inspector-hud-conformance.json", "utf8"),
);
// `publishable` is a producer-only gate; the client accepts every scenario.
const cases = fixture.scenarios.flatMap((scenario) =>
  scenario.cases.map((entry) => ({ ...entry, scenario: scenario.name })),
);

test("fixture defaults are the Inspector's built-in HUD content", () => {
  expect(fixture.defaults).toEqual(HUD_DEFAULT_CONTENT);
});

test("fixture destinations are the Inspector's menu keys", () => {
  expect([...fixture.supportedDestinations].sort()).toEqual(
    [...INSPECTOR_MENU_KEYS].sort(),
  );
});

test.each(fixture.scenarios)("parses scenario feed: $name", ({ feed }) => {
  expect(parseHudFeed(feed)).not.toBeNull();
});

test.each(cases)(
  "producer/consumer conformance: $scenario / $name",
  (entry) => {
    const scenario = fixture.scenarios.find((s) => s.name === entry.scenario);
    expect(
      resolveHudContent(parseHudFeed(scenario?.feed), entry.context, {
        defaults: fixture.defaults,
        supportedDestinations: fixture.supportedDestinations,
      }),
    ).toEqual(entry.content);
  },
);

test.each(fixture.invalidFeeds)("rejects invalid feed: $name", ({ feed }) => {
  expect(parseHudFeed(feed)).toBeNull();
});

test.each(fixture.validFeeds)("accepts valid feed: $name", ({ feed }) => {
  expect(parseHudFeed(feed)).not.toBeNull();
});
