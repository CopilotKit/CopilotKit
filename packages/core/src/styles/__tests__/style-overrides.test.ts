// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stylesheet } from "../stylesheet";
import {
  ɵdetectStyleOverrides,
  ɵwarnIfStylesOverridden,
} from "../style-overrides";

const PROBE_SELECTOR = "[data-copilotkit-style-probe]";

/**
 * The computed style the browser would give the probe. jsdom has no cascade
 * layers, so the test stands in for the browser's style engine.
 */
interface ProbeStyle {
  padding: string;
  margin: string;
  /** `false` when the stylesheet is not in the page. */
  loaded?: boolean;
}

function computedStyle({ padding, margin, loaded = true }: ProbeStyle) {
  const style = document.createElement("div").style;
  style.setProperty("padding", padding);
  style.setProperty("margin", margin);
  if (loaded) style.setProperty("--cpk-style-probe", "1");
  return style;
}

/** A document with its own window, as an iframe has. */
function createTestDocument() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  return frame.contentDocument!;
}

/** Makes the test document's window report `probeStyle` for the probe. */
function stubProbeStyle(probeStyle: ProbeStyle) {
  const view = testDocument.defaultView!;
  const realGetComputedStyle = view.getComputedStyle.bind(view);
  vi.spyOn(view, "getComputedStyle").mockImplementation((element) =>
    element.matches(PROBE_SELECTOR)
      ? computedStyle(probeStyle)
      : realGetComputedStyle(element),
  );
}

// A fresh document per test, so the once-per-document guard starts clear.
let testDocument: Document;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  testDocument = createTestDocument();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("the probe rule in the stylesheet", () => {
  it("sets the values the check expects", () => {
    expect(stylesheet).toContain(
      ":where([data-copilotkit-style-probe]){padding:1px;margin:1px;--cpk-style-probe: 1}",
    );
  });
});

describe("ɵdetectStyleOverrides", () => {
  it("reports padding and margin when an outside rule sets both", () => {
    stubProbeStyle({ padding: "0px", margin: "0px" });

    expect(ɵdetectStyleOverrides(testDocument)).toEqual(["padding", "margin"]);
  });

  it("reports nothing when the stylesheet's values hold", () => {
    stubProbeStyle({ padding: "1px", margin: "1px" });

    expect(ɵdetectStyleOverrides(testDocument)).toEqual([]);
  });

  it("reports only padding when only padding is overridden", () => {
    stubProbeStyle({ padding: "0px", margin: "1px" });

    expect(ɵdetectStyleOverrides(testDocument)).toEqual(["padding"]);
  });

  it("reports only margin when only margin is overridden", () => {
    stubProbeStyle({ padding: "1px", margin: "0px" });

    expect(ɵdetectStyleOverrides(testDocument)).toEqual(["margin"]);
  });

  it("reports one side that an outside rule changed", () => {
    stubProbeStyle({ padding: "1px 1px 1px 0px", margin: "1px" });

    expect(ɵdetectStyleOverrides(testDocument)).toEqual(["padding"]);
  });

  it("returns null when the stylesheet is not in the page", () => {
    stubProbeStyle({ padding: "0px", margin: "0px", loaded: false });

    expect(ɵdetectStyleOverrides(testDocument)).toBeNull();
  });

  it("removes the probe from the page", () => {
    stubProbeStyle({ padding: "0px", margin: "0px" });

    ɵdetectStyleOverrides(testDocument);

    expect(testDocument.querySelector(PROBE_SELECTOR)).toBeNull();
  });
});

describe("ɵwarnIfStylesOverridden", () => {
  it("names the cause, the fix, and the guide", () => {
    stubProbeStyle({ padding: "0px", margin: "0px" });

    ɵwarnIfStylesOverridden(testDocument);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toBe(
      "[CopilotKit] A global CSS rule outside a cascade layer, such as " +
        "`* { padding: 0; margin: 0 }`, overrides the padding and margin of " +
        "CopilotKit's UI. CopilotKit's styles are in cascade layers, and any " +
        "rule outside a layer wins over them. Move the rule into a layer: " +
        "`@layer base { * { padding: 0; margin: 0 } }`. See " +
        "https://docs.copilotkit.ai/migrate/v2#if-the-chat-has-no-padding-move-your-css-reset-into-a-layer",
    );
  });

  it("warns once per document, however many chats check", () => {
    stubProbeStyle({ padding: "0px", margin: "0px" });

    ɵwarnIfStylesOverridden(testDocument);
    ɵwarnIfStylesOverridden(testDocument);

    expect(warn).toHaveBeenCalledOnce();
  });

  it("names only the property that is overridden", () => {
    stubProbeStyle({ padding: "1px", margin: "0px" });

    ɵwarnIfStylesOverridden(testDocument);

    expect(warn.mock.calls[0]![0]).toContain("overrides the margin of");
  });

  it("does not warn when nothing is overridden", () => {
    stubProbeStyle({ padding: "1px", margin: "1px" });

    ɵwarnIfStylesOverridden(testDocument);

    expect(warn).not.toHaveBeenCalled();
  });

  it("checks again when the stylesheet was not in the page yet", () => {
    stubProbeStyle({ padding: "0px", margin: "0px", loaded: false });
    ɵwarnIfStylesOverridden(testDocument);
    expect(warn).not.toHaveBeenCalled();

    stubProbeStyle({ padding: "0px", margin: "0px" });
    ɵwarnIfStylesOverridden(testDocument);

    expect(warn).toHaveBeenCalledOnce();
  });
});
