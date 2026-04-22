import type { Adapter } from "./types";

export const actionAdapter: Adapter<"action"> = (config, controls) => {
  return config.render?.({
    name: config.name,
    args: controls.args,
    status: controls.status,
    result: controls.status === "complete" ? controls.result : undefined,
    handler: config.handler,
    respond: controls.onRespond,
  });
};
