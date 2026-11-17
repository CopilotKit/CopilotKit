import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "../helpers/conversation-runner.js";
import { buildInterruptHeadlessAssertion } from "./d5-interrupt-headless.js";

const POPUP = '[data-testid="interrupt-headless-popup"]';
const EMPTY = '[data-testid="interrupt-headless-empty"]';
const SLOT = '[data-testid^="interrupt-headless-slot-"]';
const ASSISTANT_MESSAGE = '[data-testid="copilot-assistant-message"]';

/**
 * A fake of langgraph-python's interrupt-headless page, paused on pill 1's
 * time picker. A slot click resumes the run, and the page clears the picker
 * on RUN_STARTED, so the empty state re-mounts while the resumed run is still
 * in flight.
 *
 * The probe's page functions run for real: `evaluate` calls them against a
 * stubbed `document` and the run-lifecycle globals that
 * `attachSseInterceptor` installs on a real page.
 */
function mountDemoPage() {
  const demo = {
    popupMounted: true,
    slotClicked: false,
    assistantMessages: ["Sure — let me check available times."],
  };
  const running = {
    attrPresent: true,
    sawRunningTrue: true,
    runningNow: false,
    runStartCount: 1,
    lastStoppedAtMs: Date.now() - 1_000,
  };
  const slot = {
    click() {
      demo.slotClicked = true;
      demo.popupMounted = false;
      running.runningNow = true;
      running.runStartCount += 1;
    },
  };
  const document = {
    querySelector(selector: string) {
      if (selector === POPUP) return demo.popupMounted ? {} : null;
      if (selector === EMPTY) return demo.popupMounted ? null : {};
      if (selector === SLOT) return demo.popupMounted ? slot : null;
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector !== ASSISTANT_MESSAGE) return [];
      return demo.assistantMessages.map((textContent) => ({ textContent }));
    },
    body: {
      get textContent() {
        return demo.assistantMessages.join(" ");
      },
    },
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("__hk_copilotRunning", running);
  vi.stubGlobal("__hk_runsFinished", 1);

  const page: Page = {
    async waitForSelector(selector) {
      if (document.querySelector(selector) === null) {
        throw new Error(`${selector} is not on the page`);
      }
    },
    async fill() {},
    async press() {},
    evaluate<R, A>(fn: (arg?: A) => R, arg?: A) {
      return new Promise<R>((resolve) => resolve(fn(arg)));
    },
  };

  return {
    page,
    slotClicked: () => demo.slotClicked,
    emptyStateMounted: () => document.querySelector(EMPTY) !== null,
    /** The resumed run streams the booking and stops. */
    finishResumedRun() {
      demo.assistantMessages.push(
        "Booked: Sales intro call confirmed for the slot you picked.",
      );
      running.runningNow = false;
      running.lastStoppedAtMs = Date.now();
      vi.stubGlobal("__hk_runsFinished", 2);
    },
  };
}

describe("buildInterruptHeadlessAssertion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for the resumed run to finish, not only for the empty state to re-mount", async () => {
    const demo = mountDemoPage();
    const assertion = buildInterruptHeadlessAssertion("sales-call")(demo.page);
    let settled = false;
    void assertion.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(2_000);
    expect(demo.slotClicked()).toBe(true);
    expect(demo.emptyStateMounted()).toBe(true);
    expect(settled).toBe(false);

    demo.finishResumedRun();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(assertion).resolves.toBeUndefined();
  });

  it("fails when the resumed run never finishes", async () => {
    const demo = mountDemoPage();
    const assertion = buildInterruptHeadlessAssertion("sales-call")(demo.page);

    await Promise.all([
      expect(assertion).rejects.toThrow(
        /^interrupt-headless-sales-call: post-pick resolution never settled within 30s.*RUN_FINISHED/,
      ),
      vi.advanceTimersByTimeAsync(31_000),
    ]);
  });
});
