import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WindowRealmController } from "./realm.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("WindowRealmController", () => {
  it("uses the clipboard from an event's foreign realm", () => {
    const frame = document.createElement("iframe");
    frame.title = "Foreign realm fixture";
    document.body.append(frame);
    const foreignWindow = frame.contentWindow;
    if (!foreignWindow) throw new Error("Expected an iframe window");
    const foreignClipboard = { writeText: vi.fn() };
    Object.defineProperty(foreignWindow.navigator, "clipboard", {
      configurable: true,
      value: foreignClipboard,
    });
    const globalClipboard = { writeText: vi.fn() };
    vi.stubGlobal("navigator", { clipboard: globalClipboard });
    const controller = new WindowRealmController({
      renderHost: document.createElement("div"),
      getRenderRoot: () => document,
      getOwnerDocument: () => document,
      renderWindow: () =>
        html`
          <div></div>
        `,
      requestUpdate: () => undefined,
      isConnected: () => true,
      isOpen: () => true,
      isDocked: () => false,
      removeDockStyles: () => undefined,
      applyDockStyles: () => undefined,
      onGlobalPointerDown: () => undefined,
    });

    const event = foreignWindow.document.createEvent("UIEvent");
    event.initUIEvent("click", true, true, foreignWindow, 0);

    expect(controller.getClipboard(event)).toBe(foreignClipboard);
  });
});
