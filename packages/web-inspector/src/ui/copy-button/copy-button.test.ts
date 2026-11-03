import { afterEach, describe, expect, it, vi } from "vitest";
import { installClipboard } from "../../testing/clipboard.js";
import {
  defineInspectorCopyButton,
  InspectorCopyButtonElement,
} from "./copy-button.js";

defineInspectorCopyButton();

describe("InspectorCopyButtonElement", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("uses a native named button and reports clipboard failure", async () => {
    const restoreClipboard = installClipboard(undefined);
    const button = new InspectorCopyButtonElement();
    button.value = "value";
    document.body.append(button);
    await button.updateComplete;

    const control = button.shadowRoot?.querySelector("button");
    expect(control?.getAttribute("type")).toBe("button");
    expect(control?.textContent?.trim()).toBe("Copy");
    control?.click();
    await button.updateComplete;

    expect(
      button.shadowRoot?.querySelector('[role="status"]')?.textContent,
    ).toContain("Copy failed");
    restoreClipboard();
  });

  it("copies through the owning document and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restoreClipboard = installClipboard({ writeText });
    const button = new InspectorCopyButtonElement();
    button.value = "exact value";
    document.body.append(button);
    await button.updateComplete;

    button.shadowRoot?.querySelector("button")?.click();
    await vi.waitFor(() => {
      expect(button.shadowRoot?.querySelector("button")?.textContent).toContain(
        "Copied",
      );
    });

    expect(writeText).toHaveBeenCalledWith("exact value");
    restoreClipboard();
  });

  it("keeps the visible success label in an explicit accessible name", async () => {
    const restoreClipboard = installClipboard({
      writeText: vi.fn().mockResolvedValue(undefined),
    });
    const button = new InspectorCopyButtonElement();
    button.value = "value";
    button.accessibleLabel = "Copy code";
    document.body.append(button);
    await button.updateComplete;

    button.shadowRoot?.querySelector("button")?.click();
    await vi.waitFor(() => {
      const accessibleName =
        button.shadowRoot
          ?.querySelector("button")
          ?.getAttribute("aria-label") ?? "";
      expect(accessibleName).toContain("Copied");
      expect(accessibleName).toContain("Copy code");
    });
    restoreClipboard();
  });

  it("reports denied clipboard access and prefers an explicit writer", async () => {
    const denied = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const pageWrite = vi.fn().mockResolvedValue(undefined);
    const restoreClipboard = installClipboard({ writeText: denied });
    const button = new InspectorCopyButtonElement();
    button.value = "value";
    document.body.append(button);
    await button.updateComplete;

    button.shadowRoot?.querySelector("button")?.click();
    await vi.waitFor(() =>
      expect(
        button.shadowRoot?.querySelector('[role="status"]')?.textContent,
      ).toContain("Copy failed"),
    );

    button.clipboard = { writeText: pageWrite };
    button.shadowRoot?.querySelector("button")?.click();
    await vi.waitFor(() => expect(pageWrite).toHaveBeenCalledWith("value"));
    expect(denied).toHaveBeenCalledTimes(1);
    restoreClipboard();
  });

  it("clears stale copied timers when disconnected", async () => {
    vi.useFakeTimers();
    const restoreClipboard = installClipboard({
      writeText: vi.fn().mockResolvedValue(undefined),
    });
    const button = new InspectorCopyButtonElement();
    button.value = "value";
    document.body.append(button);
    await button.updateComplete;

    button.shadowRoot?.querySelector("button")?.click();
    await Promise.resolve();
    await Promise.resolve();
    await button.updateComplete;
    expect(button.shadowRoot?.querySelector("button")?.textContent).toContain(
      "Copied",
    );

    button.remove();
    vi.runAllTimers();
    document.body.append(button);
    await button.updateComplete;

    expect(
      button.shadowRoot?.querySelector("button")?.textContent?.trim(),
    ).toBe("Copy");
    restoreClipboard();
  });
});
