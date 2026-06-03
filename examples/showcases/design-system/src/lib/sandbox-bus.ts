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
