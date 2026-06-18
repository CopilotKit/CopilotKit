/**
 * D5 — `tool-rendering-named-override` script.
 *
 * Proves renderer precedence for a specific tool:
 *   1. `get_weather` has a named renderer that returns null, so weather calls
 *      complete with final text but no tool-rendering DOM.
 *   2. `get_stock_price` has no named override on the page, so it still falls
 *      through to the built-in catch-all renderer.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { assertSuppressedToolRendering } from "./d5-tool-rendering-suppress-catchall.js";

export const NAMED_OVERRIDE_WEATHER_PROMPT = "forecast for Tokyo";
export const CATCHALL_STOCK_PROMPT = "What's the current price of AAPL?";

const POLL_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;

export interface StockCatchallProbe {
  containerWithToolName: boolean;
  statusPillPresent: boolean;
  statusAttributePresent: boolean;
  observedToolNames: string[];
  observedStatuses: string[];
}

export async function probeStockCatchall(
  page: Page,
): Promise<StockCatchallProbe> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(sel: string): ArrayLike<{
          getAttribute(name: string): string | null;
          querySelector(sel: string): unknown;
        }>;
      };
    };

    const observedToolNames: string[] = [];
    const observedStatuses: string[] = [];
    let containerWithToolName = false;
    let statusPillPresent = false;
    let statusAttributePresent = false;

    const containers = win.document.querySelectorAll(
      '[data-testid="copilot-tool-render"]',
    );
    for (let i = 0; i < containers.length; i++) {
      const c = containers[i]!;
      const name = c.getAttribute("data-tool-name");
      const status = c.getAttribute("data-status");
      if (name) observedToolNames.push(name);
      if (status) observedStatuses.push(status);
      if (name === "get_stock_price") {
        containerWithToolName = true;
        statusAttributePresent = typeof status === "string" && status !== "";
        statusPillPresent = !!c.querySelector(
          '[data-testid="copilot-tool-render-status"]',
        );
      }
    }

    return {
      containerWithToolName,
      statusPillPresent,
      statusAttributePresent,
      observedToolNames,
      observedStatuses,
    };
  });
}

export function validateStockCatchall(snap: StockCatchallProbe): string | null {
  if (!snap.containerWithToolName) {
    return (
      'tool-rendering-named-override: expected built-in renderer with data-tool-name="get_stock_price"; observed tool names: ' +
      (snap.observedToolNames.length === 0
        ? "(none)"
        : snap.observedToolNames.join(", "))
    );
  }
  if (!snap.statusPillPresent) {
    return "tool-rendering-named-override: stock catchall container has no status pill";
  }
  if (!snap.statusAttributePresent) {
    return (
      "tool-rendering-named-override: stock catchall container has no data-status; observed statuses: " +
      (snap.observedStatuses.length === 0
        ? "(none)"
        : snap.observedStatuses.join(", "))
    );
  }
  return null;
}

export async function assertStockFallsThroughToCatchall(
  page: Page,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  let pollCount = 0;

  while (Date.now() < deadline) {
    const snap = await probeStockCatchall(page);
    pollCount++;
    lastError = validateStockCatchall(snap);
    if (lastError === null) {
      console.debug(
        "[d5-tool-rendering-named-override] stock catchall passed",
        {
          pollCount,
          snap,
        },
      );
      return;
    }
    if (pollCount === 1 || pollCount % 10 === 0) {
      console.debug("[d5-tool-rendering-named-override] not ready yet", {
        pollCount,
        lastError,
        snap,
      });
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    lastError ?? "tool-rendering-named-override: poll deadline exceeded",
  );
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: NAMED_OVERRIDE_WEATHER_PROMPT,
      assertions: async (page) => {
        await assertSuppressedToolRendering(page);
      },
    },
    {
      input: CATCHALL_STOCK_PROMPT,
      assertions: async (page) => {
        await assertStockFallsThroughToCatchall(page);
      },
    },
  ];
}

export function preNavigateRoute(): string {
  return "/demos/tool-rendering-named-override";
}

registerD5Script({
  featureTypes: ["tool-rendering-named-override"],
  fixtureFile: "tool-rendering-named-override.json",
  buildTurns,
  preNavigateRoute,
});
