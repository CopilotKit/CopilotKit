import { describe, expect, it, vi } from "vitest";

import {
  INSPECTOR_POP_OUT_NAME,
  POP_OUT_BLOCKED_MESSAGE,
  applyInspectorOwnedStyles,
  buildPopOutFeatures,
  copyStyleSheets,
  ensureBrandFont,
  openPopOutWindow,
} from "../pop-out.js";

const BRAND_FONT_LINK_ID = "cpk-inspector-brand-fonts";
const BRAND_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600&family=Spline+Sans+Mono:wght@600&display=swap";

type PopOutWindowStub = {
  document: Document;
  close: ReturnType<typeof vi.fn<() => void>>;
  addEventListener: ReturnType<
    typeof vi.fn<
      (type: string, listener: EventListenerOrEventListenerObject) => void
    >
  >;
  removeEventListener: ReturnType<
    typeof vi.fn<
      (type: string, listener: EventListenerOrEventListenerObject) => void
    >
  >;
  emit: (type: string) => void;
};

/**
 * jsdom cannot open a real popup Window. Stub only the surface that
 * openPopOutWindow touches (document, close, pagehide listeners).
 */
function createPopOutWindowStub(): PopOutWindowStub {
  const popDoc = document.implementation.createHTMLDocument("pop-out");
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  return {
    document: popDoc,
    close: vi.fn(),
    addEventListener: vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(listener);
      },
    ),
    removeEventListener: vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.get(type)?.delete(listener);
      },
    ),
    emit(type: string) {
      const set = listeners.get(type);
      if (!set) return;
      for (const listener of set) {
        if (typeof listener === "function") {
          listener(new Event(type));
        } else {
          listener.handleEvent(new Event(type));
        }
      }
    },
  };
}

/** Narrow stub → Window for the injected `open` callback only. */
function asWindow(stub: PopOutWindowStub): Window {
  return stub as unknown as Window;
}

type StyleSheetStub = {
  readonly cssRules: CSSRuleList;
  readonly href: string | null;
  readonly ownerNode: Node | null;
};

/**
 * StyleSheetList cannot be constructed in jsdom. Install an array that
 * Array.from accepts so copyStyleSheets can be tested without browser CSSOM.
 */
function installStyleSheets(
  doc: Document,
  sheets: readonly StyleSheetStub[],
): void {
  Object.defineProperty(doc, "styleSheets", {
    configurable: true,
    get: () => sheets as unknown as StyleSheetList,
  });
}

function readableStyleSheet(args: {
  cssText: string;
  id?: string;
  doc: Document;
}): StyleSheetStub {
  const owner = args.doc.createElement("style");
  if (args.id) owner.id = args.id;
  return {
    get cssRules(): CSSRuleList {
      return [{ cssText: args.cssText }] as unknown as CSSRuleList;
    },
    href: null,
    ownerNode: owner,
  };
}

function throwingStyleSheet(args: {
  href: string | null;
  ownerNode?: Node | null;
}): StyleSheetStub {
  return {
    get cssRules(): CSSRuleList {
      throw new DOMException(
        "Failed to read the 'cssRules' property",
        "SecurityError",
      );
    },
    href: args.href,
    ownerNode: args.ownerNode ?? null,
  };
}

function openArgs(overrides: {
  open: typeof window.open;
  onClose?: () => void;
  cssTexts?: readonly string[];
  sourceDocument?: Document;
  features?: string;
  title?: string;
}) {
  return {
    open: overrides.open,
    features: overrides.features ?? "width=400,height=600,popup",
    title: overrides.title ?? "CopilotKit Inspector",
    cssTexts: overrides.cssTexts ?? [],
    sourceDocument:
      overrides.sourceDocument ??
      document.implementation.createHTMLDocument("source"),
    onClose: overrides.onClose ?? vi.fn(),
  };
}

describe("buildPopOutFeatures", () => {
  it("uses the current Inspector size and the popup flag", () => {
    expect(buildPopOutFeatures({ width: 420.8, height: 640.2 })).toBe(
      "width=421,height=640,popup",
    );
  });
});

describe("openPopOutWindow", () => {
  it("opens a blank named popup and prepares the document", () => {
    const stub = createPopOutWindowStub();
    const leftoverHead = stub.document.createElement("meta");
    leftoverHead.setAttribute("name", "leftover-head");
    stub.document.head.appendChild(leftoverHead);
    const leftoverBody = stub.document.createElement("div");
    leftoverBody.id = "leftover-body";
    stub.document.body.appendChild(leftoverBody);

    const sourceDocument = document.implementation.createHTMLDocument("source");
    installStyleSheets(sourceDocument, [
      readableStyleSheet({
        doc: sourceDocument,
        id: "app-styles",
        cssText: ".foo{color:red}",
      }),
    ]);

    const open = vi.fn<typeof window.open>(() => asWindow(stub));
    const cssText = ".inspector-window{display:flex}";

    const handle = openPopOutWindow(
      openArgs({
        open,
        cssTexts: [cssText],
        sourceDocument,
      }),
    );

    expect(open).toHaveBeenCalledWith(
      "",
      INSPECTOR_POP_OUT_NAME,
      "width=400,height=600,popup",
    );
    expect(handle.win).toBe(asWindow(stub));
    expect(handle.win.document.title).toBe("CopilotKit Inspector");
    // jsdom normalizes CSS margin "0" to "0px" when read back.
    expect(handle.win.document.body.style.margin).toBe("0px");

    expect(
      handle.win.document.head.querySelector('meta[name="leftover-head"]'),
    ).toBeNull();
    expect(handle.win.document.body.querySelector("#leftover-body")).toBeNull();

    const owned = handle.win.document.head.querySelector(
      "style[data-cpk-inspector-pop-out]",
    );
    expect(owned?.textContent).toBe(cssText);

    const copied = handle.win.document.head.querySelector("style#app-styles");
    expect(copied?.textContent).toBe(".foo{color:red}");

    const font = handle.win.document.getElementById(BRAND_FONT_LINK_ID);
    expect(font?.getAttribute("rel")).toBe("stylesheet");
    expect(font?.getAttribute("href")).toBe(BRAND_FONT_HREF);
  });

  it("throws when the browser blocks the popup", () => {
    expect(() =>
      openPopOutWindow(
        openArgs({
          open: () => null,
        }),
      ),
    ).toThrow(POP_OUT_BLOCKED_MESSAGE);
  });

  it("notifies on pagehide", () => {
    const stub = createPopOutWindowStub();
    const onClose = vi.fn();

    openPopOutWindow(
      openArgs({
        open: () => asWindow(stub),
        onClose,
      }),
    );

    stub.emit("pagehide");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close removes the pagehide listener and closes the window", () => {
    const stub = createPopOutWindowStub();
    const onClose = vi.fn();

    const handle = openPopOutWindow(
      openArgs({
        open: () => asWindow(stub),
        onClose,
      }),
    );

    handle.close();
    expect(stub.close).toHaveBeenCalledTimes(1);
    expect(stub.removeEventListener).toHaveBeenCalledWith(
      "pagehide",
      expect.any(Function),
    );

    stub.emit("pagehide");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("applyInspectorOwnedStyles", () => {
  it("appends one style tag per css text", () => {
    const doc = document.implementation.createHTMLDocument("to");

    applyInspectorOwnedStyles(doc, ["body{margin:0}", ".x{color:red}"]);

    const styles = doc.head.querySelectorAll(
      "style[data-cpk-inspector-pop-out]",
    );
    expect(styles).toHaveLength(2);
    expect(styles[0]?.textContent).toBe("body{margin:0}");
    expect(styles[1]?.textContent).toBe(".x{color:red}");
  });
});

describe("copyStyleSheets", () => {
  it("appends a style when cssRules is readable", () => {
    const fromDoc = document.implementation.createHTMLDocument("from");
    const toDoc = document.implementation.createHTMLDocument("to");
    installStyleSheets(fromDoc, [
      readableStyleSheet({
        doc: fromDoc,
        id: "app-styles",
        cssText: ".foo{color:red}",
      }),
    ]);

    copyStyleSheets(fromDoc, toDoc);

    const copied = toDoc.head.querySelector("style#app-styles");
    expect(copied).not.toBeNull();
    expect(copied?.textContent).toBe(".foo{color:red}");
  });

  it("falls back to a link when cssRules throw and href exists", () => {
    const fromDoc = document.implementation.createHTMLDocument("from");
    const toDoc = document.implementation.createHTMLDocument("to");
    installStyleSheets(fromDoc, [
      throwingStyleSheet({ href: "https://cdn.example/app.css" }),
    ]);

    copyStyleSheets(fromDoc, toDoc);

    const link = toDoc.head.querySelector('link[rel="stylesheet"]');
    expect(link?.getAttribute("href")).toBe("https://cdn.example/app.css");
  });

  it("skips a sheet when cssRules throw and href is missing", () => {
    const fromDoc = document.implementation.createHTMLDocument("from");
    const toDoc = document.implementation.createHTMLDocument("to");
    installStyleSheets(fromDoc, [throwingStyleSheet({ href: null })]);

    copyStyleSheets(fromDoc, toDoc);

    expect(toDoc.head.querySelectorAll("style, link")).toHaveLength(0);
  });
});

describe("ensureBrandFont", () => {
  it("inserts the Inspector brand font link once", () => {
    const doc = document.implementation.createHTMLDocument("fonts");

    ensureBrandFont(doc);
    ensureBrandFont(doc);

    const links = doc.head.querySelectorAll(`#${BRAND_FONT_LINK_ID}`);
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("rel")).toBe("stylesheet");
    expect(links[0]?.getAttribute("href")).toBe(BRAND_FONT_HREF);
  });
});
