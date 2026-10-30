"use client";

import { useEffect } from "react";

const currentTheme = () =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

const sendTheme = (target: MessageEventSource) =>
  (target as Window).postMessage(
    { type: "copilotkit:theme", theme: currentTheme() },
    "*",
  );

const sendToFrames = () =>
  document.querySelectorAll("iframe").forEach((frame) => {
    if (frame.contentWindow) sendTheme(frame.contentWindow);
  });

/**
 * Keeps embedded demos on this page's theme. A demo asks with a
 * `copilotkit:theme-request` message as it loads (see the showcase
 * integrations' `theme-script.ts`); this answers it, and tells every frame
 * again whenever the `dark` class on <html> changes.
 */
export function DemoThemeBridge() {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "copilotkit:theme-request" && event.source) {
        sendTheme(event.source);
      }
    };
    let last = currentTheme();
    const observer = new MutationObserver(() => {
      if (currentTheme() === last) return;
      last = currentTheme();
      sendToFrames();
    });

    window.addEventListener("message", onMessage);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    // Frames that loaded before this mounted asked before anyone listened.
    sendToFrames();
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, []);

  return null;
}
