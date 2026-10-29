import {
  buildGenerativeUIMarkdownGuidelines,
  buildGenerativeUIPrompt,
  envelopeToManifest,
  generativeUIGuideFeatures,
} from "@copilotkit/shared";
import type {
  ɵGenerativeUIDebugFunction,
  ɵGenerativeUIDebugRun,
  ɵGenerativeUIDebugSnapshot,
  ɵGenerativeUIDebugSource,
} from "@copilotkit/core";
import { componentCatalogIds } from "./catalog";
import { toJsonSchema } from "@copilotkit/shared/generative-ui";
import {
  buildGenerativeUIEnvelope,
  buildGenerativeUIManifest,
} from "./manifest";
import type { GenerativeUIEnvelopeOptions } from "./manifest";
import { buildCompactGenerativeUISchema } from "./markdown/context";
import type { GenerativeUIRuntime } from "./runtime-context";

type RuntimeParts = Pick<GenerativeUIRuntime, "ui" | "manager" | "dispatcher">;

/**
 * What a run of `threadId` sends: its envelope, and the text that goes into
 * the prompt of the model because of it.
 *
 * - Tool transport: the runtime adds the `render_ui` guide. It builds it
 *   from the envelope with `buildGenerativeUIPrompt`, as done here.
 * - Markdown transport: the provider sends the guideline and the compact
 *   schema as context entries. With `sendContext: false`, the backend builds
 *   its own prompt, usually from the `instructions` of the envelope.
 */
// ponytail: the prompt text is built at every run start, also with no
// inspector open. It costs about what the runtime pays for the same text.
// Make it lazy if a profile shows it.
export function describeGenerativeUIRun(
  runtime: RuntimeParts,
  threadId: string | undefined,
  options: GenerativeUIEnvelopeOptions,
): Pick<ɵGenerativeUIDebugRun, "envelope" | "prompt"> {
  const envelope = buildGenerativeUIEnvelope(runtime, threadId, options);
  if (options.transport === "tool") {
    const text = buildGenerativeUIPrompt(envelopeToManifest(envelope));
    return {
      envelope,
      prompt: [{ title: "render_ui guide", source: "runtime", text }],
    };
  }
  const manifest = buildGenerativeUIManifest(runtime, threadId);
  if (!options.contextSent) {
    const instructions = envelopeToManifest(envelope).instructions ?? "";
    return {
      envelope,
      prompt: [
        {
          title: "Envelope instructions",
          source: "backend",
          text: instructions,
        },
      ],
    };
  }
  const guideline = buildGenerativeUIMarkdownGuidelines(
    generativeUIGuideFeatures(manifest),
  );
  const schema = JSON.stringify(buildCompactGenerativeUISchema(manifest));
  return {
    envelope,
    prompt: [
      { title: "Markdown guideline", source: "context", text: guideline },
      { title: "Component schema", source: "context", text: schema },
    ],
  };
}

/** The declared functions, with the JSON Schema of their parameters. */
function debugFunctions(runtime: RuntimeParts) {
  const functions: Record<string, ɵGenerativeUIDebugFunction> = {};
  for (const [name, declared] of runtime.ui.functions) {
    let parameters = {};
    try {
      parameters = toJsonSchema(declared.parameters);
    } catch {
      // A schema with no JSON Schema form shows as empty.
    }
    functions[name] = {
      ...(declared.description ? { description: declared.description } : {}),
      parameters,
      handlers: runtime.dispatcher.handlerCount(name),
    };
  }
  return functions;
}

/**
 * The debug source that the provider gives core for the inspector. It builds
 * a snapshot only when the inspector reads one.
 *
 * @param runtime - The generative UI parts of the provider.
 * @param getOptions - The envelope options and agent ids of the current config.
 * @returns The source, and `recordRun` for each run start.
 */
export function createGenerativeUIDebugSource(
  runtime: RuntimeParts,
  getOptions: () => {
    options: GenerativeUIEnvelopeOptions;
    agentIds: string[] | undefined;
  },
) {
  const listeners = new Set<() => void>();
  let lastRun: ɵGenerativeUIDebugRun | undefined;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const source: ɵGenerativeUIDebugSource = {
    getSnapshot(): ɵGenerativeUIDebugSnapshot {
      const { options, agentIds } = getOptions();
      const threadId = runtime.manager.getActiveThread();
      const manifest = buildGenerativeUIManifest(runtime, threadId);
      return {
        catalogId: runtime.ui.id,
        transport: options.transport,
        ...(agentIds ? { agentIds } : {}),
        components: runtime.ui.manifestComponents,
        componentCatalogs: Object.fromEntries(componentCatalogIds(runtime.ui)),
        functions: debugFunctions(runtime),
        state: { ...runtime.manager.getState() },
        targets: manifest.targets,
        activeThreadId: threadId,
        surfaces: runtime.manager.debugSurfaces(),
        lastRun,
        nextRun: {
          agentId: undefined,
          threadId,
          ...describeGenerativeUIRun(runtime, threadId, options),
        },
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      const unsubscribe = runtime.manager.subscribe(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
  };

  return {
    source,
    /** Keeps what a run sent, so the inspector can show it. */
    recordRun(run: ɵGenerativeUIDebugRun) {
      lastRun = run;
      notify();
    },
  };
}
