import type { Adapter } from "./types";

export const interruptAdapter: Adapter<"interrupt"> = (config, controls) => {
  return config.render?.({
    event: { value: controls.eventValue },
    resolve: controls.resolve,
    result: controls.result,
  });
};
