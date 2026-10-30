/**
 * Puts `class="dark"` on <html> before first paint.
 *
 * The theme comes from, in order:
 *   1. a `copilotkit:theme` message from the page that embeds this one
 *      (asked for with `copilotkit:theme-request`, same protocol as the
 *      showcase demos; the docs answer it and re-send on every change).
 *      Not persisted — it only holds for this page view;
 *   2. the reader's choice from the nav toggle (`localStorage.theme`);
 *   3. the system preference, followed live.
 *
 * `DemoThemeBridge` then relays the resulting class to embedded demos.
 * Inlined in <head> by the root layout. Keep it dependency-free ES5.
 */
export const themeScript = `(function () {
  try {
    var root = document.documentElement;
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var fromParent = null;
    var apply = function () {
      var theme = fromParent;
      if (!theme) {
        try { theme = localStorage.getItem("theme"); } catch (e) {}
      }
      if (theme !== "light" && theme !== "dark") {
        theme = media.matches ? "dark" : "light";
      }
      root.classList.toggle("dark", theme === "dark");
    };
    apply();
    media.addEventListener("change", apply);
    if (window.parent !== window) {
      window.addEventListener("message", function (event) {
        var data = event.data;
        if (event.source !== window.parent || !data || data.type !== "copilotkit:theme") return;
        if (data.theme !== "light" && data.theme !== "dark") return;
        fromParent = data.theme;
        apply();
      });
      window.parent.postMessage({ type: "copilotkit:theme-request" }, "*");
    }
  } catch (e) {}
})();`;
