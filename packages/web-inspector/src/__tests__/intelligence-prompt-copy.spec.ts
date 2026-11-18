import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";

type Harness = {
  inspector: WebInspectorElement;
  clickPrompt: () => Promise<void>;
  copyState: () => string | null;
  teardown: () => void;
};

function requireElement<T extends Node>(element: T | null, message: string): T {
  if (!element) throw new Error(message);
  return element;
}

async function setup(writeText: () => Promise<void>): Promise<Harness> {
  window.localStorage.setItem(
    "cpk:inspector:state",
    JSON.stringify({ selectedMenu: "home", hasOpenedInspector: true }),
  );
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: { writeText },
  });

  const inspector = new WebInspectorElement();
  document.body.append(inspector);
  await inspector.updateComplete;
  inspector.openInspector("floating_button");
  await inspector.updateComplete;

  const root = requireElement(
    inspector.shadowRoot,
    "Web Inspector shadow root was not rendered",
  );
  const promptButton = () =>
    requireElement(
      root.querySelector<HTMLButtonElement>(
        "[data-inspector-intelligence-copy-prompt]",
      ),
      "Intelligence prompt copy button was not rendered",
    );

  return {
    inspector,
    clickPrompt: async () => {
      promptButton().click();
      await Promise.resolve();
      await inspector.updateComplete;
    },
    copyState: () =>
      root
        .querySelector(".inspector-intelligence-install")
        ?.getAttribute("data-copy-state") ?? null,
    teardown: () => {
      inspector.remove();
      vi.unstubAllGlobals();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.body.replaceChildren();
});

test("a copied prompt returns the button to idle so it can be pressed again", async () => {
  const harness = await setup(async () => {});
  try {
    await harness.clickPrompt();
    expect(harness.copyState()).toBe("copied");

    await vi.advanceTimersByTimeAsync(3_000);
    await harness.inspector.updateComplete;
    expect(harness.copyState()).toBe("copied");

    await vi.advanceTimersByTimeAsync(1_500);
    await harness.inspector.updateComplete;
    expect(harness.copyState()).toBe("idle");
  } finally {
    harness.teardown();
  }
});

test("a failed copy keeps the prompt on screen instead of expiring", async () => {
  const harness = await setup(async () => {
    throw new Error("clipboard refused");
  });
  try {
    await harness.clickPrompt();
    expect(harness.copyState()).toBe("failed");
    expect(
      harness.inspector.shadowRoot?.querySelector(
        ".inspector-intelligence-install-fallback",
      ),
    ).not.toBeNull();

    await vi.advanceTimersByTimeAsync(30_000);
    await harness.inspector.updateComplete;
    expect(harness.copyState()).toBe("failed");
  } finally {
    harness.teardown();
  }
});

test("pressing again restarts the countdown rather than inheriting it", async () => {
  const harness = await setup(async () => {});
  try {
    await harness.clickPrompt();
    await vi.advanceTimersByTimeAsync(3_500);
    await harness.clickPrompt();

    await vi.advanceTimersByTimeAsync(1_000);
    await harness.inspector.updateComplete;
    expect(harness.copyState()).toBe("copied");

    await vi.advanceTimersByTimeAsync(3_500);
    await harness.inspector.updateComplete;
    expect(harness.copyState()).toBe("idle");
  } finally {
    harness.teardown();
  }
});
