import { createA2UIMessageRenderer } from "@copilotkit/react-core/v2";
import { CopilotChat } from "@copilotkit/react-core/v2";
import * as LitA2UI from "@a2ui/lit";
import type { RendererProps } from "@copilotkit/a2ui-renderer";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";

const renderer = createA2UIMessageRenderer({ theme: LitA2UI.theme });
export const middleware = new A2UIMiddleware({ injectA2UITool: true });

export const Badge = ({ props }: RendererProps<{ text: string }>) => (
  <em>{props.text}</em>
);

export function isSurface(activityType: string) {
  return activityType === "a2ui-surface";
}

export function Chat() {
  return <CopilotChat renderActivityMessages={[renderer]} />;
}
