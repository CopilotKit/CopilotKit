/** The `<script setup>` code of a 1.x Vue app that uses removed exports. */
import {
  A2UISurfaceActivityRenderer,
  useCopilotAction,
  useCopilotReadable,
} from "@copilotkit/vue";
import type { FrontendAction } from "@copilotkit/vue";
import { useKatexStyles } from "@copilotkit/vue/v2";

// @ts-expect-error Use useFrontendTool from @copilotkit/vue
useCopilotAction({ name: "sayHello", handler: () => "Hello" });

// @ts-expect-error Use useAgentContext from @copilotkit/vue
useCopilotReadable({ description: "The user", value: "Ada" });

// A name that the deprecated /v2 alias lost.
// @ts-expect-error Delete the import and the call
useKatexStyles();

// `new` on a removed component. (Vue's `h()` accepts any object as a
// component, so only the run time catches a render of one: it throws.)
// @ts-expect-error The A2UI v0.9 renderer was removed
export const surface = new A2UISurfaceActivityRenderer();

// @ts-expect-error Use VueFrontendTool from @copilotkit/vue
export const greet: FrontendAction<object> = { name: "greet" };
