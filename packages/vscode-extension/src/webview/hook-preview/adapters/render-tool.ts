import type { Adapter } from "./types";

export const renderToolAdapter: Adapter<"render-tool"> = (config, controls) => {
  return config.render?.({
    name: config.name,
    toolCallId: controls.toolCallId,
    parameters: controls.args,
    status: controls.status,
    result: controls.status === "complete" ? controls.result : undefined,
  });
};
