/**
 * D5 — `tool-rendering-default-catchall` script.
 *
 * Phase-2A split (see `.claude/specs/lgp-test-genuine-pass.md`): the old
 * mapping pointed `tool-rendering-default-catchall` at the
 * `d5-tool-rendering.ts` probe, which asserts a per-tool `WeatherCard`
 * — the WRONG signal for the default catchall. The default catchall is
 * CopilotKit's BUILT-IN renderer that fires for ANY tool the user
 * doesn't explicitly handle. The probe must therefore assert the
 * built-in renderer's testid contract, NOT the per-tool card.
 *
 * Built-in default-catchall testid contract:
 *   - container: `[data-testid="copilot-tool-render"]`
 *   - per-call:  `[data-tool-name="<tool_name>"]` attribute on the container
 *   - status:    the same container exposes `data-status`, and contains a
 *                single status pill descendant carrying
 *                `[data-testid="copilot-tool-render-status"]`.
 *
 * The probe drives `/demos/tool-rendering-default-catchall` with a
 * weather prompt (the default-catchall demo uses `get_weather` as its
 * canonical tool), then asserts
 * the built-in renderer rendered the tool call with the expected
 * `data-tool-name`, `data-status`, and status pill.
 *
 * Side effect: importing this module triggers `registerD5Script`. The
 * default loader in `d6-all-pills.ts` discovers it via the `d5-*` filename
 * convention.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/**
 * Tool name the demo's built-in catchall fires for. Aligns with
 * `tool-rendering-default-catchall.json` fixture (`get_weather`).
 */
export const EXPECTED_TOOL_NAME = "get_weather";

/**
 * Container selector for the built-in catchall renderer. Phase-1E
 * production code wires this testid on the wrapper element.
 */
export const CATCHALL_CONTAINER_TESTID = "copilot-tool-render";

/**
 * Status-pill testid exposed by the built-in renderer. There is a
 * single pill element per tool call inside the default-rendered
 * container; its lifecycle state is encoded via the container's
 * `data-status` attribute.
 */
export const STATUS_PILL_TESTID = "copilot-tool-render-status";

/** Total time we'll poll for the renderer to settle, in ms. */
const POLL_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;

/** Snapshot read in a single page.evaluate round-trip. */
export interface DefaultCatchallProbe {
  /** True when at least one container with the matching tool name is present. */
  containerWithToolName: boolean;
  /** True when at least one status-pill testid (any state) is present. */
  statusPillPresent: boolean;
  /** True when the matching container exposes a non-empty data-status value. */
  statusAttributePresent: boolean;
  /** Diagnostic: the data-tool-name values found on rendered containers. */
  observedToolNames: string[];
  /** Diagnostic: the data-status values found on rendered containers. */
  observedStatuses: string[];
}

export async function probeDefaultCatchall(
  page: Page,
): Promise<DefaultCatchallProbe> {
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
      if (name === "get_weather") {
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

/** Validate a snapshot against the built-in catchall contract. */
export function validateDefaultCatchall(
  snap: DefaultCatchallProbe,
): string | null {
  if (!snap.containerWithToolName) {
    return (
      `tool-rendering-default-catchall: expected [data-testid="${CATCHALL_CONTAINER_TESTID}"] ` +
      `with [data-tool-name="${EXPECTED_TOOL_NAME}"]; observed tool names: ` +
      (snap.observedToolNames.length === 0
        ? "(none)"
        : snap.observedToolNames.join(", "))
    );
  }
  if (!snap.statusPillPresent) {
    return (
      "tool-rendering-default-catchall: container present but no status pill " +
      `([data-testid="${STATUS_PILL_TESTID}"]) — built-in renderer regressed`
    );
  }
  if (!snap.statusAttributePresent) {
    return (
      "tool-rendering-default-catchall: container present but no " +
      "data-status attribute; observed statuses: " +
      (snap.observedStatuses.length === 0
        ? "(none)"
        : snap.observedStatuses.join(", "))
    );
  }
  return null;
}

export async function assertDefaultCatchall(
  page: Page,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  let pollCount = 0;
  while (Date.now() < deadline) {
    const snap = await probeDefaultCatchall(page);
    pollCount++;
    lastError = validateDefaultCatchall(snap);
    if (lastError === null) {
      console.debug("[d5-tool-rendering-default-catchall] all checks passed", {
        pollCount,
        snap,
      });
      return;
    }
    if (pollCount === 1 || pollCount % 10 === 0) {
      console.debug("[d5-tool-rendering-default-catchall] not ready yet", {
        pollCount,
        lastError,
        snap,
      });
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    lastError ?? "tool-rendering-default-catchall: poll deadline exceeded",
  );
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "forecast for Tokyo",
      // Wrapped so the assertions callback ignores the Phase-4 `ctx`
      // argument: `assertDefaultCatchall` takes `(page, timeoutMs?)`, not
      // `(page, ctx)`, and ctx is irrelevant to the default-catchall probe.
      assertions: async (page) => {
        await assertDefaultCatchall(page);
      },
    },
  ];
}

/**
 * Override the default `/demos/<featureType>` route. The hyphenated
 * featureType resolves verbatim to `/demos/tool-rendering-default-catchall`,
 * which IS the canonical demo route — but the override is registered
 * for symmetry with the rest of the family and to make the route
 * explicit when scanning the registry.
 */
export function preNavigateRoute(): string {
  return "/demos/tool-rendering-default-catchall";
}

registerD5Script({
  featureTypes: ["tool-rendering-default-catchall"],
  fixtureFile: "tool-rendering-default-catchall.json",
  buildTurns,
  preNavigateRoute,
});
