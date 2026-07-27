import { describe, expect, it, vi } from "vitest";

import {
  assertNoAngularPageErrors,
  navigateForRuntimeReadiness,
} from "./angular-browser-canaries.js";

describe("Angular browser canary helpers", () => {
  it("reports the browser error name and message", async () => {
    let listener: ((error: Error) => void) | undefined;
    const page = {
      on: vi.fn((_event: "pageerror", next: (error: Error) => void) => {
        listener = next;
      }),
      off: vi.fn(),
    };

    await expect(
      assertNoAngularPageErrors(page, async () => {
        listener?.(new TypeError("fixture response was invalid"));
      }),
    ).rejects.toThrow(
      "browser page raised 1 uncaught error(s): TypeError: fixture response was invalid",
    );
    expect(page.off).toHaveBeenCalledWith("pageerror", listener);
  });

  it("gives a throttled readiness navigation 30 seconds", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);

    await navigateForRuntimeReadiness(
      { goto },
      "http://127.0.0.1:10000/angular/agentic-chat",
    );

    expect(goto).toHaveBeenCalledWith(
      "http://127.0.0.1:10000/angular/agentic-chat",
      {
        timeout: 30_000,
        waitUntil: "domcontentloaded",
      },
    );
  });
});
