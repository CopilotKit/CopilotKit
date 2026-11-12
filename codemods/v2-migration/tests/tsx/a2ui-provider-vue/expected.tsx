import { defineComponent } from "vue";
import { CopilotKitProvider } from "@copilotkit/vue";
import { appUI } from "./app-ui";

export const Basic = defineComponent(() => () => (
  <CopilotKitProvider runtimeUrl="/api/copilotkit" />
));

export const Custom = defineComponent(() => () => (
  <CopilotKitProvider runtimeUrl="/api/copilotkit" generativeUI={{ ui: appUI }} /* TODO(copilotkit-2.0): The `a2ui` option was removed in 2.0, and these options have no 1:1 equivalent: `theme` becomes the `theme` of the generative UI config (CSS variables), `onAction` becomes events or functions on the components, and `loadingComponent`, `recovery` and `includeSchema` are gone. Move what you need, then delete `a2ui`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui */ a2ui={{ onAction: () => null }} />
));
