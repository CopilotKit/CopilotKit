import { defineComponent } from "vue";
import { CopilotKitProvider, vueBasicCatalog } from "@copilotkit/vue";
import { appUI } from "./app-ui";

export const Basic = defineComponent(() => () => (
  <CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={{ catalog: vueBasicCatalog }} />
));

export const Custom = defineComponent(() => () => (
  <CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={{ catalog: appUI, onAction: () => null }} />
));
