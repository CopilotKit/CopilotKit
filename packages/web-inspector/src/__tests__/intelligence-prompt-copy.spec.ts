import { afterEach, expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";

/**
 * The copy button's two outcomes expire differently, and the asymmetry is the
 * whole point: a confirmation is transient, a recovery surface is not.
 *
 * Verified by mutation. Disabling the reset kills the two copied-state tests.
 * The failed-state test is deliberately blunter — it survives scheduling a
 * reset for a failed copy, because the timer's own guard re-checks the state
 * before acting, so the payload stays put either way. It only fails once both
 * safeguards are gone. That is a fact about the implementation being defended
 * twice, not a claim that this test catches a single careless edit.
 */

type Harness = {
  inspector: WebInspectorElement;
  button: HTMLButtonElement;
  state: () => string | undefined;
  teardown: () => void;
};

/** Mount the element and drive its Home install prompt directly. */
async function setup(
  writeText: () => Promise<void>,
): Promise<Omit<Harness, "button">> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const inspector = new WebInspectorElement();
  document.body.append(inspector);
  await inspector.updateComplete;

  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: { writeText },
  });

  return {
    inspector,
    state: () =>
      (inspector as unknown as { promptCopyState: string }).promptCopyState,
    teardown: () => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      inspector.remove();
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

test("a copied prompt returns the button to idle so it can be pressed again", async () => {
  const { inspector, state, teardown } = await setup(async () => {});
  try {
    await (
      inspector as unknown as {
        handleIntelligencePromptCopy: () => Promise<void>;
      }
    ).handleIntelligencePromptCopy();
    expect(state()).toBe("copied");

    // Still standing well after a reader would have finished six words...
    await vi.advanceTimersByTimeAsync(3_000);
    expect(state()).toBe("copied");

    // ...and gone by the time someone could have returned from their editor.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(state()).toBe("idle");
  } finally {
    teardown();
  }
});

test("a failed copy keeps the prompt on screen instead of expiring", async () => {
  const { inspector, state, teardown } = await setup(async () => {
    throw new Error("clipboard refused");
  });
  try {
    await (
      inspector as unknown as {
        handleIntelligencePromptCopy: () => Promise<void>;
      }
    ).handleIntelligencePromptCopy();
    expect(state()).toBe("failed");

    // The failure state is the only place the prompt text is selectable by
    // hand. Expiring it would pull the payload away mid-selection.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state()).toBe("failed");
  } finally {
    teardown();
  }
});

test("pressing again restarts the countdown rather than inheriting it", async () => {
  const { inspector, state, teardown } = await setup(async () => {});
  try {
    const copy = (
      inspector as unknown as {
        handleIntelligencePromptCopy: () => Promise<void>;
      }
    ).handleIntelligencePromptCopy;

    await copy.call(inspector);
    await vi.advanceTimersByTimeAsync(3_500);
    await copy.call(inspector);

    // Under the first press's clock this would already have reverted.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state()).toBe("copied");

    await vi.advanceTimersByTimeAsync(3_500);
    expect(state()).toBe("idle");
  } finally {
    teardown();
  }
});
