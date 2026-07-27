// @region[interactive-approval-card]
import { h } from "vue";
import type { VNodeChild } from "vue";
import { ToolCallStatus } from "@copilotkit/vue/v2";
import type { VueHumanInTheLoopRenderProps } from "@copilotkit/vue/v2";

export type CommandApproval = {
  command: string;
};

export default function CommandApprovalCard(
  props: VueHumanInTheLoopRenderProps<CommandApproval>,
): VNodeChild {
  if (props.status === ToolCallStatus.InProgress) {
    return h("p", "Preparing approval…");
  }

  if (props.status === ToolCallStatus.Complete) {
    return h("p", props.result);
  }

  return h("article", [
    h("pre", props.args.command),
    h(
      "button",
      {
        type: "button",
        onClick: () => props.respond("Tell the user the command was approved."),
      },
      "Approve",
    ),
    h(
      "button",
      {
        type: "button",
        onClick: () => props.respond("Tell the user the command was denied."),
      },
      "Deny",
    ),
  ]);
}
// @endregion[interactive-approval-card]
