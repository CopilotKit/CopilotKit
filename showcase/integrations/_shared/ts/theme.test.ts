import { describe, expect, it } from "vitest";

import { installTheme, installThemeBridge, themeScript } from "./theme";
import type { Theme, ThemeSource } from "./theme";

type Listener = (event: { data: unknown; source: unknown }) => void;

/** Just enough of `window` for the theme code, with a switchable OS theme. */
function fakeWindow(init: { osDark?: boolean; search?: string } = {}) {
  const classes = new Set<string>();
  const mediaListeners: Array<() => void> = [];
  const messageListeners: Listener[] = [];
  const storage = new Map<string, string>();
  const frames: Array<{ contentWindow: unknown }> = [];
  const media = { matches: !!init.osDark };

  const win = {
    document: {
      documentElement: {
        classList: {
          contains: (c: string) => classes.has(c),
          toggle: (c: string, on: boolean) => {
            if (on) classes.add(c);
            else classes.delete(c);
            return on;
          },
        },
      },
      querySelectorAll: () => frames,
    },
    location: { search: init.search ?? "" },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
    },
    matchMedia: () => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (_: string, fn: () => void) => mediaListeners.push(fn),
    }),
    addEventListener: (_: string, fn: Listener) => messageListeners.push(fn),
    removeEventListener: (_: string, fn: Listener) => {
      messageListeners.splice(messageListeners.indexOf(fn), 1);
    },
    parent: undefined as unknown,
    postMessage: () => {},
    __copilotkitTheme: undefined as unknown,
  };
  win.parent = win;

  return {
    win,
    storage,
    frames,
    isDark: () => classes.has("dark"),
    setOsDark: (dark: boolean) => {
      media.matches = dark;
      mediaListeners.forEach((fn) => fn());
    },
    receive: (data: unknown, source: unknown) =>
      messageListeners.forEach((fn) => fn({ data, source })),
  };
}

/**
 * Frames `child` inside `parent`, the way an iframe is: messages the child
 * posts to its parent arrive with the child as source, and the parent reaches
 * the child through its iframe's `contentWindow`.
 */
function frame(
  parent: ReturnType<typeof fakeWindow>,
  child: ReturnType<typeof fakeWindow>,
) {
  const childSeenByParent = {
    postMessage: (data: unknown) => child.receive(data, parentSeenByChild),
  };
  const parentSeenByChild = {
    postMessage: (data: unknown) => parent.receive(data, childSeenByParent),
  };
  child.win.parent = parentSeenByChild;
  parent.frames.push({ contentWindow: childSeenByParent });
}

const win = (w: ReturnType<typeof fakeWindow>) => w.win as unknown as Window;

/** A parent page whose own theme the test sets directly. */
function parentSource(initial: Theme) {
  let theme = initial;
  let notify = () => {};
  const source: ThemeSource = {
    get: () => theme,
    subscribe: (onChange) => {
      notify = onChange;
      return () => {
        notify = () => {};
      };
    },
  };
  return {
    source,
    set: (next: Theme) => {
      theme = next;
      notify();
    },
  };
}

describe("installTheme", () => {
  it("follows the system preference live when nothing was chosen", () => {
    const page = fakeWindow({ osDark: true });
    installTheme(win(page));
    expect(page.isDark()).toBe(true);
    page.setOsDark(false);
    expect(page.isDark()).toBe(false);
  });

  it("takes ?theme= over the system preference", () => {
    const page = fakeWindow({ osDark: true, search: "?theme=light" });
    installTheme(win(page));
    expect(page.isDark()).toBe(false);
  });

  it("keeps a pick made on the page when the OS theme flips", () => {
    // The beautiful-chat case: the agent's toggle picks dark, then the OS
    // goes dark and back to light. The page must stay dark, and what the
    // page reports must match what it shows.
    const page = fakeWindow({ osDark: false });
    const api = installTheme(win(page));
    const seen: Theme[] = [];
    api.subscribe((theme) => seen.push(theme));

    api.set("dark");
    page.setOsDark(true);
    page.setOsDark(false);

    expect(page.isDark()).toBe(true);
    expect(api.get()).toBe("dark");
    expect(seen.at(-1)).toBe("dark");

    api.set("light");
    expect(page.isDark()).toBe(false);
  });

  it("restores a stored pick only when given a storage key", () => {
    const page = fakeWindow({ osDark: false });
    installTheme(win(page), { storageKey: "theme" }).set("dark");
    expect(page.storage.get("theme")).toBe("dark");

    const reload = fakeWindow({ osDark: false });
    reload.storage.set("theme", "dark");
    installTheme(win(reload), { storageKey: "theme" });
    expect(reload.isDark()).toBe(true);

    const demo = fakeWindow({ osDark: false });
    demo.storage.set("theme", "dark");
    installTheme(win(demo));
    expect(demo.isDark()).toBe(false);
  });

  it("ignores theme messages that don't come from its parent", () => {
    const page = fakeWindow({ osDark: false });
    installTheme(win(page));
    page.receive({ type: "copilotkit:theme", theme: "dark" }, {});
    expect(page.isDark()).toBe(false);
  });

  it("runs from the inlined script string alone", () => {
    const page = fakeWindow({ osDark: false, search: "?theme=dark" });
    new Function("window", themeScript())(page.win);
    expect(page.isDark()).toBe(true);
    expect(page.win.__copilotkitTheme).toBeDefined();
  });
});

describe("a framed page and the embedding page's bridge", () => {
  it("takes the embedding page's theme on load, over the system preference", () => {
    const parent = fakeWindow();
    const child = fakeWindow({ osDark: false });
    frame(parent, child);
    const docs = parentSource("dark");
    installThemeBridge(win(parent), docs.source);

    installTheme(win(child));

    expect(child.isDark()).toBe(true);
  });

  it("gets the theme even when it loaded before the bridge", () => {
    const parent = fakeWindow();
    const child = fakeWindow({ osDark: false });
    frame(parent, child);
    installTheme(win(child)); // asks; nobody is listening yet
    expect(child.isDark()).toBe(false);

    installThemeBridge(win(parent), parentSource("dark").source);

    expect(child.isDark()).toBe(true);
  });

  it("follows the embedding page's theme changes live", () => {
    const parent = fakeWindow();
    const child = fakeWindow({ osDark: true });
    frame(parent, child);
    const docs = parentSource("light");
    installThemeBridge(win(parent), docs.source);
    installTheme(win(child));
    expect(child.isDark()).toBe(false);

    docs.set("dark");
    expect(child.isDark()).toBe(true);
    docs.set("light");
    expect(child.isDark()).toBe(false);
  });

  it("lets the newest choice win between the page and its embedder", () => {
    const parent = fakeWindow();
    const child = fakeWindow();
    frame(parent, child);
    const docs = parentSource("dark");
    installThemeBridge(win(parent), docs.source);
    const api = installTheme(win(child));

    api.set("light"); // e.g. the demo's own toggle
    expect(child.isDark()).toBe(false);

    docs.set("light");
    docs.set("dark"); // the reader switches the docs to dark
    expect(child.isDark()).toBe(true);
    expect(api.get()).toBe("dark");
  });

  it("stops answering after cleanup", () => {
    const parent = fakeWindow();
    const child = fakeWindow({ osDark: false });
    frame(parent, child);
    const docs = parentSource("light");
    const cleanup = installThemeBridge(win(parent), docs.source);
    installTheme(win(child));

    cleanup();
    docs.set("dark");

    expect(child.isDark()).toBe(false);
  });
});
