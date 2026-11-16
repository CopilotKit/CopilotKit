// Helpers for the one e2e suite. The specs are the same for every
// integration, and INTEGRATION=<slug> picks the integration that a run tests.
// These helpers turn a demo id into that integration's page, skip the demos
// its manifest does not list, and load its settings for a demo.
//
// The registry reads files that `npm run e2e` generates under src/data before
// Playwright starts.
import { test } from "@playwright/test";
import { loadIntegrationDemoConfig } from "../../src/lib/demo-config";
import {
  getDemo,
  getIntegration,
  getIntegrations,
} from "../../src/lib/registry";

/**
 * Checks a value of the INTEGRATION environment variable against the
 * integration manifests.
 *
 * @param value - The slug, for example `"strands"`, or `undefined` when
 *   INTEGRATION is not set.
 * @returns The integration that has this slug.
 * @throws Error when the value is missing, or when no manifest has this slug.
 *   The message lists the slugs that work.
 *
 * @example
 * const { name } = requireIntegration(process.env.INTEGRATION);
 */
export function requireIntegration(value: string | undefined) {
  const slugs = getIntegrations()
    .map((entry) => entry.slug)
    .join(", ");
  if (value === undefined) {
    throw new Error(
      `INTEGRATION is not set. Set it to the integration to test, for example INTEGRATION=strands npm run e2e. Integrations: ${slugs}.`,
    );
  }

  const found = getIntegration(value);
  if (found === undefined) {
    throw new Error(
      `INTEGRATION="${value}" is not a known integration. Integrations: ${slugs}.`,
    );
  }
  return found;
}

/**
 * The slug of the integration under test, from INTEGRATION.
 *
 * Loading this file throws when INTEGRATION is missing or unknown, so the run
 * stops before a test starts.
 */
export const integration = requireIntegration(process.env.INTEGRATION).slug;

/**
 * The path of a demo page of the integration under test.
 *
 * @param demo - The demo id, which is its URL segment, for example
 *   `"agentic-chat"`.
 *
 * @example
 * await page.goto(demoPath("agentic-chat")); // "/demos/strands/agentic-chat"
 */
export function demoPath(demo: string) {
  return `/demos/${integration}/${demo}`;
}

/**
 * True when the integration's manifest lists the demo, so the app serves a
 * page for it.
 *
 * @param integrationSlug - The integration slug, for example `"strands"`.
 * @param demo - The demo id, for example `"agentic-chat"`.
 */
export function isDemoListed(integrationSlug: string, demo: string) {
  return getDemo(integrationSlug, demo) !== undefined;
}

/**
 * Declares the tests of one demo, as `test.describe` does. When the manifest
 * of the integration under test does not list the demo, all of these tests
 * are skipped, and the skip reason names the integration and the demo.
 *
 * @param demo - The demo id, for example `"agentic-chat"`.
 * @param title - The title of the group.
 * @param body - Declares the tests, as in `test.describe`.
 *
 * @example
 * describeDemo("agentic-chat", "Agentic Chat", () => {
 *   test.beforeEach(async ({ page }) => {
 *     await page.goto(demoPath("agentic-chat"));
 *   });
 *
 *   test("shows the chat input", async ({ page }) => {
 *     await expect(page.getByPlaceholder("Type a message")).toBeVisible();
 *   });
 * });
 */
export function describeDemo(demo: string, title: string, body: () => void) {
  test.describe(title, () => {
    test.skip(
      !isDemoListed(integration, demo),
      `The ${integration} manifest does not list the ${demo} demo.`,
    );
    body();
  });
}

/**
 * Loads the settings of the integration under test for one demo: the default
 * export of `src/integrations/<integration>/demos/<demo>.ts`. The demo page
 * reads the same data. When a page behaves differently by design, a spec
 * reads this data instead of checking the slug.
 *
 * @param demo - The demo id, for example `"gen-ui-interrupt"`.
 * @returns The settings, or `undefined` when the integration has no file for
 *   the demo.
 * @throws Error when the integration's manifest does not list the demo.
 *
 * @example
 * const config = await integrationDemoConfig<GenUiInterruptConfig>("gen-ui-interrupt");
 */
export function integrationDemoConfig<T>(demo: string) {
  return loadIntegrationDemoConfig<T>(integration, demo);
}
