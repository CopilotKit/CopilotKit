import type React from "react";
import type { RenderPropsKind } from "../../../extension/hooks/hook-registry";
import type { Adapter, ControlsByKind } from "./types";
import { actionAdapter } from "./action";
import { coAgentStateAdapter } from "./coagent-state";
import { interruptAdapter } from "./interrupt";
import { renderToolAdapter } from "./render-tool";
import { humanInTheLoopAdapter } from "./human-in-the-loop";
import { customMessagesAdapter } from "./custom-messages";
import { activityMessageAdapter } from "./activity-message";

const ADAPTERS = {
  action: actionAdapter,
  "coagent-state": coAgentStateAdapter,
  interrupt: interruptAdapter,
  "render-tool": renderToolAdapter,
  "human-in-the-loop": humanInTheLoopAdapter,
  "custom-messages": customMessagesAdapter,
  "activity-message": activityMessageAdapter,
} as const;

export function invokeRender<K extends RenderPropsKind>(
  kind: K,
  config: unknown,
  controls: ControlsByKind[K],
): React.ReactNode {
  const adapter = ADAPTERS[kind] as Adapter<K>;
  return adapter(config as never, controls);
}
