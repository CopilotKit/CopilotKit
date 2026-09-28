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
 * Built-in default-catchall testid contract (Phase-1E production code):
 *   - container: `[data-testid="copilot-tool-render"]`
 *   - per-call:  `[data-tool-name="<tool_name>"]` attribute on the container
 *   - status:    a single status pill descendant element carrying
 *                `[data-testid="copilot-tool-render-status"]`. The
 *                lifecycle state (`inProgress` | `executing` |
 *                `complete`) is exposed on the container's
 *                `data-status` attribute, but the probe only asserts
 *                the pill testid's presence — that is sufficient to
 *                detect a regression where the renderer drops the
 *                pill entirely.
 *
 * The probe drives `/demos/tool-rendering-default-catchall` with a
 * weather prompt (the default-catchall demo uses `get_weather` as its
 * canonical tool — same fixture as `tool-rendering`), then asserts
 * the built-in renderer rendered the tool call with the expected
 * `data-tool-name` and a status pill.
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
 * `tool-rendering.json` fixture (`get_weather`).
 */
export const EXPECTED_TOOL_NAME = "get_weather";

/**
 * Container selector for the built-in catchall renderer. Phase-1E
 * production code wires this testid on the wrapper element.
 */
export const CATCHALL_CONTAINER_TESTID = "copilot-tool-render";

/**
 * Status-pill testid exposed by the built-in renderer. There is a
 * single pill element per tool call; its lifecycle state is encoded
 * via the container's `data-status` attribute (see
 * `DefaultToolCallRenderer` in
 * `packages/react-core/src/v2/hooks/use-default-render-tool.tsx`).
 *
 * We assert the pill testid is present — a "no pill at all" outcome
 * means the renderer regressed.
 */
export const STATUS_PILL_TESTID = "copilot-tool-render-status";

/**
 * The narration phrase the CUSTOM-catchall fixtures emit (see
 * `d5-tool-rendering-custom-catchall.ts`). The default-catchall page
 * must NEVER include this phrase — its presence indicates a
 * cross-fixture leak (e.g. PR #5465's toolName-strip mistake or a
 * latent `userMessage` collision between the two fixture files). The
 * negative assertion below catches that regression at the content
 * layer, which the testid + tool-name asserts structurally cannot.
 */
export const CUSTOM_CATCHALL_LEAK_PHRASE =
  "rendered through the custom wildcard catchall";

/** Total time we'll poll for the renderer to settle, in ms. */
const POLL_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;

/** Snapshot read in a single page.evaluate round-trip. */
export interface DefaultCatchallProbe {
  /** True when at least one container with the matching tool name is present. */
  containerWithToolName: boolean;
  /** True when at least one status-pill testid (any state) is present. */
  statusPillPresent: boolean;
  /** Diagnostic: the data-tool-name values found on rendered containers. */
  observedToolNames: string[];
  /**
   * True when the page body contains the custom-catchall content
   * phrase (`CUSTOM_CATCHALL_LEAK_PHRASE`). On the default-catchall
   * page this MUST be false; true indicates a cross-fixture leak.
   * Optional so existing test fixtures predating the field still
   * type-check; absence is treated as `false` by the validator.
   */
  customLeakPhrasePresent?: boolean;
}

export async function probeDefaultCatchall(
  page: Page,
): Promise<DefaultCatchallProbe> {
  // ROOT CAUSE (PR #5495 A11, then A25a): the prior implementation passed the
  // leak phrase into the browser-side closure via the `page.evaluate(fn, arg)`
  // second-arg form:
  //
  //     const leakPhrase = CUSTOM_CATCHALL_LEAK_PHRASE;
  //     return await page.evaluate((expectedLeakPhrase?: string) => {
  //       const needle = expectedLeakPhrase ?? "";
  //       if (needle) { /* … cascade scan … */ }
  //       ...
  //     }, leakPhrase);
  //
  // Empirically (verified during the A11 RED-GREEN proof on the SIBLING
  // `tool-rendering-custom-catchall` probe), `expectedLeakPhrase` arrives as
  // `undefined` inside the browser-side closure — the arg is NOT propagated
  // through the harness's compiled `page.evaluate` call path. With
  // `needle === ""`, the `if (needle)` guard skipped the entire leak-detection
  // cascade and `customLeakPhrasePresent` stayed `false` forever, even when
  // the canonical phrase WAS in the DOM — making `validateDefaultCatchall`'s
  // leak branch (the check at the end of `validateDefaultCatchall`) dead
  // code. The defensive fix mirrors the sibling probe by inlining the needle
  // as a JS string literal inside the closure — no `page.evaluate(fn, arg)`
  // second-arg dependency at all.
  //
  // The needle is the canonical leak phrase exported above as
  // `CUSTOM_CATCHALL_LEAK_PHRASE`. Keep these two in lock-step.
  return await page.evaluate(() => {
    const needle = "rendered through the custom wildcard catchall";
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(sel: string): ArrayLike<{
          getAttribute(name: string): string | null;
          querySelector(sel: string): unknown;
          textContent: string | null;
        }>;
        querySelector(sel: string): unknown;
        body: { textContent?: string | null };
      };
    };

    const observedToolNames: string[] = [];
    let containerWithToolName = false;
    let statusPillPresent = false;

    // Path A — strict testid contract. Lands once
    // @copilotkit/react-core releases the
    // `[data-testid="copilot-tool-render"]` wrapper added in commit
    // ba60df5d3 (currently unreleased — neither 1.57.1 nor any 1.57
    // canary include it).
    const containers = win.document.querySelectorAll(
      '[data-testid="copilot-tool-render"]',
    );
    for (let i = 0; i < containers.length; i++) {
      const c = containers[i]!;
      const name = c.getAttribute("data-tool-name");
      if (name) observedToolNames.push(name);
      if (name === "get_weather") containerWithToolName = true;
    }
    if (containerWithToolName) {
      statusPillPresent = !!win.document.querySelector(
        '[data-testid="copilot-tool-render-status"]',
      );
    }

    // Path B — fallback for the published 1.56.5 default renderer
    // shape, which carries no testids: scan assistant-message bubbles
    // for the literal tool name plus the "Done" status label that
    // DefaultToolCallRenderer emits inline. Both have to land in the
    // SAME bubble so we don't false-positive on (e.g.) the agent's
    // narration mentioning "get_weather" without an actual tool card.
    if (!containerWithToolName) {
      const assistantBubbles = win.document.querySelectorAll(
        '[data-testid="copilot-assistant-message"]',
      );
      for (let i = 0; i < assistantBubbles.length; i++) {
        const text = (assistantBubbles[i]!.textContent ?? "").toLowerCase();
        if (text.includes("get_weather")) {
          observedToolNames.push("get_weather");
          if (text.includes("done") || text.includes("running")) {
            containerWithToolName = true;
            statusPillPresent = true;
            break;
          }
        }
      }
    }

    // Scan assistant-message bubbles for the custom-catchall leak phrase.
    // We use `textContent` over `innerText` so off-viewport bubbles in a
    // scrolled chat still register; otherwise a leaked bubble below the
    // fold could escape the leak check entirely.
    let customLeakPhrasePresent = false;
    const bubbles = win.document.querySelectorAll(
      '[data-testid="copilot-assistant-message"]',
    );
    for (let i = 0; i < bubbles.length; i++) {
      const t = bubbles[i]!.textContent ?? "";
      if (t.includes(needle)) {
        customLeakPhrasePresent = true;
        break;
      }
    }
    if (!customLeakPhrasePresent) {
      const body = win.document.body;
      const bodyText = (body.textContent ?? "") as string;
      customLeakPhrasePresent = bodyText.includes(needle);
    }

    return {
      containerWithToolName,
      statusPillPresent,
      observedToolNames,
      customLeakPhrasePresent,
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
  if (snap.customLeakPhrasePresent) {
    return (
      "tool-rendering-default-catchall: page body contains the custom-catchall " +
      `narration phrase ${JSON.stringify(CUSTOM_CATCHALL_LEAK_PHRASE)} — ` +
      "a custom-catchall fixture leaked into the default-catchall request " +
      "(see d5-tool-rendering-custom-catchall.ts for the LGP-gold disjoint-prompts pattern)"
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
      // After the testid + tool-name checks pass, also assert the
      // assistant narration content (the bubble text resolved by the
      // conversation runner) does NOT contain the custom-catchall leak
      // phrase. This catches the cross-fixture leak that the testid
      // checks structurally cannot — see the
      // `d5-tool-rendering-custom-catchall.ts` companion probe and PR
      // #5465's failure mode for context.
      assertions: async (page, ctx) => {
        await assertDefaultCatchall(page);
        if (ctx.text.includes(CUSTOM_CATCHALL_LEAK_PHRASE)) {
          throw new Error(
            "tool-rendering-default-catchall: narration content contains " +
              `the custom-catchall leak phrase ${JSON.stringify(CUSTOM_CATCHALL_LEAK_PHRASE)} — ` +
              "a custom-catchall fixture leaked into the default-catchall " +
              "request (LGP-gold disjoint-prompts pattern violated). " +
              `Observed text: ${JSON.stringify(ctx.text.slice(0, 200))}`,
          );
        }
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
