/**
 * Light and dark theme for the showcase: one source for every integration
 * (through its `_shared` link) and for the shells that embed them.
 *
 * Two halves talk over `postMessage`:
 *
 * - The page being shown runs `themeScript()` in <head>. It puts
 *   `class="dark"` on <html> before first paint, and CopilotKit's own styles
 *   follow that class. When framed, it asks the embedding page with
 *   `{ type: "copilotkit:theme-request" }`.
 * - The embedding page runs `installThemeBridge`, which answers with
 *   `{ type: "copilotkit:theme", theme }` and sends it again whenever its own
 *   theme changes.
 *
 * The newest choice wins: a theme from the embedding page, or one picked on
 * the page itself (`window.__copilotkitTheme.set`). Before either, the page
 * uses `?theme=light|dark`, then a stored pick (when the page has a
 * `storageKey`), then the system preference.
 */

export type Theme = "light" | "dark";

/** The page's theme, as `themeScript` exposes it on `window.__copilotkitTheme`. */
export interface ThemeApi {
  /** The theme the page shows now. */
  get(): Theme;
  /** Picks a theme for this page; it holds until the embedding page sends a newer one. */
  set(theme: Theme): void;
  /** Calls `listener` whenever the theme is applied. Returns an unsubscribe. */
  subscribe(listener: (theme: Theme) => void): () => void;
}

export interface ThemeOptions {
  /** Remembers the page's own pick in localStorage under this key. */
  storageKey?: string;
}

declare global {
  interface Window {
    __copilotkitTheme?: ThemeApi;
  }
}

/**
 * Applies the theme to `win` and keeps it current. `themeScript` inlines this
 * function's source, so it must not use anything from outside its own body.
 */
export function installTheme(win: Window, options?: ThemeOptions): ThemeApi {
  var root = win.document.documentElement;
  var media = win.matchMedia("(prefers-color-scheme: dark)");
  var key = options && options.storageKey;
  var valid = function (theme: unknown): theme is Theme {
    return theme === "light" || theme === "dark";
  };
  var stored: string | null = null;
  if (key) {
    try {
      stored = win.localStorage.getItem(key);
    } catch {}
  }
  var param = new URLSearchParams(win.location.search).get("theme");
  var chosen: Theme | null = valid(param)
    ? param
    : valid(stored)
      ? stored
      : null;
  var listeners: Array<(theme: Theme) => void> = [];

  var get = function (): Theme {
    return chosen || (media.matches ? "dark" : "light");
  };
  var apply = function () {
    var theme = get();
    root.classList.toggle("dark", theme === "dark");
    for (var i = 0; i < listeners.length; i++) listeners[i](theme);
  };

  var api: ThemeApi = {
    get: get,
    set: function (theme) {
      if (!valid(theme)) return;
      chosen = theme;
      if (key) {
        try {
          win.localStorage.setItem(key, theme);
        } catch {}
      }
      apply();
    },
    subscribe: function (listener) {
      listeners.push(listener);
      return function () {
        listeners = listeners.filter(function (l) {
          return l !== listener;
        });
      };
    },
  };
  win.__copilotkitTheme = api;

  apply();
  media.addEventListener("change", apply);
  win.addEventListener("message", function (event: MessageEvent) {
    var data = event.data;
    if (event.source !== win.parent || !data) return;
    if (data.type !== "copilotkit:theme" || !valid(data.theme)) return;
    chosen = data.theme;
    apply();
  });
  if (win.parent !== win) {
    win.parent.postMessage({ type: "copilotkit:theme-request" }, "*");
  }
  return api;
}

/** The `<script>` body that runs `installTheme` before first paint. */
export function themeScript(options?: ThemeOptions): string {
  return `try{(${installTheme.toString()})(window,${JSON.stringify(options || {})})}catch(e){}`;
}

/** Where an embedding page reads its own theme from. */
export interface ThemeSource {
  get(): Theme;
  /** Calls `onChange` when the theme may have changed. Returns an unsubscribe. */
  subscribe(onChange: () => void): () => void;
}

/** A theme kept as a `dark` class on <html>, the way most shells keep it. */
export function darkClassSource(doc: Document): ThemeSource {
  return {
    get: () =>
      doc.documentElement.classList.contains("dark") ? "dark" : "light",
    subscribe: (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(doc.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      return () => observer.disconnect();
    },
  };
}

/**
 * The embedding page's half: answers each framed page's theme request, and
 * sends the theme to every frame again when it changes. Frames that loaded
 * before this ran get it right away. Returns a cleanup.
 */
export function installThemeBridge(win: Window, source: ThemeSource) {
  const send = (target: MessageEventSource) =>
    (target as Window).postMessage(
      { type: "copilotkit:theme", theme: source.get() },
      "*",
    );
  const sendToFrames = () =>
    win.document.querySelectorAll("iframe").forEach((frame) => {
      if (frame.contentWindow) send(frame.contentWindow);
    });
  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === "copilotkit:theme-request" && event.source) {
      send(event.source);
    }
  };

  let last = source.get();
  const unsubscribe = source.subscribe(() => {
    if (source.get() === last) return;
    last = source.get();
    sendToFrames();
  });
  win.addEventListener("message", onMessage);
  sendToFrames();
  return () => {
    win.removeEventListener("message", onMessage);
    unsubscribe();
  };
}
