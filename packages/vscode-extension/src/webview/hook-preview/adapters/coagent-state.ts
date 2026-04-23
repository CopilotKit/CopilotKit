import type { Adapter } from "./types";

export const coAgentStateAdapter: Adapter<"coagent-state"> = (
  config,
  controls,
) => {
  return config.render?.({
    state: controls.state,
    status: controls.status,
    nodeName: controls.nodeName,
  });
};
