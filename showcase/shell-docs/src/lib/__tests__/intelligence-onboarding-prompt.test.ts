import { afterEach, expect, it, vi } from "vitest";
import { createOnboardingRunId } from "@/lib/intelligence-onboarding-prompt";

/**
 * The shape `copilotkit onboard start --run <id>` validates. The CLI rejects
 * anything outside it, and it rejects silently as far as the docs reader is
 * concerned: the copy looks fine, the run never lands, the funnel loses the
 * row. Every one of the three code paths below has to produce it.
 */
const RUN_ID_SHAPE = /^[A-Za-z0-9_-]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("derives the run id from crypto.randomUUID where it exists", () => {
  // The path every current browser and jsdom takes.
  const randomUUID = vi.fn(() => "0123abcd-4567-89ef-0123-456789abcdef");
  vi.stubGlobal("crypto", { randomUUID });

  const runId = createOnboardingRunId();

  expect(randomUUID).toHaveBeenCalled();
  expect(runId).toMatch(RUN_ID_SHAPE);
  // The dashes are stripped, not counted: a naive `slice(0, 12)` on the raw
  // UUID would keep two of them and the CLI would reject the id.
  expect(runId).toBe("0123abcd4567");
});

it("falls back to crypto.getRandomValues when randomUUID is withheld", () => {
  // Older Safari, and any non-secure context: web crypto is present but
  // `randomUUID` is not.
  const getRandomValues = vi.fn((array: Uint8Array) => {
    for (let i = 0; i < array.length; i += 1) array[i] = (i * 37) % 256;
    return array;
  });
  vi.stubGlobal("crypto", { getRandomValues });

  const runId = createOnboardingRunId();

  expect(getRandomValues).toHaveBeenCalled();
  expect(runId).toMatch(RUN_ID_SHAPE);
  // Six bytes rendered as two hex digits each. Asserting the exact string
  // catches a byte losing its leading zero, which would shorten the id below
  // the twelve characters the CLI requires.
  expect(runId).toBe("00254a6f94b9");
});

it("falls back to Math.random when there is no web crypto at all", () => {
  // The last resort. It must still produce a well-formed id rather than
  // throwing, because a thrown error here would take the whole copy with it.
  vi.stubGlobal("crypto", undefined);
  vi.spyOn(Math, "random").mockReturnValue(0.5);

  const runId = createOnboardingRunId();

  expect(runId).toMatch(RUN_ID_SHAPE);
  expect(runId).toBe("888888888888");
});

it("mints a distinct id on each call", () => {
  // Two mounts on one page are two onboarding attempts and must not collide
  // onto a single funnel row.
  const ids = new Set(
    Array.from({ length: 50 }, () => createOnboardingRunId()),
  );

  expect(ids.size).toBe(50);
  for (const id of ids) expect(id).toMatch(RUN_ID_SHAPE);
});
