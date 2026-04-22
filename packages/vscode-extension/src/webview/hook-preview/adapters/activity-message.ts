import type { Adapter } from "./types";

export const activityMessageAdapter: Adapter<"activity-message"> = (
  config,
  controls,
) => {
  return config.render?.(controls.message);
};
