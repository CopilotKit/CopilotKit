import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

import { createPlaywrightProbeExecutor } from "./frontend-matrix-playwright.js";
import type { ConversationResult } from "./helpers/conversation-runner.js";
import { D5_REGISTRY } from "./helpers/d5-registry.js";
import "./scripts/d5-reasoning-display.js";

// Explicit real-surface regression; requires the unchanged local shell, LGP
// backend, and aimock fixtures. This diagnostic header binding is not evidence
// of production-header-free demo health.
// DISCLOSURE_SHELL_URL=http://localhost:39204
// DISCLOSURE_BACKEND_URL=http://localhost:39200
// node --test dist/probes/frontend-matrix-playwright-click.local.spec.js
function localOrigin(name: string): string {
  const value = process.env[name];
  assert.ok(value, `${name} must name the running local demo service`);
  const url = new URL(value);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  return url.origin;
}

test("public iframe reasoning disclosure remains clickable through the adapter", async () => {
  const shell = localOrigin("DISCLOSURE_SHELL_URL");
  const backend = localOrigin("DISCLOSURE_BACKEND_URL");
  const browser = await chromium.launch();
  try {
    let conversation: ConversationResult | undefined;
    let disclosureExpanded = false;
    const run = createPlaywrightProbeExecutor({
      onConversation: (value) => {
        conversation = value;
      },
      browser: {
        newContext: async (options) => {
          const context = await browser.newContext({
            ...options,
            extraHTTPHeaders: { "x-aimock-context": "langgraph-python" },
          });
          const close = context.close.bind(context);
          context.close = async (options) => {
            try {
              const frame = context
                .pages()[0]
                ?.frames()
                .find((candidate) => candidate.url().startsWith(backend));
              assert.ok(frame, "actual demo iframe remains present");
              await frame
                .locator('[data-message-id] > button[aria-expanded="true"]')
                .waitFor({ state: "visible", timeout: 5_000 });
              disclosureExpanded = true;
            } finally {
              await close(options);
            }
          };
          return context;
        },
      },
      scripts: D5_REGISTRY,
      probeTimeoutMs: 90_000,
    });
    const result = await run({
      cell: {
        id: "react/langgraph-python/reasoning-default",
        frontend: "react",
        integration: "langgraph-python",
        feature: "reasoning-default",
        featureTypes: ["reasoning-default"],
      },
      featureType: "reasoning-default",
      url: `${shell}/react/langgraph-python/reasoning-default`,
      backendUrl: backend,
      testId: "disclosure-click-local-regression",
      surface: "public",
    });
    console.log(JSON.stringify(result));
    assert.equal(result.status, "passed", JSON.stringify(result));
    assert.equal(
      disclosureExpanded,
      true,
      "reasoning disclosure visibly expanded",
    );
    assert.equal(conversation?.pillExecution?.completed, true);
    assert.equal(conversation?.pillExecution?.actions.length, 1);
    assert.equal(conversation?.pillExecution?.actions[0]?.clicked, true);
    assert.equal(
      conversation?.pillExecution?.actions[0]?.assertionPassed,
      true,
    );
  } finally {
    await browser.close();
  }
});
