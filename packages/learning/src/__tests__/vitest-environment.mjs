import { builtinEnvironments } from "vitest/environments";

export default {
  ...builtinEnvironments.jsdom,
  async setup(global, options) {
    // jsdom has no fetch/Response implementation. Keep FormData in the same
    // realm as Node's Response: Node 24 no longer serializes jsdom FormData.
    const formData = global.FormData;
    const environment = await builtinEnvironments.jsdom.setup(global, options);
    const descriptor = Object.getOwnPropertyDescriptor(global, "FormData");
    Object.defineProperty(global, "FormData", {
      configurable: true,
      writable: true,
      value: formData,
    });
    return {
      teardown() {
        Object.defineProperty(global, "FormData", descriptor);
        environment.teardown(global);
      },
    };
  },
};
