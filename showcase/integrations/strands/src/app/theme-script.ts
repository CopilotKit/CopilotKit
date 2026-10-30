/**
 * Puts `class="dark"` on <html> before first paint, so the demos and
 * CopilotKit's own styles follow the reader's theme.
 *
 * The theme comes from, in order:
 *   1. a `copilotkit:theme` message from the page that embeds the demo
 *      (the showcase shells and the docs send one when asked, and again
 *      whenever their theme changes);
 *   2. a `?theme=light|dark` query parameter;
 *   3. the system preference.
 *
 * Inlined in <head> by the root layout. Keep it dependency-free ES5.
 */
export const themeScript = `(function () {
  try {
    var root = document.documentElement;
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var param = new URLSearchParams(window.location.search).get("theme");
    var chosen = param === "light" || param === "dark" ? param : null;
    var apply = function () {
      root.classList.toggle("dark", chosen ? chosen === "dark" : media.matches);
    };
    apply();
    media.addEventListener("change", apply);
    window.addEventListener("message", function (event) {
      var data = event.data;
      if (event.source !== window.parent || !data || data.type !== "copilotkit:theme") return;
      if (data.theme !== "light" && data.theme !== "dark") return;
      chosen = data.theme;
      apply();
    });
    if (window.parent !== window) {
      window.parent.postMessage({ type: "copilotkit:theme-request" }, "*");
    }
  } catch (e) {}
})();`;
