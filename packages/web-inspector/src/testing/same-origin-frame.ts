export function createSameOriginFrame() {
  const iframe = document.createElement("iframe");
  iframe.title = "Test frame";
  document.body.append(iframe);
  const frameWindow = iframe.contentWindow;
  const frameDocument = iframe.contentDocument;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    throw new Error("The test environment did not create an iframe realm.");
  }
  return {
    window: frameWindow,
    document: frameDocument,
    remove: () => iframe.remove(),
  };
}
