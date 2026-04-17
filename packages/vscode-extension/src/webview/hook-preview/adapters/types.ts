import type React from "react";
import type { RenderPropsKind } from "../../../extension/hooks/hook-registry";

export type ActionControls = {
  args: Record<string, unknown>;
  status: "inProgress" | "executing" | "complete";
  result: string;
  onRespond: (value: unknown) => void;
};

export type CoAgentStateControls = {
  state: Record<string, unknown>;
  status: "inProgress" | "executing" | "complete";
  nodeName: string;
};

export type InterruptControls = {
  eventValue: unknown;
  resolve: (v: unknown) => void;
  result: unknown;
};

export type RenderToolControls = ActionControls & { toolCallId: string };

export type HumanInTheLoopControls = ActionControls;

export type CustomMessagesControls = {
  message: { id: string; role: string; content: string };
};

export type ActivityMessageControls = CustomMessagesControls;

export type ControlsByKind = {
  action: ActionControls;
  "coagent-state": CoAgentStateControls;
  interrupt: InterruptControls;
  "render-tool": RenderToolControls;
  "human-in-the-loop": HumanInTheLoopControls;
  "custom-messages": CustomMessagesControls;
  "activity-message": ActivityMessageControls;
};

export type Adapter<K extends RenderPropsKind> = (
  config: any,
  controls: ControlsByKind[K],
) => React.ReactNode;
