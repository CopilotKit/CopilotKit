import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { CopilotKitRuntime } from "@copilotkit/runtime";
import type { BuiltInAgentClassicConfig as AgentConfig } from "@copilotkit/runtime/agent";
// TODO(copilotkit-2.0): `CopilotKitRequestHandler` was removed in 2.0. Use `CopilotKitRuntimeFetchHandler`. It takes the `Request` directly, not `{ request }`.
import type { CopilotKitRequestHandler } from "@copilotkit/runtime";
import { createCopilotKitNodeHandler } from "@copilotkit/runtime/node";
// TODO(copilotkit-2.0): `createA2UICatalog` was removed in 2.0. Declare the components with `createGenerativeUI({ id, components })` from "@copilotkit/react-core/generative-ui": one entry per component with `component`, `description` and `props`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
// TODO(copilotkit-2.0): `useA2UIStore` was removed in 2.0. Generative UI has no A2UI store. Declare app state as `state` on `createGenerativeUI`, set it with `useGenerativeUIState(ui, key, value)` from "@copilotkit/react-core/generative-ui", and components read it as bound props. See https://docs.copilotkit.ai/generative-ui/components/state-and-actions
// TODO(copilotkit-2.0): The A2UI v0.9 client (`@copilotkit/a2ui-renderer`, `@copilotkit/angular/a2ui`) was removed in 2.0. Use generative UI from the framework's `/generative-ui` entry: `createGenerativeUI` and `standardUI` for catalogs, `GenerativeUISurface` for a surface, and `useGenerativeUIState` and `useGenerativeUIFunction` for state and actions. Then delete this import. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
import { createA2UICatalog, useA2UIStore } from "@copilotkit/a2ui-renderer";
// TODO(copilotkit-2.0): `ImageData` was removed in 2.0. Use `ImageInputPart`, and send images as `content` parts. See https://docs.copilotkit.ai/migrate/removed-apis-2.0
import type { ImageData } from "@copilotkit/shared";

const config: AgentConfig = { model: "openai/gpt-5" };
export const agent = new BuiltInAgent(config);
export const runtime = new CopilotKitRuntime({ agents: { default: agent } });
export const listener = createCopilotKitNodeHandler(async () => new Response());
export const store = useA2UIStore;
export const catalog = createA2UICatalog;
export type Handler = CopilotKitRequestHandler;
export type Image = ImageData;
