// Optional fallback content-script read helper.
// The default read path uses chrome.scripting.executeScript from the background
// service worker, which avoids injecting a persistent content script into every
// page. This file is NOT wired into manifest.json by default. Fork this extension
// and add it to "content_scripts" only if executeScript is unavailable in your
// deployment (e.g. restricted host permissions or Manifest V2 back-compat).

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "read") {
    sendResponse({
      selection: window.getSelection ? String(window.getSelection()) : "",
      text: (document.body?.innerText ?? "").slice(0, 8000),
    });
    return true; // keep the message channel open for the async response
  }
  return undefined;
});
