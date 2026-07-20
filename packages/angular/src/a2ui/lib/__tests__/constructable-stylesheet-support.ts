/**
 * jsdom does not implement constructable stylesheets, which the A2UI basic
 * catalog uses to inject its default styles. Installs the minimal surface the
 * catalog needs so basic-catalog components can be instantiated in tests.
 */
export function installConstructableStyleSheetSupport(): void {
  const prototype = globalThis.CSSStyleSheet?.prototype as
    | (CSSStyleSheet & { replaceSync?: (text: string) => void })
    | undefined;
  if (prototype && typeof prototype.replaceSync !== "function") {
    prototype.replaceSync = () => undefined;
  }

  if (!Array.isArray(document.adoptedStyleSheets)) {
    Object.defineProperty(document, "adoptedStyleSheets", {
      value: [],
      writable: true,
      configurable: true,
    });
  }
}
