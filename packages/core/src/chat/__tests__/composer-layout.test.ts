// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ɵcreateComposerAutosize,
  ɵfitTextareaHeight,
  ɵmeasureTextarea,
} from "../composer-layout";

/** jsdom has no layout, so each element gets the sizes a browser would report. */
const LINE_HEIGHT = 20;
const PADDING = 4;
const CHAR_WIDTH = 10;

function createTextarea() {
  const textarea = document.createElement("textarea");
  textarea.style.padding = `${PADDING}px`;
  textarea.style.font = "16px Arial";
  // One row per line, plus one row per 30 characters of a wrapping line.
  Object.defineProperty(textarea, "scrollHeight", {
    get: () => {
      const lines = textarea.value.split("\n");
      const rows = lines.reduce(
        (total, line) => total + Math.max(1, Math.ceil(line.length / 30)),
        0,
      );
      return rows * LINE_HEIGHT + parseFloat(textarea.style.paddingTop) * 2;
    },
    configurable: true,
  });
  document.body.append(textarea);
  return textarea;
}

function createBox(width: number) {
  const element = document.createElement("div");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width, height: 0 }),
  );
  document.body.append(element);
  return element;
}

function createGrid(clientWidth: number) {
  const grid = createBox(clientWidth);
  let width = clientWidth;
  Object.defineProperty(grid, "clientWidth", { get: () => width });
  return {
    grid,
    resize: (next: number) => {
      width = next;
    },
  };
}

function setup(options: { gridWidth?: number; maxRows?: number } = {}) {
  const textarea = createTextarea();
  const { grid, resize } = createGrid(options.gridWidth ?? 400);
  const start = createBox(40);
  const actions = createBox(60);
  const autosize = ɵcreateComposerAutosize({
    getElements: () => ({ textarea, grid, start, actions }),
    maxRows: options.maxRows,
  });
  return { textarea, grid, start, actions, autosize, resize };
}

let observerCallbacks: ResizeObserverCallback[] = [];
let frames: FrameRequestCallback[] = [];
let isMobile = false;

class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    if (!observerCallbacks.includes(this.callback)) {
      observerCallbacks.push(this.callback);
    }
  }
  unobserve() {}
  disconnect() {
    observerCallbacks = observerCallbacks.filter((c) => c !== this.callback);
  }
}

function fireResize(target: Element) {
  const entry = { target } as ResizeObserverEntry; // Only `target` is read; the full entry type has DOM-only fields.
  const observer = new FakeResizeObserver(() => {});
  for (const callback of [...observerCallbacks]) callback([entry], observer);
}

function runFrames() {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(0);
}

beforeEach(() => {
  observerCallbacks = [];
  frames = [];
  isMobile = false;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 767px)" && isMobile,
  }));
  // The canvas measures CHAR_WIDTH pixels per character.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text: string) => ({ width: text.length * CHAR_WIDTH }),
  } as unknown as CanvasRenderingContext2D); // A partial 2D context: the controller reads only `font` and `measureText`.
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ɵmeasureTextarea", () => {
  it("measures one row and caps max-height at maxRows rows", () => {
    const textarea = createTextarea();
    textarea.value = "first\nsecond";

    const metrics = ɵmeasureTextarea(textarea, 3);

    expect(metrics).toEqual({
      singleLineHeight: 28,
      maxHeight: 68,
      paddingLeft: 4,
      paddingRight: 4,
    });
    expect(textarea.style.maxHeight).toBe("68px");
    expect(textarea.value).toBe("first\nsecond");
  });

  it("treats padding the browser does not report as 0", () => {
    const textarea = createTextarea();
    textarea.style.padding = "";
    Object.defineProperty(textarea, "scrollHeight", { get: () => LINE_HEIGHT });

    expect(ɵmeasureTextarea(textarea, 5)).toEqual({
      singleLineHeight: 20,
      maxHeight: 100,
      paddingLeft: 0,
      paddingRight: 0,
    });
  });

  it("keeps the selection of a focused text box", () => {
    const textarea = createTextarea();
    textarea.value = "hello world";
    textarea.focus();
    textarea.setSelectionRange(2, 5);

    ɵmeasureTextarea(textarea, 5);

    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 5]);
  });
});

describe("ɵfitTextareaHeight", () => {
  it("grows with the text up to maxHeight", () => {
    const textarea = createTextarea();
    textarea.value = "1\n2\n3\n4";

    expect(ɵfitTextareaHeight(textarea, 60)).toBe(88);
    expect(textarea.style.height).toBe("60px");
  });

  it("has no limit when maxHeight is 0", () => {
    const textarea = createTextarea();
    textarea.value = "1\n2";

    ɵfitTextareaHeight(textarea, 0);

    expect(textarea.style.height).toBe("48px");
  });
});

describe("ɵcreateComposerAutosize", () => {
  it("stays compact for short text", () => {
    const { autosize } = setup();
    expect(autosize.evaluate("hi", "input")).toBe("compact");
  });

  it("expands for a line break and tells subscribers once", () => {
    const { autosize } = setup();
    const listener = vi.fn();
    autosize.subscribe(listener);

    expect(autosize.evaluate("one\ntwo", "input")).toBe("expanded");
    autosize.evaluate("one\ntwo", "input");

    expect(autosize.getSnapshot()).toBe("expanded");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("expands when the text wraps, and caps the height at five rows by default", () => {
    const { autosize, textarea } = setup();
    textarea.value = "x".repeat(200);

    expect(autosize.evaluate(textarea.value, "input")).toBe("expanded");
    expect(textarea.style.height).toBe(`${5 * LINE_HEIGHT + PADDING * 2}px`);
  });

  it("caps the height at maxRows rows", () => {
    const { autosize, textarea } = setup({ maxRows: 2 });
    textarea.value = "1\n2\n3\n4";

    autosize.evaluate(textarea.value, "input");

    expect(textarea.style.height).toBe(`${2 * LINE_HEIGHT + PADDING * 2}px`);
  });

  it("re-measures when maxRows changes", () => {
    const { autosize, textarea } = setup();
    textarea.value = "1\n2\n3\n4";
    autosize.evaluate(textarea.value, "input");

    autosize.setMaxRows(3);

    expect(textarea.style.height).toBe(`${3 * LINE_HEIGHT + PADDING * 2}px`);
  });

  it("expands when one line is wider than the compact row", () => {
    // Compact row: 400 - 40 - 60 = 300px, minus 8px padding = 292px of text.
    const { autosize } = setup();
    expect(autosize.evaluate("x".repeat(29), "input")).toBe("compact");
    expect(autosize.evaluate("x".repeat(30), "input")).toBe("expanded");
  });

  it("is always compact outside input mode", () => {
    const { autosize } = setup();
    autosize.evaluate("one\ntwo", "input");
    expect(autosize.evaluate("one\ntwo", "transcribe")).toBe("compact");
  });

  it("expands on a phone viewport and still fits the height", () => {
    isMobile = true;
    const { autosize, textarea } = setup();
    textarea.value = "1\n2";

    expect(autosize.evaluate(textarea.value, "input")).toBe("expanded");
    expect(textarea.style.height).toBe("48px");
  });

  it("keeps the layout but grows the text box in a custom layout", () => {
    const textarea = createTextarea();
    textarea.value = "1\n2";
    const autosize = ɵcreateComposerAutosize({
      getElements: () => ({
        textarea,
        grid: null,
        start: null,
        actions: null,
      }),
    });

    expect(autosize.evaluate(textarea.value, "input")).toBe("compact");
    expect(textarea.style.height).toBe("48px");
  });

  it("measures only after IME composition ends", () => {
    const { autosize, textarea } = setup();
    autosize.evaluate("", "input");
    textarea.dispatchEvent(new Event("compositionstart"));
    textarea.style.maxHeight = "";

    autosize.setMaxRows(2);
    expect(textarea.style.maxHeight).toBe("");

    textarea.dispatchEvent(new Event("compositionend"));
    autosize.setMaxRows(3);
    expect(textarea.style.maxHeight).toBe("68px");
  });

  it("evaluates again in the next frame when the container resizes", () => {
    const { autosize, grid, resize } = setup();
    const text = "x".repeat(25); // 250px: fits 292px, not 192px.
    expect(autosize.evaluate(text, "input")).toBe("compact");

    resize(300);
    fireResize(grid);
    expect(autosize.getSnapshot()).toBe("compact");
    runFrames();

    expect(autosize.getSnapshot()).toBe("expanded");
  });

  it("measures the text box again after the container resizes", () => {
    const { autosize, grid, textarea } = setup();
    autosize.evaluate("hi", "input");
    expect(textarea.style.maxHeight).toBe("108px");

    textarea.style.padding = "10px";
    fireResize(grid);
    runFrames();

    // One row is now 40px: 20px of text plus 2 × 10px padding.
    expect(textarea.style.maxHeight).toBe("120px");
  });

  it("measures a text box that was hidden again once it shows", () => {
    const { autosize, textarea } = setup();
    let hidden = true;
    const visibleHeight = Object.getOwnPropertyDescriptor(
      textarea,
      "scrollHeight",
    )!.get!;
    Object.defineProperty(textarea, "scrollHeight", {
      get: () => (hidden ? 0 : visibleHeight()),
    });

    autosize.evaluate("hi", "input");
    expect(textarea.style.maxHeight).toBe("");

    hidden = false;
    autosize.evaluate("hi", "input");
    expect(textarea.style.maxHeight).toBe("108px");
  });

  it("ignores the resize its own layout change causes", () => {
    const { autosize, grid, resize } = setup();
    autosize.evaluate("one\ntwo", "input");

    resize(300);
    fireResize(grid);

    expect(frames).toHaveLength(0);
  });

  it("stops observing after dispose", () => {
    const { autosize, grid } = setup();
    autosize.evaluate("hi", "input");

    autosize.dispose();
    fireResize(grid);

    expect(frames).toHaveLength(0);
  });
});
