import type { Adapter } from "./types";

// HITL's render receives the same shape as useCopilotAction's, so the body
// is identical to actionAdapter. Inlined rather than cast-aliased to keep
// the adapter self-contained and avoid the double-cast gymnastics that
// TS would otherwise require for two structurally-equal Adapter<K> types.
export const humanInTheLoopAdapter: Adapter<"human-in-the-loop"> = (
  config,
  controls,
) => {
  return config.render?.({
    name: config.name,
    args: controls.args,
    status: controls.status,
    result: controls.status === "complete" ? controls.result : undefined,
    handler: config.handler,
    respond: controls.onRespond,
  });
};
