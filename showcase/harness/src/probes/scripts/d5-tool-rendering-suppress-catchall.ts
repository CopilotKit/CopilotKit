/**
 * D5 — `tool-rendering-suppress-catchall` script.
 *
 * Drives a backend tool call through a page that registers a wildcard
 * `useDefaultRenderTool({ render: ({ name, parameters, status, result }) => null })`.
 * The expected behavior is
 * not "nothing happened"; the tool call still completes and the assistant
 * sends final text, but no catch-all/custom/named tool-rendering DOM is painted.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

export const SUPPRESSED_TOOL_NAME = "get_weather";
export const SUPPRESSED_TOOL_PROMPT = "suppress catch-all weather case";
export const EXPECTED_FINAL_TEXT = "Tokyo is 22";

const POLL_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;

export interface SuppressedToolRenderingProbe {
  defaultRendererCount: number;
  customCatchallCount: number;
  weatherCardCount: number;
  anyToolNameCount: number;
  bodyText: string;
}

export async function probeSuppressedToolRendering(
  page: Page,
): Promise<SuppressedToolRenderingProbe> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(sel: string): ArrayLike<unknown>;
        body?: { textContent: string | null };
      };
    };

    const count = (selector: string) =>
      win.document.querySelectorAll(selector).length;

    return {
      defaultRendererCount: count(
        '[data-testid="copilot-tool-render"][data-tool-name="get_weather"]',
      ),
      customCatchallCount: count(
        '[data-testid="custom-wildcard-card"][data-tool-name="get_weather"]',
      ),
      weatherCardCount: count('[data-testid="weather-card"]'),
      anyToolNameCount: count('[data-tool-name="get_weather"]'),
      bodyText: (win.document.body?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    };
  });
}

export function validateSuppressedToolRendering(
  snap: SuppressedToolRenderingProbe,
): string | null {
  if (!snap.bodyText.includes(EXPECTED_FINAL_TEXT)) {
    return (
      "tool-rendering-suppress-catchall: expected final assistant text " +
      `containing ${JSON.stringify(EXPECTED_FINAL_TEXT)}; body text: ` +
      JSON.stringify(snap.bodyText.slice(0, 300))
    );
  }
  if (snap.defaultRendererCount > 0) {
    return "tool-rendering-suppress-catchall: built-in catch-all renderer still painted get_weather";
  }
  if (snap.customCatchallCount > 0) {
    return "tool-rendering-suppress-catchall: custom catchall renderer painted get_weather";
  }
  if (snap.weatherCardCount > 0) {
    return "tool-rendering-suppress-catchall: named WeatherCard renderer painted get_weather";
  }
  if (snap.anyToolNameCount > 0) {
    return "tool-rendering-suppress-catchall: some rendered element still exposes data-tool-name=get_weather";
  }
  return null;
}

export async function assertSuppressedToolRendering(
  page: Page,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  let pollCount = 0;

  while (Date.now() < deadline) {
    const snap = await probeSuppressedToolRendering(page);
    pollCount++;
    lastError = validateSuppressedToolRendering(snap);
    if (lastError === null) {
      console.debug("[d5-tool-rendering-suppress-catchall] all checks passed", {
        pollCount,
        snap,
      });
      return;
    }
    if (pollCount === 1 || pollCount % 10 === 0) {
      console.debug("[d5-tool-rendering-suppress-catchall] not ready yet", {
        pollCount,
        lastError,
        snap,
      });
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    lastError ?? "tool-rendering-suppress-catchall: poll deadline exceeded",
  );
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: SUPPRESSED_TOOL_PROMPT,
      assertions: async (page) => {
        await assertSuppressedToolRendering(page);
      },
    },
  ];
}

export function preNavigateRoute(): string {
  return "/demos/tool-rendering-suppress-catchall";
}

registerD5Script({
  featureTypes: ["tool-rendering-suppress-catchall"],
  fixtureFile: "tool-rendering-suppress-catchall.json",
  buildTurns,
  preNavigateRoute,
});
