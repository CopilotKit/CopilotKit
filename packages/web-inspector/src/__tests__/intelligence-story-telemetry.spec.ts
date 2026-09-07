import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Type-only, so it survives vitest hoisting the factory above the imports —
// it is erased before the factory ever runs.
import type * as TelemetryModule from "../lib/telemetry.js";

vi.mock("../lib/telemetry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryModule>();
  return { ...actual, trackHomeStoryBeatSelected: vi.fn() };
});

import { WebInspectorElement } from "../index.js";
import { trackHomeStoryBeatSelected } from "../lib/telemetry.js";

/**
 * The story advances on its own every few seconds. Only a press is intent, so
 * only a press is reported — otherwise one idle developer would emit an event
 * per beat forever and bury the handful of real interactions.
 */

const tracked = vi.mocked(trackHomeStoryBeatSelected);

/** Mount an element and expose the private surface these tests drive. */
async function mount(): Promise<any> {
  const inspector = new WebInspectorElement();
  document.body.append(inspector);
  await inspector.updateComplete;
  return inspector;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  tracked.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

test("a pressed rail tab reports the beat by id and position", async () => {
  const inspector = await mount();

  inspector.pinIntelligenceStoryBeat(2);

  expect(tracked).toHaveBeenCalledTimes(1);
  expect(tracked).toHaveBeenCalledWith({ beat: "skill", beat_index: 2 });

  // The id is what survives a label rename, so assert it is the id and not the
  // visible label — "Skills" would pass a laxer check and rot on the next copy
  // edit.
  expect(tracked.mock.calls[0]?.[0].beat).not.toBe("Skills");
});

test("the story advancing on its own reports nothing", async () => {
  const inspector = await mount();
  inspector.isOpen = true;
  inspector.selectedMenu = "home";

  inspector.syncIntelligenceStory();
  // Two steps: 6.5s to leave Threads, 6s to leave Learning. Deliberately not a
  // round 25s — a full loop is 24s, so that would land back on beat 0 and the
  // "it really moved" check below would fail for the wrong reason.
  await vi.advanceTimersByTimeAsync(13_000);

  // It really did move — otherwise this test would pass while silent because
  // nothing happened at all.
  expect(inspector.intelStoryBeat).toBe(2);
  expect(tracked).not.toHaveBeenCalled();
});

test("an opted-out runtime reports nothing at all", async () => {
  const inspector = await mount();
  inspector._core = { telemetryDisabled: true };

  inspector.pinIntelligenceStoryBeat(1);

  expect(tracked).not.toHaveBeenCalled();
});
