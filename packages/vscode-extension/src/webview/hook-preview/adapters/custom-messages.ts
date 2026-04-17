import type { Adapter } from "./types";

export const customMessagesAdapter: Adapter<"custom-messages"> = (
  config,
  controls,
) => {
  return config.render?.(controls.message);
};
