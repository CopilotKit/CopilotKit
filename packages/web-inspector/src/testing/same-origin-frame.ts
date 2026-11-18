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

  const createEvent = (type: string, init: EventInit = {}) => {
    const event = frameDocument.createEvent("Event");
    event.initEvent(type, init.bubbles, init.cancelable);
    return event;
  };
  const createKeyboardEvent = (type: string, init: KeyboardEventInit = {}) => {
    const event = frameDocument.createEvent("KeyboardEvent");
    event.initKeyboardEvent(
      type,
      init.bubbles,
      init.cancelable,
      frameWindow,
      init.key,
      init.location,
      init.ctrlKey,
      init.altKey,
      init.shiftKey,
      init.metaKey,
    );
    return event;
  };

  return {
    window: frameWindow,
    document: frameDocument,
    createEvent,
    createKeyboardEvent,
    remove: () => iframe.remove(),
  };
}
