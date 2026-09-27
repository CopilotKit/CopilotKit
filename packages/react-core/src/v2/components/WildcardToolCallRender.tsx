import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import {
  DefaultToolCallRenderer,
  adaptRendererProps,
} from "../hooks/use-default-render-tool";

/**
 * Catch-all (`"*"`) tool-call renderer that shows CopilotKit's default
 * tool-call card for any tool without a dedicated renderer.
 */
export const WildcardToolCallRender = defineToolCallRenderer({
  name: "*",
  render: (props) => <DefaultToolCallRenderer {...adaptRendererProps(props)} />,
});
