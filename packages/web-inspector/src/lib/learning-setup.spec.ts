import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEARNING_SETUP_MAX_AGE_MS,
  LEARNING_SETUP_STORAGE_KEY,
  _test,
  clearLearningSetupMarker,
  learningSetupMarkerMatches,
  normalizeLearningRuntimeUrl,
  readLearningSetupMarker,
  writeLearningSetupMarker,
} from "./learning-setup.js";

beforeEach(() => {
  localStorage.clear();
  _test.resetMemory();
});

describe("Learning setup marker", () => {
  it("normalizes runtime identity and expires after seven days", () => {
    expect(
      normalizeLearningRuntimeUrl(
        "/api/copilotkit/?secret=hidden#fragment",
        "https://example.test/app/",
      ),
    ).toBe("https://example.test/api/copilotkit");

    const startedAt = new Date("2026-03-01T00:00:00.000Z");
    const marker = writeLearningSetupMarker({
      runtimeUrl: "/api/copilotkit/?secret=hidden",
      agentId: "support",
      now: startedAt,
    });
    expect(marker.runtimeUrl).not.toContain("secret");
    expect(
      learningSetupMarkerMatches(marker, "/api/copilotkit", "support"),
    ).toBe(true);
    expect(learningSetupMarkerMatches(marker, "/api/copilotkit", "other")).toBe(
      false,
    );
    expect(
      readLearningSetupMarker(
        startedAt.getTime() + LEARNING_SETUP_MAX_AGE_MS + 1,
      ),
    ).toBeNull();
  });

  it("normalizes an absolute Runtime URL when no browser document exists", () => {
    vi.stubGlobal("document", undefined);
    try {
      expect(
        normalizeLearningRuntimeUrl(
          "https://runtime.example/api/copilotkit/?secret=hidden#fragment",
        ),
      ).toBe("https://runtime.example/api/copilotkit");
      expect(normalizeLearningRuntimeUrl("/api/copilotkit")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retains a page-local marker when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const marker = writeLearningSetupMarker({
      runtimeUrl: "https://runtime.example/api/copilotkit",
      agentId: null,
    });

    expect(readLearningSetupMarker()).toEqual(marker);
    clearLearningSetupMarker();
    expect(readLearningSetupMarker()).toBeNull();
    expect(localStorage.getItem(LEARNING_SETUP_STORAGE_KEY)).toBeNull();
  });

  it.each([
    ["malformed", "not json"],
    [
      "unsupported",
      JSON.stringify({
        version: 2,
        runtimeUrl: "https://runtime.example/api/copilotkit",
        agentId: null,
        startedAt: "2026-09-03T00:00:00.000Z",
      }),
    ],
    [
      "expired",
      JSON.stringify({
        version: 1,
        runtimeUrl: "https://runtime.example/api/copilotkit",
        agentId: null,
        startedAt: "2026-08-01T00:00:00.000Z",
      }),
    ],
  ])("removes a %s persisted record", (_label, raw) => {
    localStorage.setItem(LEARNING_SETUP_STORAGE_KEY, raw);

    expect(
      readLearningSetupMarker(Date.parse("2026-09-03T00:00:00.000Z")),
    ).toBeNull();
    expect(localStorage.getItem(LEARNING_SETUP_STORAGE_KEY)).toBeNull();
  });

  it("removes invalid persistence without discarding a valid page-local fallback", () => {
    const marker = writeLearningSetupMarker({
      runtimeUrl: "https://runtime.example/api/copilotkit",
      agentId: "checkout",
      now: new Date("2026-09-03T00:00:00.000Z"),
    });
    localStorage.setItem(LEARNING_SETUP_STORAGE_KEY, "malformed");

    expect(
      readLearningSetupMarker(Date.parse("2026-09-03T01:00:00.000Z")),
    ).toEqual(marker);
    expect(localStorage.getItem(LEARNING_SETUP_STORAGE_KEY)).toBeNull();
  });
});
