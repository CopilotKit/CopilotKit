import {
  ApplicationRef,
  Component,
  EnvironmentInjector,
  createEnvironmentInjector,
  input,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { expect, vi } from "vitest";
import { Subject, takeWhile } from "rxjs";
import type { Observable } from "rxjs";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { z } from "zod";
import { CopilotKit, provideCopilotKit } from "@copilotkit/angular";
import { readCopilotKitUIEnvelope } from "@copilotkit/shared";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUI } from "../catalog";
import type { GenerativeUIConfig } from "../config";
import { CopilotGenerativeUI } from "../generative-ui";
import { provideGenerativeUI } from "../provide";
import { registerGenerativeUIFunction } from "../state";

// The shared setup of generative-ui.spec.ts and events.spec.ts: a shop UI, a
// controllable agent, and the root with CopilotKit around it.

export const LICENSE_KEY = "ck_pub_000000000000000000000000";

@Component({ selector: "test-box", template: "<div></div>" })
class Box {}

@Component({
  selector: "test-buy",
  template: `
    <button>{{ label() }}</button>
  `,
})
class Buy {
  readonly label = input<string>();
}

export const ui = createGenerativeUI({
  id: "shop",
  functions: {
    applyCoupon: { parameters: z.object({ code: z.string() }) },
  },
  components: {
    Box: { component: Box },
    Button: { component: Buy, props: z.object({ label: z.string() }) },
  },
});

type CouponHandler = (args: { code: string }) => unknown;

/**
 * A controllable agent, as React's MockStepwiseAgent: one subject for every
 * run, each run ends at its RUN_FINISHED. It records the input of each run.
 */
export class CapturingAgent extends AbstractAgent {
  static inputs: RunAgentInput[] = [];
  readonly #subject = new Subject<BaseEvent>();
  /** The input of the latest run of this agent. */
  input: RunAgentInput | undefined;

  constructor(id: string) {
    super({ agentId: id });
  }

  override run(input: RunAgentInput): Observable<BaseEvent> {
    CapturingAgent.inputs.push(input);
    this.input = input;
    return this.#subject.pipe(
      takeWhile(
        (event) =>
          event.type !== EventType.RUN_FINISHED &&
          event.type !== EventType.RUN_ERROR,
        true,
      ),
    );
  }

  emit(event: BaseEvent) {
    if (event.type === EventType.RUN_STARTED) this.isRunning = true;
    if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    this.#subject.next(event);
  }

  /** Emits RUN_STARTED for the latest run. */
  start() {
    this.emit({ type: EventType.RUN_STARTED, ...this.#ids() } as BaseEvent);
  }

  /** Emits RUN_FINISHED for the latest run. */
  finish() {
    this.emit({ type: EventType.RUN_FINISHED, ...this.#ids() } as BaseEvent);
  }

  #ids() {
    return { threadId: this.input?.threadId, runId: this.input?.runId };
  }

  // The subject outlives each run.
  override async detachActiveRun(): Promise<void> {}
}

/**
 * Mounts a handler of `name` for the lifetime of a child injector, as a
 * component would. Returns the unmount.
 */
export function mountFunction<UI extends GenerativeUI<any>>(
  ui: UI,
  name: string,
  handler: (args: never) => unknown,
) {
  const injector = createEnvironmentInjector(
    [],
    TestBed.inject(EnvironmentInjector),
  );
  registerGenerativeUIFunction(ui, name as never, handler as never, {
    injector,
  });
  return () => injector.destroy();
}

export function setup(config: Partial<GenerativeUIConfig> = {}) {
  CapturingAgent.inputs = [];
  const agent = new CapturingAgent("default");
  const other = new CapturingAgent("other");
  TestBed.configureTestingModule({
    providers: [
      provideCopilotKit({
        licenseKey: LICENSE_KEY,
        agents: { default: agent, other },
      }),
      provideGenerativeUI({ ui, ...config } as GenerativeUIConfig),
    ],
  });
  const copilotkit = TestBed.inject(CopilotKit);
  const root = TestBed.inject(CopilotGenerativeUI);
  let unmountHandler: (() => void) | undefined;
  return {
    agent,
    other,
    copilotkit,
    core: copilotkit.core,
    root,
    /** Mounts `handler` for applyCoupon; `undefined` unmounts it. */
    setHandler: (handler?: CouponHandler) => {
      unmountHandler?.();
      unmountHandler = handler
        ? mountFunction(ui, "applyCoupon", handler)
        : undefined;
    },
    /** Destroys the application, and the root with it. */
    unmount: () => TestBed.inject(ApplicationRef).destroy(),
  };
}

/** Runs `agent` once to the end. Returns the input of that run. */
export async function runOnce(core: CopilotKit["core"], agent: CapturingAgent) {
  const index = CapturingAgent.inputs.length;
  const pending = core.runAgent({ agent });
  await vi.waitFor(() =>
    expect(CapturingAgent.inputs.length).toBeGreaterThan(index),
  );
  agent.start();
  agent.finish();
  await pending;
  return CapturingAgent.inputs[index]!;
}

/** The envelope of a run, read the way the runtime reads it. */
export function envelopeOf(input: RunAgentInput) {
  return readCopilotKitUIEnvelope(input.forwardedProps);
}

/** The one inline catalog of the envelope of a run. */
export function catalogOf(input: RunAgentInput) {
  return envelopeOf(input)?.["v1.0"].inlineCatalogs?.[0];
}

export function buttonSurface(surfaceId: string): GenerativeUISurfaceContent {
  return {
    surfaceId,
    target: "chat",
    catalogId: "shop",
    status: "ready",
    rejected: [],
    operations: [
      { version: "v1.0", createSurface: { surfaceId, catalogId: "shop" } },
      {
        version: "v1.0",
        updateComponents: {
          surfaceId,
          components: [{ id: "root", component: "Button", label: "Buy now" }],
        },
      },
    ],
  };
}

/** A surface whose root is a component that the catalog does not have. */
export function missingRootSurface(
  surfaceId: string,
): GenerativeUISurfaceContent {
  return {
    ...buttonSurface(surfaceId),
    operations: [
      { version: "v1.0", createSurface: { surfaceId, catalogId: "shop" } },
      {
        version: "v1.0",
        updateComponents: {
          surfaceId,
          components: [{ id: "root", component: "Missing" }],
        },
      },
    ],
  };
}

export const origin = { surfaceId: "s1", componentId: "root" };
