import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import type { Page } from "playwright";
import {
  runConversation,
  UnverifiedDefinitionError,
} from "./conversation-runner.js";
import { attachSseInterceptor } from "./sse-interceptor.js";
import { installBrowserContextShims } from "./init-scripts.js";
import { buildTurns } from "../scripts/d5-gen-ui-declarative.js";
import { D5_REGISTRY } from "./d5-registry.js";
import { createPlaywrightProbeExecutor } from "../frontend-matrix-playwright.js";

// Explicit local proof: PILL_PROOF_URL=http://localhost:<port>/demos/declarative-gen-ui
// Set PILL_PROOF_PUBLIC_URL to the normal local shell/docs preview, then run
// pnpm run build && node --test dist/probes/helpers/pill-execution.local.spec.js
// Compiled JS avoids tsx helper injection in the unmodified public page.
// This needs the real integration and aimock. No fake browser/provider responses.
async function withLocalDemo(
  scenario: string,
  check: (page: Page) => Promise<void>,
) {
  const target = process.env.PILL_PROOF_URL;
  assert.ok(target, "PILL_PROOF_URL must name the local declarative demo");
  const url = new URL(target);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      extraHTTPHeaders: { "X-AIMock-Context": "langgraph-python" },
    });
    const page = await context.newPage();
    // Diagnostic tsx compatibility only. Public execution has a separate normal
    // compiled harness proof and never installs these browser shims/headers.
    await installBrowserContextShims(page);
    await attachSseInterceptor(page);
    await page.addInitScript(`document.addEventListener('click', function(event) {
      var button = event.target.closest('button');
      if (button && button.innerText === 'Show my sales dashboard') {
        globalThis.__pillProofClicks = (globalThis.__pillProofClicks || 0) + 1;
      }
    }, true);`);
    await page.goto(url.href);
    await page
      .getByRole("button", { name: "Show my sales dashboard", exact: true })
      .waitFor({ state: "visible" });
    let fills = 0;
    let presses = 0;
    page.fill = async () => {
      fills++;
      throw new Error("unexpected composer fill");
    };
    page.press = async () => {
      presses++;
      throw new Error("unexpected Enter submission");
    };
    await check(page);
    assert.equal(
      fills,
      0,
      `${scenario}: functional execution cannot fill the composer`,
    );
    assert.equal(
      presses,
      0,
      `${scenario}: functional execution cannot press Enter`,
    );
  } finally {
    await browser.close();
  }
}

function pilotTurn() {
  return buildTurns({
    integrationSlug: "langgraph-python",
    featureType: "gen-ui-declarative",
    baseUrl: new URL(process.env.PILL_PROOF_URL!).origin,
  })[0]!;
}

test("the real declarative driver clicks its actual pill without typing", async () => {
  await withLocalDemo("positive", async (page) => {
    const result = await runConversation(page, [pilotTurn()]);
    console.log(JSON.stringify({ scenario: "positive", result }));
    assert.equal(result.failure_turn, undefined, result.error);
    assert.equal(await page.evaluate("globalThis.__pillProofClicks"), 1);
    assert.equal(
      result.pillExecution?.actions[0]?.dispatchedPrompt,
      "Show me my sales dashboard for this quarter.",
    );
  });
});

for (const scenario of [
  "missing",
  "wrong-label",
  "disabled",
  "hidden",
  "no-op",
  "wrong-prompt",
  "no-assertion",
  "empty",
  "wrong-value",
  "hidden-value",
  "swapped-metric",
  "missing-bars",
  "renderer-error",
] as const) {
  test(`the real page rejects ${scenario} without fallback or retry`, async () => {
    await withLocalDemo(scenario, async (page) => {
      const turn = pilotTurn();
      assert.ok(turn.action);
      const pill = page.getByRole("button", {
        name: "Show my sales dashboard",
        exact: true,
      });
      if (scenario === "missing")
        await pill.evaluate((button) => button.remove());
      if (scenario === "wrong-label")
        turn.action.buttonName = "Show My Sales Dashboard";
      if (scenario === "disabled")
        await pill.evaluate((button) => button.setAttribute("disabled", ""));
      if (scenario === "hidden")
        await pill.evaluate((button) => button.setAttribute("hidden", ""));
      if (scenario === "no-op")
        await pill.evaluate((button) =>
          button.addEventListener(
            "click",
            (event: { stopImmediatePropagation(): void }) =>
              event.stopImmediatePropagation(),
            true,
          ),
        );
      if (scenario === "wrong-prompt") {
        turn.input += " WRONG";
        turn.action.expectedDispatchedPrompt = turn.input;
      }
      if (scenario === "no-assertion") delete turn.assertions;
      if (
        [
          "wrong-value",
          "hidden-value",
          "swapped-metric",
          "missing-bars",
          "renderer-error",
        ].includes(scenario)
      ) {
        const assertion = turn.assertions;
        assert.ok(assertion);
        turn.assertions = async (surface, result) => {
          await page.evaluate(
            new Function(
              "control",
              `
            const metric = document.querySelector(
              '[data-testid="declarative-metric"]',
            );
            if (control === "wrong-value" && metric)
              metric.textContent = "$999M";
            if (control === "hidden-value") metric?.setAttribute("hidden", "");
            if (control === "swapped-metric") {
              const labels = document.querySelectorAll(
                '[data-testid="declarative-metric"] > span',
              );
              const first = labels[0];
              const second = labels[1];
              if (!first || !second) throw new Error("metric control missing");
              const text = first.textContent;
              first.textContent = second.textContent;
              second.textContent = text;
            }
            if (control === "missing-bars")
              document
                .querySelectorAll(".recharts-bar-rectangle")
                .forEach((bar) => bar.remove());
            if (control === "renderer-error") {
              const error = document.createElement("div");
              
              error.textContent = "Catalog not found: copilotkit://app-dashboard-catalog";
              document
                .querySelector('[data-testid="copilot-chat"]')
                ?.append(error);
            }
          `,
            ) as (control: string) => void,
            scenario,
          );
          await assertion(surface, result);
        };
      } else {
        // Only negative controls use a short budget; canonical success retains
        // the same LGP response/assertion deadlines as the actual feature.
        turn.responseTimeoutMs = 1_200;
      }
      let navigations = 0;
      page.on("framenavigated", () => navigations++);
      const result = await runConversation(
        page,
        scenario === "empty" ? [] : [turn],
      );
      console.log(JSON.stringify({ scenario, result }));
      assert.equal(result.failure_turn, 1);
      assert.equal(
        result.errorClass,
        scenario === "empty" || scenario === "no-assertion"
          ? "unverified-definition"
          : undefined,
      );
      assert.equal(result.pillExecution?.completed, false);
      assert.equal(result.pillExecution?.attempts, 1);
      assert.equal(navigations, 0, "failed functional action must not reload");
      const clicks: unknown = await page.evaluate(
        "globalThis.__pillProofClicks || 0",
      );
      assert.ok(
        typeof clicks === "number" && clicks <= 1,
        "failed action must not click again",
      );
    });
  });
}

test("the normal public iframe executes the same complete canonical pilot", async () => {
  const target = process.env.PILL_PROOF_PUBLIC_URL;
  assert.ok(
    target,
    "PILL_PROOF_PUBLIC_URL must name the normal local public preview",
  );
  const url = new URL(target);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.ok(process.env.PILL_PROOF_URL);
  const backendUrl = new URL(process.env.PILL_PROOF_URL).origin;
  const browser = await chromium.launch();
  try {
    const execute = createPlaywrightProbeExecutor({
      browser,
      scripts: D5_REGISTRY,
    });
    const result = await execute({
      cell: {
        id: "react/langgraph-python/declarative-gen-ui",
        frontend: "react",
        integration: "langgraph-python",
        feature: "declarative-gen-ui",
        featureTypes: ["gen-ui-declarative"],
      },
      featureType: "gen-ui-declarative",
      url: url.href,
      backendUrl,
      testId: "local-public-pill-proof",
      surface: "public",
    });
    console.log(JSON.stringify({ scenario: "public", result }));
    assert.equal(result.status, "passed", result.error);
    assert.equal(result.diagnostics?.turnsCompleted, 4);
  } finally {
    await browser.close();
  }
});

for (const route of ["voice", "multimodal"] as const) {
  test(`the real ${route} control preserves its canonical dispatch`, async () => {
    await withLocalDemo(route, async (page) => {
      const url = new URL(page.url());
      url.pathname = `/demos/${route}`;
      await page.goto(url.href, { waitUntil: "networkidle" });
      const prompt =
        route === "voice"
          ? "What is the weather in Tokyo?"
          : "can you tell me what is in this demo image I just attached";
      const result = await runConversation(page, [
        {
          input: prompt,
          action: {
            kind: "pill",
            id: route,
            buttonName:
              route === "voice"
                ? "Try a sample audio"
                : "Try with sample image",
            expectedDispatchedPrompt: prompt,
            submission:
              route === "voice"
                ? {
                    kind: "composer",
                    sendButtonName: "",
                    sendButtonTestId: "copilot-send-button",
                    expectedComposerText: prompt,
                  }
                : { kind: "immediate" },
          },
          assertions: async (_surface, response) => {
            assert.ok(
              response.text.includes(
                route === "voice"
                  ? "Tokyo is currently 22°C"
                  : "attached image is the CopilotKit logo",
              ),
            );
          },
        },
      ]);
      assert.equal(result.turns_completed, 1, result.error);
      assert.equal(result.pillExecution?.actions[0]?.dispatchedPrompt, prompt);
      assert.equal(result.pillExecution?.attempts, 1);
    });
  });
}

for (const failFirst of [false, true]) {
  test(`fresh headless scenarios preserve all evidence (first failure=${failFirst})`, async () => {
    await withLocalDemo("fresh-headless", async (page) => {
      const url = new URL(page.url());
      url.pathname = "/demos/headless-simple";
      await page.goto(url.href, { waitUntil: "networkidle" });
      let reloads = 0;
      page.on("request", (request) => {
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame()
        )
          reloads++;
      });
      const prompts = [
        "Say hello in one short sentence.",
        "Tell me a one-line joke.",
        "Give me a fun fact.",
      ];
      const expected = ["Hi!", "scarecrow", "Honey never spoils"];
      const started = Date.now();
      const result = await runConversation(
        page,
        prompts.map((prompt, index) => ({
          input: prompt,
          scenario: index > 0 ? ("fresh" as const) : undefined,
          action: {
            kind: "pill" as const,
            id: `headless-${index}`,
            buttonName: prompt,
            expectedDispatchedPrompt: prompt,
            submission: { kind: "immediate" as const },
          },
          completionSignal: "sse" as const,
          assertions: async (_surface, response) => {
            if (failFirst && index === 0)
              throw new Error("intentional first-result failure");
            assert.ok(response.text.includes(expected[index]!));
          },
        })),
      );
      const proof = result.pillExecution;
      assert.ok(proof);
      assert.ok(Date.parse(proof.startedAt) >= started);
      assert.equal(proof.requiredActions.length, 3);
      assert.equal(proof.attempts, 1);
      assert.equal(reloads, failFirst ? 0 : 2);
      if (failFirst) {
        assert.equal(result.failure_turn, 1);
        assert.equal(proof.actions.length, 1);
        assert.equal(proof.failures.length, 1);
        assert.equal(proof.completedAt, undefined);
      } else {
        assert.equal(result.turns_completed, 3, result.error);
        assert.equal(proof.actions.length, 3);
        assert.ok(
          proof.actions.every(
            (action) => action.clicked && action.assertionPassed,
          ),
        );
        assert.deepEqual(
          proof.actions.map((action) => !!action.resetBefore),
          [false, true, true],
        );
        assert.ok(
          proof.completedAt &&
            Date.parse(proof.completedAt) >= Date.parse(proof.startedAt),
        );
        assert.ok(Date.parse(proof.completedAt!) <= Date.now());
      }
    });
  });
}

test("missing canonical oracle is unverified after the real pill", async () => {
  await withLocalDemo("missing-oracle", async (page) => {
    const turn = pilotTurn();
    turn.assertions = async () => {
      throw new UnverifiedDefinitionError(
        "canonical result oracle unavailable",
      );
    };
    const result = await runConversation(page, [turn]);
    assert.equal(result.errorClass, "unverified-definition");
    assert.equal(result.pillExecution?.actions[0]?.clicked, true);
    assert.equal(result.pillExecution?.completed, false);
    assert.equal(result.pillExecution?.attempts, 1);
  });
});
