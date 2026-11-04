import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

/**
 * Browser tests must not depend on what the live CDN serves. The Inspector
 * fetches the What's New feed and the launcher HUD feed on load, so every
 * browser context serves both from empty fixtures. Context routes have lower
 * priority than `page.route`, so a test can still mock a feed on purpose.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route("https://cdn.copilotkit.ai/notifications/**", (route) =>
      route.fulfill({ json: { schemaVersion: 1, notifications: [] } }),
    );
    await context.route("https://cdn.copilotkit.ai/inspector-hud/**", (route) =>
      route.fulfill({ json: { schemaVersion: 1, rules: [] } }),
    );
    await use(context);
  },
});
