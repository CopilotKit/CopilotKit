"use client";

import { useEffect } from "react";

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

/**
 * The dashboard's resolved theme. `data-theme` on <html> is "light", "dark",
 * or "system" (see theme-toggle.tsx); "system" follows the OS preference.
 */
const currentTheme = () => {
  const mode = document.documentElement.getAttribute("data-theme");
  if (mode === "light" || mode === "dark") return mode;
  return darkQuery().matches ? "dark" : "light";
};

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
 * Keeps embedded demos (link previews) on the dashboard's theme. A demo asks
 * with a `copilotkit:theme-request` message as it loads (see the showcase
 * integrations' `theme-script.ts`); this answers it, and tells every frame
 * again whenever the resolved theme changes: when `data-theme` on <html>
 * changes, or when the OS preference changes while in "system" mode.
 * Same protocol as shell-docs' `DemoThemeBridge`.
 */
export function DemoThemeBridge() {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "copilotkit:theme-request" && event.source) {
        sendTheme(event.source);
      }
    };
    let last = currentTheme();
    const onThemeChange = () => {
      if (currentTheme() === last) return;
      last = currentTheme();
      sendToFrames();
    };
    const observer = new MutationObserver(onThemeChange);
    const media = darkQuery();

    window.addEventListener("message", onMessage);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    media.addEventListener("change", onThemeChange);
    // Frames that loaded before this mounted asked before anyone listened.
    sendToFrames();
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
      media.removeEventListener("change", onThemeChange);
    };
  }, []);

  return null;
}
