export const INSPECTOR_POP_OUT_NAME = "CPK-Inspector-Panel";

export const POP_OUT_BLOCKED_MESSAGE =
  "Failed to open popup. Please allow popups for this site to view the Inspector in its own window.";

const BRAND_FONT_LINK_ID = "cpk-inspector-brand-fonts";
const BRAND_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600&family=Spline+Sans+Mono:wght@600&display=swap";

export type PopOutFeatures = {
  width: number;
  height: number;
};

export type PopOutHandle = {
  win: Window;
  close: () => void;
};

export function buildPopOutFeatures(size: PopOutFeatures): string {
  return `width=${Math.round(size.width)},height=${Math.round(size.height)},popup`;
}

export function copyStyleSheets(fromDoc: Document, toDoc: Document): void {
  for (const styleSheet of Array.from(fromDoc.styleSheets)) {
    try {
      const cssRules = Array.from(styleSheet.cssRules)
        .map((rule) => rule.cssText)
        .join("");
      const style = toDoc.createElement("style");
      const owner = styleSheet.ownerNode;
      if (owner && "id" in owner && typeof owner.id === "string" && owner.id) {
        style.id = owner.id;
      }
      style.textContent = cssRules;
      toDoc.head.appendChild(style);
    } catch {
      if (!styleSheet.href) continue;
      const link = toDoc.createElement("link");
      link.rel = "stylesheet";
      link.href = styleSheet.href;
      toDoc.head.appendChild(link);
    }
  }
}

export function applyInspectorOwnedStyles(
  toDoc: Document,
  cssTexts: readonly string[],
): void {
  for (const cssText of cssTexts) {
    const style = toDoc.createElement("style");
    style.setAttribute("data-cpk-inspector-pop-out", "");
    style.textContent = cssText;
    toDoc.head.appendChild(style);
  }
}

export function ensureBrandFont(doc: Document): void {
  if (doc.getElementById(BRAND_FONT_LINK_ID)) return;
  const link = doc.createElement("link");
  link.id = BRAND_FONT_LINK_ID;
  link.rel = "stylesheet";
  link.href = BRAND_FONT_HREF;
  doc.head.appendChild(link);
}

export function openPopOutWindow(args: {
  open: typeof window.open;
  features: string;
  title: string;
  cssTexts: readonly string[];
  sourceDocument: Document;
  onClose: () => void;
}): PopOutHandle {
  const win = args.open("", INSPECTOR_POP_OUT_NAME, args.features);
  if (!win) {
    throw new Error(POP_OUT_BLOCKED_MESSAGE);
  }
  win.document.head.innerHTML = "";
  win.document.body.innerHTML = "";
  win.document.title = args.title;
  win.document.body.style.margin = "0";
  copyStyleSheets(args.sourceDocument, win.document);
  applyInspectorOwnedStyles(win.document, args.cssTexts);
  ensureBrandFont(win.document);
  const onPageHide = () => {
    args.onClose();
  };
  const close = () => {
    win.removeEventListener("pagehide", onPageHide);
    win.close();
  };
  win.addEventListener("pagehide", onPageHide);
  return { win, close };
}
