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

/**
 * Invokes the captured render function for a given hook kind with the live
 * control values.
 *
 * The `ADAPTERS[kind] as Adapter<K>` cast is unsound to the type checker but
 * sound at runtime: the ADAPTERS record is keyed by the closed `RenderPropsKind`
 * union, and `controls: ControlsByKind[K]` is the exact shape each adapter
 * expects. TS would otherwise narrow the lookup result to `Adapter<never>`
 * because `Adapter` is contravariant in its controls parameter.
 */
export function invokeRender<K extends RenderPropsKind>(
  kind: K,
  config: unknown,
  controls: ControlsByKind[K],
): React.ReactNode {
  const adapter = ADAPTERS[kind] as Adapter<K>;
  return adapter(config as never, controls);
}
