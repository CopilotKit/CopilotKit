type Listener = () => void;
const hubs = new WeakMap<
  Window,
  { listeners: Set<Listener>; restore: () => void }
>();

/** Observe same-document navigation without changing history arguments or results. */
export function subscribeToNavigation(win: Window, listener: Listener) {
  let hub = hubs.get(win);
  if (!hub) {
    let active = true;
    const listeners = new Set<Listener>();
    const notify = () => {
      if (!active) return;
      for (const callback of listeners) {
        try {
          callback();
        } catch {
          /* Observation cannot break navigation. */
        }
      }
    };
    const restorers: (() => void)[] = [];
    for (const name of ["pushState", "replaceState"] as const) {
      const original = win.history[name];
      const wrapped: History[typeof name] = function (this: History, ...args) {
        const result = Reflect.apply(original, this, args);
        notify();
        return result;
      };
      try {
        win.history[name] = wrapped;
        restorers.push(() => {
          if (win.history[name] === wrapped) win.history[name] = original;
        });
      } catch {
        /* Locked history still supports native navigation events. */
      }
    }
    win.addEventListener("popstate", notify);
    win.addEventListener("hashchange", notify);
    hub = {
      listeners,
      restore: () => {
        active = false;
        win.removeEventListener("popstate", notify);
        win.removeEventListener("hashchange", notify);
        for (const restore of restorers) {
          try {
            restore();
          } catch {
            // A host may harden history after installation. The retained wrapper
            // is inert, and cleanup of the remaining observers must continue.
          }
        }
      },
    };
    hubs.set(win, hub);
  }
  hub.listeners.add(listener);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    hub.listeners.delete(listener);
    if (!hub.listeners.size) {
      hub.restore();
      if (hubs.get(win) === hub) hubs.delete(win);
    }
  };
}
