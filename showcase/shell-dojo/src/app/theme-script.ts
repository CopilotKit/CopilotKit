/**
 * Puts `class="dark"` on <html> before first paint and keeps it current.
 *
 * The theme comes from, in order:
 *   1. a `copilotkit:theme` message from the page that embeds the dojo
 *      (the docs send one when asked, and again whenever their theme
 *      changes). It applies to this page view only and is never stored;
 *   2. the reader's choice from the theme toggle, stored in localStorage;
 *   3. the system preference.
 *
 * The toggle calls `window.__dojoSetTheme("light" | "dark")`, which stores
 * the choice and drops any theme the embedding page sent.
 *
 * Inlined in <head> by the root layout. Keep it dependency-free ES5.
 */
export const themeScript = `(function () {
  try {
    var KEY = "dojo:theme";
    var root = document.documentElement;
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var valid = function (theme) {
      return theme === "light" || theme === "dark";
    };
    var stored = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch (e) {}
    var chosen = valid(stored) ? stored : null;
    var fromParent = null;
    var apply = function () {
      var theme = fromParent || chosen || (media.matches ? "dark" : "light");
      root.classList.toggle("dark", theme === "dark");
    };
    window.__dojoSetTheme = function (theme) {
      if (!valid(theme)) return;
      chosen = theme;
      fromParent = null;
      try {
        localStorage.setItem(KEY, theme);
      } catch (e) {}
      apply();
    };
    apply();
    media.addEventListener("change", apply);
    window.addEventListener("message", function (event) {
      var data = event.data;
      if (event.source !== window.parent || !data || data.type !== "copilotkit:theme") return;
      if (!valid(data.theme)) return;
      fromParent = data.theme;
      apply();
    });
    if (window.parent !== window) {
      window.parent.postMessage({ type: "copilotkit:theme-request" }, "*");
    }
  } catch (e) {}
})();`;

declare global {
  interface Window {
    /** Defined by `themeScript`; stores and applies the reader's theme. */
    __dojoSetTheme?: (theme: "light" | "dark") => void;
  }
}
