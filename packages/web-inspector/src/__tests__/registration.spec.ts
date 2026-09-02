import { CopilotKitCore } from "@copilotkit/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CpkMemoryList } from "../domains/learning/memory-list.js";
import {
  CpkThreadInspector,
  ɵCpkThreadDetails,
} from "../domains/threads/detail/thread-inspector.js";
import { CpkThreadList } from "../domains/threads/list/thread-list.js";
import {
  configureWebInspectorElement,
  defineWebInspector,
} from "../register.js";
import { WebInspectorElement } from "../shell/web-inspector-element.js";
import { createSameOriginFrame } from "../testing/same-origin-frame.js";
import {
  INSPECTOR_COPY_BUTTON_TAG,
  InspectorCopyButtonElement,
} from "../ui/copy-button/copy-button.js";
import {
  INSPECTOR_JSON_VIEWER_TAG,
  InspectorJsonViewerElement,
} from "../ui/json-viewer/json-viewer.js";

const frames: Array<ReturnType<typeof createSameOriginFrame>> = [];

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

describe("defineWebInspector", () => {
  it("configures a host core before the element connects", () => {
    defineWebInspector();
    const inspector = new WebInspectorElement();
    const core = new CopilotKitCore({
      runtimeUrl: "http://localhost:4000/api/copilotkit",
      deferInitialConnection: true,
    });

    try {
      expect(configureWebInspectorElement(inspector, core)).toBe(inspector);
      expect(inspector.autoAttachCore).toBe(false);
      expect(inspector.core).toBe(core);
    } finally {
      core.setRuntimeUrl(undefined);
    }
  });

  it("registers every inspector element in an isolated registry", () => {
    const frame = createSameOriginFrame();
    frames.push(frame);
    const define = vi.spyOn(frame.window.customElements, "define");

    defineWebInspector(frame.window.customElements);

    expect(define.mock.calls.map(([tag]) => tag)).toEqual([
      "cpk-inspector-copy-button",
      "cpk-inspector-json-viewer",
      "cpk-thread-list",
      "cpk-thread-inspector",
      "cpk-thread-details",
      "cpk-memory-list",
      "cpk-web-inspector",
    ]);

    expect(frame.window.customElements.get(INSPECTOR_COPY_BUTTON_TAG)).toBe(
      InspectorCopyButtonElement,
    );
    expect(frame.window.customElements.get(INSPECTOR_JSON_VIEWER_TAG)).toBe(
      InspectorJsonViewerElement,
    );
    expect(frame.window.customElements.get("cpk-thread-list")).toBe(
      CpkThreadList,
    );
    expect(frame.window.customElements.get("cpk-thread-inspector")).toBe(
      CpkThreadInspector,
    );
    expect(frame.window.customElements.get("cpk-thread-details")).toBe(
      ɵCpkThreadDetails,
    );
    expect(frame.window.customElements.get("cpk-memory-list")).toBe(
      CpkMemoryList,
    );
    expect(frame.window.customElements.get("cpk-web-inspector")).toBe(
      WebInspectorElement,
    );
  });

  it("is idempotent for repeated registration", () => {
    const frame = createSameOriginFrame();
    frames.push(frame);
    const define = vi.spyOn(frame.window.customElements, "define");

    expect(() => {
      defineWebInspector(frame.window.customElements);
      defineWebInspector(frame.window.customElements);
    }).not.toThrow();
    expect(define).toHaveBeenCalledTimes(7);
  });

  it("does nothing when no registry is available during SSR", () => {
    expect(() => defineWebInspector(undefined)).not.toThrow();
  });
});
