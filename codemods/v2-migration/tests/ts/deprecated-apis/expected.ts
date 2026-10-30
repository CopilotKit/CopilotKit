import { BuiltInAgent, CopilotRuntime } from "@copilotkit/runtime";
import type { BuiltInAgentClassicConfig as AgentConfig } from "@copilotkit/runtime";
// TODO(copilotkit-2.0): `CopilotKitRequestHandler` was removed in 2.0. Use `CopilotRuntimeFetchHandler`. It takes the `Request` directly, not `{ request }`.
import type { CopilotKitRequestHandler } from "@copilotkit/runtime";
import { createCopilotNodeHandler } from "@copilotkit/runtime/node";
// TODO(copilotkit-2.0): `createA2UICatalog` was removed in 2.0. Use `createCatalog(definitions, renderers)`. Put each component's `props` and `description` in `definitions`, and its `render` in `renderers`.
import { createA2UICatalog, useA2UIContext } from "@copilotkit/a2ui-renderer";
// TODO(copilotkit-2.0): `ImageData` was removed in 2.0. Use `InputContentSource`, and send images as `content` parts. See https://docs.copilotkit.ai/migration-guides/migrate-attachments
import type { ImageData } from "@copilotkit/shared";

const config: AgentConfig = { model: "openai/gpt-5" };
export const agent = new BuiltInAgent(config);
export const runtime = new CopilotRuntime({ agents: { default: agent } });
export const listener = createCopilotNodeHandler(async () => new Response());
export const store = useA2UIContext;
export const catalog = createA2UICatalog;
export type Handler = CopilotKitRequestHandler;
export type Image = ImageData;
