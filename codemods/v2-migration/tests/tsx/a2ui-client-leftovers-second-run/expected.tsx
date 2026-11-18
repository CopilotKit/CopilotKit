// TODO(copilotkit-2.0): The v0.9 chat renderer (`createA2UIMessageRenderer`, its option and action types, `A2UITheme`, `a2uiDefaultTheme`) was removed in 2.0. Generative UI renders the chat surfaces itself: delete the renderer and its `renderActivityMessages` entry, pass a wrapper component as `<CopilotChat generativeUISurface>`, and set colors with `generativeUI.theme`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
import { createA2UIMessageRenderer } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-core";
// TODO(copilotkit-2.0): CopilotKit 2.0 renders A2UI with generative UI and does not use the `@a2ui/*` renderers or their themes. Delete this import if it served the v0.9 client. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
import * as LitA2UI from "@a2ui/lit";
// TODO(copilotkit-2.0): The A2UI v0.9 client (`@copilotkit/a2ui-renderer`, `@copilotkit/angular/a2ui`) was removed in 2.0. Use generative UI from the framework's `/generative-ui` entry: `createGenerativeUI` and `standardUI` for catalogs, `GenerativeUISurface` for a surface, and `useGenerativeUIState` and `useGenerativeUIFunction` for state and actions. Then delete this import. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
import type { RendererProps } from "@copilotkit/a2ui-renderer";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";

const renderer = createA2UIMessageRenderer({ theme: LitA2UI.theme });
// TODO(copilotkit-2.0): 2.0's runtime runs the A2UI middleware itself for `generativeUI: { a2uiVersion: "0.9" }`. Delete this one, or the agent gets two, and move its options (`injectA2UITool`, ...) to `generativeUI`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#keep-a-v09-agent
export const middleware = new A2UIMiddleware({ injectA2UITool: true });

// TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it, and type its props (`z.output` of its schema): `createGenerativeUI` does not infer them. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
export const Badge = ({ props }: RendererProps<{ text: string }>) => (
  <em>{props.text}</em>
);

export function isSurface(activityType: string) {
  // TODO(copilotkit-2.0): 2.0 sends A2UI surfaces as `generative-ui-surface` activities, with the A2UI 1.0 operations in `content.operations` (not `a2ui_operations`). When the runtime has generative UI on, `a2ui-surface` activities no longer reach the client, so this code never runs. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
  return activityType === "a2ui-surface";
}

export function Chat() {
  return <CopilotChat renderActivityMessages={[renderer]} />;
}
