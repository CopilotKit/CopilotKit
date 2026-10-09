import { createMiddleware, SystemMessage } from "langchain";
import { SkillDeliveryError } from "@copilotkit/intelligence-delivery-core";
import { SkillInvocationScope } from "./invocation.js";
import type { SkillRegistry } from "@copilotkit/intelligence-delivery-core";
import { createSkillTools, formatSkillCatalog } from "./skill-tools.js";

export interface SkillRegistryMiddlewareOptions {
  registry: SkillRegistry;
}

/**
 * Add learned skills through native middleware and wrap the agent once.
 *
 * The wrapper owns invocation state outside LangGraph checkpoints. Always call
 * the returned agent, including for streams and interrupted-run resumes.
 * Set default cancellation signals on the wrapped agent with withConfig, or
 * pass them per invocation, so they also cancel the initial delivery wait.
 *
 * @example
 * const skills = createSkillRegistryMiddleware({ registry });
 * const agent = skills.wrapAgent(createAgent({ model, middleware: [skills] }));
 * await agent.invoke({ messages: [{ role: "user", content: "Help me" }] });
 */
export function createSkillRegistryMiddleware({
  registry,
}: SkillRegistryMiddlewareOptions) {
  if (!registry || typeof registry.acquireSnapshot !== "function") {
    throw new SkillDeliveryError("INVALID_CONFIG", false);
  }
  const scope = new SkillInvocationScope(registry);
  const middleware = createMiddleware({
    name: "CopilotKitSkillRegistry",
    tools: createSkillTools(() => scope.snapshot()),
    beforeAgent: async () => {
      await scope.snapshot();
    },
    wrapModelCall: async (request, handler) => {
      const catalog = formatSkillCatalog(await scope.snapshot());
      const systemMessage =
        request.systemMessage ?? new SystemMessage(request.systemPrompt ?? "");
      return handler({
        ...request,
        systemMessage: systemMessage.concat(`\n\n${catalog}`),
      });
    },
    // A resume can start at a normal tool and skip beforeAgent. Gate that path
    // too, so confirmed denial stops all new adapter-backed invocations.
    wrapToolCall: async (request, handler) => {
      await scope.snapshot();
      return handler(request);
    },
  });
  return Object.assign(middleware, {
    wrapAgent: <T extends object>(agent: T): T => scope.wrapAgent(agent),
  });
}
