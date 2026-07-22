import { createMiddleware } from "langchain";
import { RegistryState } from "./registry-state.js";
import type {
  AdapterSnapshot,
  AdapterStatus,
  RegistryStateOptions,
  RenderedSkill,
  SkillRegistryTelemetryEvent,
} from "./registry-state.js";

export type {
  AdapterSnapshot,
  AdapterStatus,
  RenderedSkill,
  SkillRegistryTelemetryEvent,
};

export interface SkillRegistryMiddlewareOptions extends RegistryStateOptions {}

export interface SkillRegistryMiddleware {
  readonly name: string;
  readonly wrapModelCall: NonNullable<
    ReturnType<typeof createMiddleware>["wrapModelCall"]
  >;
  readonly ready: boolean;
  readonly status: AdapterStatus;
  readonly snapshot: AdapterSnapshot;
  preload(): Promise<AdapterSnapshot>;
  preloadCached(): Promise<AdapterSnapshot>;
  load(): Promise<AdapterSnapshot>;
  waitUntilReady(options: {
    readonly timeoutMs: number;
  }): Promise<AdapterSnapshot>;
  close(): Promise<void>;
}

export function createSkillRegistryMiddleware(
  options: SkillRegistryMiddlewareOptions,
): SkillRegistryMiddleware {
  const registry = new RegistryState(options);
  const wrapModelCall: NonNullable<
    ReturnType<typeof createMiddleware>["wrapModelCall"]
  > = async (request, handler) => {
    if (registry.status === "denied" || registry.status === "closed") {
      throw (
        registry.snapshot.error ??
        new Error("Registry adapter is not ready for a model call")
      );
    }
    const snapshot = await registry.load();
    const baseContent = request.systemMessage.content;
    const hasBaseContent = baseContent.length > 0;
    return handler({
      ...request,
      systemMessage:
        snapshot.prompt.length === 0
          ? request.systemMessage
          : request.systemMessage.concat(
              `${hasBaseContent ? "\n\n" : ""}${snapshot.prompt}`,
            ),
    });
  };
  const nativeMiddleware = createMiddleware({
    name: "CopilotKitIntelligenceSkillRegistryMiddleware",
    wrapModelCall,
  });

  return {
    ...nativeMiddleware,
    wrapModelCall,
    get ready() {
      return registry.ready;
    },
    get status() {
      return registry.status;
    },
    get snapshot() {
      return registry.snapshot;
    },
    preload: () => registry.preload(),
    preloadCached: () => registry.preloadCached(),
    load: () => registry.load(),
    waitUntilReady: (waitOptions) => registry.waitUntilReady(waitOptions),
    close: () => registry.close(),
  };
}
