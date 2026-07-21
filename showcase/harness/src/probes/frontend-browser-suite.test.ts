import { describe, expect, it } from "vitest";

import {
  ACCESSIBILITY_TAGS,
  FRONTEND_BROWSER_PROJECTS,
  FRONTEND_BROWSER_STATES,
  browserProjectById,
  createFrontendBrowserArtifact,
} from "./frontend-browser-suite.js";

describe("Angular reusable UI browser suite contract", () => {
  it("enumerates three desktop engines and two honest emulation projects", () => {
    expect(FRONTEND_BROWSER_PROJECTS).toEqual([
      expect.objectContaining({ id: "chromium-desktop", engine: "chromium" }),
      expect.objectContaining({ id: "firefox-desktop", engine: "firefox" }),
      expect.objectContaining({ id: "webkit-desktop", engine: "webkit" }),
      expect.objectContaining({
        id: "chromium-mobile-emulation",
        engine: "chromium",
        device: "Pixel 7",
      }),
      expect.objectContaining({
        id: "webkit-mobile-emulation",
        engine: "webkit",
        device: "iPhone 13",
      }),
    ]);
    expect(() => browserProjectById("safari")).toThrow(
      /unknown browser project/i,
    );
  });

  it("scans explicitly named rendered states against WCAG A and AA tags", () => {
    expect(FRONTEND_BROWSER_STATES.map((state) => state.id)).toEqual([
      "chat-ready",
      "popup-open",
      "popup-closed-focus-restored",
      "sidebar-open",
    ]);
    expect(ACCESSIBILITY_TAGS).toEqual([
      "wcag2a",
      "wcag2aa",
      "wcag21aa",
      "wcag22aa",
    ]);
  });

  it("emits privacy-safe rule summaries without DOM or content payloads", () => {
    const artifact = createFrontendBrowserArtifact({
      commitSha: "abc123",
      project: FRONTEND_BROWSER_PROJECTS[0]!,
      startedAt: "2026-07-21T00:00:00.000Z",
      finishedAt: "2026-07-21T00:00:01.000Z",
      results: [
        {
          stateId: "popup-open",
          status: "failed",
          durationMs: 10,
          violations: [
            { id: "aria-dialog-name", impact: "serious", nodeCount: 1 },
          ],
          assertions: {
            keyboard: "passed",
            focus: "passed",
            responsive: "passed",
            securityHeaders: "passed",
          },
        },
      ],
    });

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.project.id).toBe("chromium-desktop");
    expect(artifact.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(JSON.stringify(artifact)).not.toMatch(/html|target|message|prompt/i);
  });
});
