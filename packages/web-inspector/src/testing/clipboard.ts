type ClipboardWriter = Pick<Clipboard, "writeText">;

export function installClipboard(
  clipboard: ClipboardWriter | undefined,
  navigatorObject: Navigator = window.navigator,
): () => void {
  const previous = Object.getOwnPropertyDescriptor(
    navigatorObject,
    "clipboard",
  );
  Object.defineProperty(navigatorObject, "clipboard", {
    configurable: true,
    value: clipboard,
  });

  return () => {
    if (previous) {
      Object.defineProperty(navigatorObject, "clipboard", previous);
    } else {
      Reflect.deleteProperty(navigatorObject, "clipboard");
    }
  };
}
