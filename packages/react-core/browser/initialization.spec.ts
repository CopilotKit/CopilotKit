import type { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";
import calculator from "./fixtures/calculator.json" with { type: "json" };

// The PNI-585 payload, with only the readiness wrapper replaced by the
// supported contract: helpers first, then a direct initialization expression.
const body = calculator.jsExpressions[0]
  .replace("document.addEventListener('DOMContentLoaded', function(){", "")
  .replace(/\}\);\s*$/, "");
const supported = {
  ...calculator,
  jsFunctions:
    calculator.jsFunctions +
    `\nfunction initializeCalculator() {
    document.body.dataset.initializations = String(Number(document.body.dataset.initializations || 0) + 1);
    ${body}
  }`,
  jsExpressions: ["initializeCalculator();"],
};

async function render(page: Page, nextContent: object, sandboxKey = "fixture") {
  await page.evaluate(
    ({ content, key }) => {
      (
        window as unknown as {
          renderContent: (content: object, key: string) => void;
        }
      ).renderContent(content, key);
    },
    { content: nextContent, key: sandboxKey },
  );
}

async function checkCalculator(page: Page) {
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("body")).toHaveAttribute(
    "data-initializations",
    "1",
  );
  for (const value of ["2", "+", "3"]) {
    await frame.locator(`[data-value="${value}"]`).click();
  }
  await frame.locator('[data-action="equals"]').click();
  await expect(frame.locator("#display")).toHaveText("5");
  await frame.locator('[data-action="clear"]').click();
  const metric = frame.locator(".metric-btn").first();
  const value = await metric.getAttribute("data-value");
  await metric.click();
  await expect(frame.locator("#display")).toHaveText(`(${value})`);
  await frame.locator('[data-action="clear"]').click();
}

test("a listener registered after DOMContentLoaded stays inert (PNI-585)", async ({
  page,
}) => {
  await page.goto("/");
  await render(page, {
    ...calculator,
    jsExpressions: [
      ...calculator.jsExpressions,
      "document.body.dataset.injected = 'yes';",
    ],
  });
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("body")).toHaveAttribute("data-injected", "yes");
  await frame.locator('[data-value="2"]').click();
  await expect(frame.locator("#display")).toHaveText("0");
});

for (const mode of ["stream", "replay"] as const) {
  test(`${mode}: initialize once, calculate, use metrics, and preserve isolation`, async ({
    page,
  }) => {
    await page.goto("/");
    if (mode === "stream") {
      await render(page, { html: supported.html, cssComplete: true });
      await expect(page.frameLocator("iframe").locator("#display")).toHaveText(
        "0",
      );
      await render(page, {
        ...supported,
        generating: true,
        jsFunctions: undefined,
        jsExpressions: [],
      });
      await expect(page.frameLocator("iframe").locator("#display")).toHaveText(
        "0",
      );
      await render(page, { ...supported, generating: true });
      await expect(page.frameLocator("iframe").locator("body")).toHaveAttribute(
        "data-initializations",
        "1",
      );
      await render(page, supported);
    } else {
      await render(page, supported);
    }
    await checkCalculator(page);
    // More streamed expressions and repeated content must not reattach listeners.
    const finished = {
      ...supported,
      jsExpressions: [
        ...supported.jsExpressions,
        `
      document.body.dataset.hostAccess = 'allowed';
      try { void window.parent.document.body; } catch { document.body.dataset.hostAccess = 'blocked'; }
      document.body.dataset.storageAccess = 'allowed';
      try { void localStorage.length; } catch { document.body.dataset.storageAccess = 'blocked'; }
    `,
      ],
    };
    await render(page, finished);
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("body")).toHaveAttribute(
      "data-host-access",
      "blocked",
    );
    await expect(frame.locator("body")).toHaveAttribute(
      "data-storage-access",
      "blocked",
    );
    await render(page, finished);
    await checkCalculator(page);
    expect(await page.locator("iframe").getAttribute("sandbox")).not.toContain(
      "allow-same-origin",
    );
    // Opening a saved thread creates a new sandbox and reinitializes its DOM once.
    await render(page, supported, "reopened");
    await checkCalculator(page);
  });
}

// Unmodified gpt-5-mini output for the normal Calculator App suggestion,
// generated with the shared description (PNI-585). No readiness hints were
// added to the user message. Retained so CI needs no model or API credentials.
import generated from "./fixtures/normal-suggestion.json" with { type: "json" };
for (const mode of ["stream", "replay"] as const) {
  test(`${mode}: real normal-suggestion calculator works without payload edits`, async ({
    page,
  }) => {
    await page.goto("/");
    const content = {
      ...generated,
      html: [generated.html],
      htmlComplete: true,
      cssComplete: true,
      generating: false,
    };
    if (mode === "stream") {
      await render(page, {
        ...content,
        generating: true,
        jsFunctions: undefined,
        jsExpressions: [],
      });
      await expect(
        page.frameLocator("iframe").locator("#calc-display"),
      ).toBeVisible();
    }
    await render(page, content);
    const frame = page.frameLocator("iframe");
    await expect(frame.locator(".metric-card")).toHaveCount(9);
    for (const value of ["2", "+", "3"])
      await frame.locator(`[data-key="${value}"]`).click();
    await frame.locator("#btn-equals").click();
    await expect(frame.locator("#calc-display")).toHaveValue("5");
    await frame.locator("#btn-clear").click();
    await frame.locator('.metric-btn[data-value="12300000"]').click();
    await expect(frame.locator("#calc-display")).toHaveValue("12300000");
    await render(page, content);
    await expect(frame.locator(".metric-card")).toHaveCount(9);
  });
}
