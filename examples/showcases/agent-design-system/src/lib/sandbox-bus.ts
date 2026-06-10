/**
 * Tiny pub/sub for events the sandboxed iframe wants to push to the host
 * app. The sandbox function handlers are registered at the provider level
 * (top of the tree), but pages need to react to them at page scope — this
 * bus lets the handler publish and the page subscribe.
 */
type SandboxEvent = {
  type: "pin_card";
  payload: {
    title: string;
    body?: string;
    tone?: "info" | "positive" | "warning";
  };
};

type Listener = (event: SandboxEvent) => void;

const listeners = new Set<Listener>();

export const sandboxBus = {
  publish(event: SandboxEvent) {
    listeners.forEach((fn) => fn(event));
  },
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export type { SandboxEvent };
