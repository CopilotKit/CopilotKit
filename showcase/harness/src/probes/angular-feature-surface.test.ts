import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

import {
  assertMobilePopupFillsViewport,
  assertRunnableAngularFeatureSurface,
} from "./angular-feature-surface";

describe("Angular feature surface", () => {
  it("waits for the lazy feature route before reading its final state", async () => {
    const events: string[] = [];
    const page = {
      waitForFunction: vi.fn(async () => {
        events.push("wait");
      }),
      evaluate: vi.fn(async () => {
        events.push("evaluate");
        return {
          expectedCellPresent: true,
          unavailable: false,
          textareaPresent: true,
          textareaVisible: true,
        };
      }),
    };

    await assertRunnableAngularFeatureSurface(
      page as unknown as Pick<Page, "evaluate" | "waitForFunction">,
      "angular/langgraph-python/agentic-chat",
    );

    expect(events).toEqual(["wait", "evaluate"]);
  });

  it("reports the final surface state when the bounded wait expires", async () => {
    const page = {
      waitForFunction: vi.fn(async () => {
        throw new Error("timeout");
      }),
      evaluate: vi.fn(async () => ({
        expectedCellPresent: false,
        unavailable: false,
        textareaPresent: false,
        textareaVisible: false,
      })),
    };

    await expect(
      assertRunnableAngularFeatureSurface(
        page as unknown as Pick<Page, "evaluate" | "waitForFunction">,
        "angular/langgraph-python/agentic-chat",
      ),
    ).rejects.toThrow(
      "Angular feature surface mismatch: cell=false; unavailable=false; textarea=false; visible=false",
    );
  });

  it("waits for the popup entrance animation before measuring its box", async () => {
    const events: string[] = [];
    const dialog = {
      waitFor: vi.fn(async () => {
        events.push("dialog");
      }),
      boundingBox: vi.fn(async () => {
        events.push("box");
        return { x: 0, y: 0, width: 390, height: 844 };
      }),
    };
    const page = {
      getByRole: vi.fn(() => dialog),
      waitForFunction: vi.fn(async () => {
        events.push("viewport");
      }),
    };

    await assertMobilePopupFillsViewport(
      page as unknown as Pick<Page, "getByRole" | "waitForFunction">,
      { width: 390, height: 844 },
    );

    expect(events).toEqual(["dialog", "viewport", "box"]);
  });

  it("reports the final popup box when it never fills the viewport", async () => {
    const dialog = {
      waitFor: vi.fn(async () => undefined),
      boundingBox: vi.fn(async () => ({
        x: 4,
        y: 4,
        width: 382,
        height: 836,
      })),
    };
    const page = {
      getByRole: vi.fn(() => dialog),
      waitForFunction: vi.fn(async () => {
        throw new Error("timeout");
      }),
    };

    await expect(
      assertMobilePopupFillsViewport(
        page as unknown as Pick<Page, "getByRole" | "waitForFunction">,
        { width: 390, height: 844 },
      ),
    ).rejects.toThrow(
      "mobile popup does not fill the viewport: width=382; height=836",
    );
  });
});
