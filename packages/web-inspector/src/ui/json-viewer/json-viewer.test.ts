import { afterEach, describe, expect, it, vi } from "vitest";
import { installClipboard } from "../../testing/clipboard.js";
import { InspectorCopyButtonElement } from "../copy-button/copy-button.js";
import {
  defineInspectorJsonViewer,
  InspectorJsonViewerElement,
} from "./json-viewer.js";

defineInspectorJsonViewer();

describe("InspectorJsonViewerElement", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("renders typed strings and structured values through one contract", async () => {
    const viewer = new InspectorJsonViewerElement();
    viewer.value = { text: "{not parsed}", enabled: true };
    document.body.append(viewer);
    await viewer.updateComplete;

    expect(viewer.shadowRoot?.querySelector("pre")?.textContent?.trim()).toBe(
      '{\n  "text": "{not parsed}",\n  "enabled": true\n}',
    );
    expect(viewer.shadowRoot?.querySelector("code")).not.toBeNull();
  });

  it("normalizes circular values and escapes markup", async () => {
    const value: { markup: string; self?: unknown } = {
      markup: "</code><script>unsafe()</script>",
    };
    value.self = value;
    const viewer = new InspectorJsonViewerElement();
    viewer.value = value;
    document.body.append(viewer);
    await viewer.updateComplete;

    expect(viewer.shadowRoot?.textContent).toContain('"[Circular]"');
    expect(viewer.shadowRoot?.textContent).toContain(
      "<script>unsafe()</script>",
    );
    expect(viewer.shadowRoot?.querySelector("script")).toBeNull();
  });

  it("keeps serialized strings as strings and caches object presentations", async () => {
    let reads = 0;
    const value = {
      get serialized() {
        reads += 1;
        return '{"answer":42}';
      },
    };
    const viewer = new InspectorJsonViewerElement();
    viewer.value = value;
    document.body.append(viewer);
    await viewer.updateComplete;

    expect(viewer.shadowRoot?.querySelector("pre")?.textContent).toContain(
      '"{\\"answer\\":42}"',
    );
    viewer.requestUpdate();
    await viewer.updateComplete;
    expect(reads).toBe(1);
  });

  it("copies the exact displayed representation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restoreClipboard = installClipboard({ writeText });
    const viewer = new InspectorJsonViewerElement();
    viewer.value = { answer: 42 };
    viewer.copyable = true;
    document.body.append(viewer);
    await viewer.updateComplete;

    const copyButton = viewer.shadowRoot?.querySelector(
      "cpk-inspector-copy-button",
    );
    expect(copyButton).toBeInstanceOf(InspectorCopyButtonElement);
    copyButton?.shadowRoot?.querySelector("button")?.click();
    await vi.waitFor(() => {
      expect(
        copyButton?.shadowRoot?.querySelector("button")?.textContent,
      ).toContain("Copied");
    });

    expect(writeText).toHaveBeenCalledWith('{\n  "answer": 42\n}');
    restoreClipboard();
  });

  it("supports inline mode, max height, and dark theme tokens", async () => {
    const viewer = new InspectorJsonViewerElement();
    viewer.value = { answer: 42 };
    viewer.mode = "inline";
    viewer.maxHeight = "12rem";
    viewer.setAttribute("data-color-scheme", "dark");
    document.body.append(viewer);
    await viewer.updateComplete;

    expect(viewer.shadowRoot?.querySelector("pre")).toBeNull();
    expect(viewer.shadowRoot?.querySelector("code")).not.toBeNull();
    expect(
      viewer.shadowRoot?.querySelector<HTMLElement>("code")?.style.maxHeight,
    ).toBe("12rem");
    const styles = Array.from(
      viewer.shadowRoot?.querySelectorAll("style") ?? [],
    )
      .map((style) => style.textContent)
      .join("\n");
    expect(styles).toContain(':host([data-color-scheme="dark"])');
    expect(styles).toContain("--cpk-json-key: #bec2ff");
  });
});
