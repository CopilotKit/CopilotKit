/**
 * Shared fixtures of the generative UI tests: the catalog, activity message
 * builders, and a harness that mounts a real CopilotKit core with the React
 * Native provider.
 *
 * A test file that imports this must mock react-native first:
 *
 * ```ts
 * vi.mock("react-native", async () =>
 *   (await import("./generative-ui-rn-mock")).createReactNativeMock(),
 * );
 * ```
 *
 * The harness covers the three wiring paths a happy-path mount leaves out:
 * - `messages` seeds the agent's messages before mount, so the provider's
 *   own ingest of `agent.messages` runs on `startRun` (the path a real app
 *   takes), malformed content included;
 * - `strict` mounts under `<React.StrictMode>`, which runs every effect,
 *   its cleanup and the effect again;
 * - `inProduction` runs a callback with `NODE_ENV=production`.
 */
import React, { StrictMode, useState } from "react";
import type { ReactNode } from "react";
import { act } from "@testing-library/react";
import { vi } from "vitest";
import { z } from "zod";
import type { AbstractAgent, RunAgentParameters } from "@ag-ui/client";
import { GENERATIVE_UI_ACTIVITY_TYPE } from "@copilotkit/shared";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { useCopilotKit } from "@copilotkit/react-core/v2/context";
import { SeededAgent, TestCopilotKit } from "../__mocks__/test-copilotkit";
import {
  GenerativeUIProvider,
  createGenerativeUI,
  useGenerativeUIAccessibility,
} from "../generative-ui";
import type {
  GenerativeUIComponentProps,
  GenerativeUIProviderProps,
} from "../generative-ui";

export function Column({ children }: { children?: ReactNode }) {
  return <div data-testid="column">{children}</div>;
}
export function Balance({
  label,
  amount,
}: GenerativeUIComponentProps<typeof ui, "Balance">) {
  return (
    <div data-testid={`balance-${label}`}>
      {label}: {amount}
    </div>
  );
}
function Boom(): ReactNode {
  throw new Error("kaboom");
}
/** Throws until `flaky.ok` is set, so a Retry can recover it. */
export const flaky = { ok: false };
function Flaky(): ReactNode {
  if (!flaky.ok) throw new Error("not yet");
  return <div data-testid="flaky-ok">recovered</div>;
}
/** Applies the accessibility envelope to its own root view. */
function SelfPanel(): ReactNode {
  const aria = useGenerativeUIAccessibility();
  return (
    <div data-testid="self-panel" data-aria={JSON.stringify(aria)}>
      panel
    </div>
  );
}

export const ui = createGenerativeUI({
  id: "bank",
  components: {
    Column: {
      description: "Stacks children vertically",
      component: Column,
      slots: { children: "multiple" },
    },
    Balance: {
      description: "An account balance",
      component: Balance,
      props: z.object({ label: z.string(), amount: z.number() }),
    },
    Boom: { description: "Always throws", component: Boom },
    Flaky: { description: "Throws until it is fixed", component: Flaky },
    SelfPanel: {
      description: "Applies its own accessibility",
      component: SelfPanel,
      accessibility: "self",
    },
  },
});

export const S = "home-surface";
export const create: A2UIOperation = {
  version: "1.0",
  createSurface: { surfaceId: S, catalogId: "bank" },
};
export const nodes = (...components: A2UIComponentNode[]): A2UIOperation => ({
  version: "1.0",
  updateComponents: { surfaceId: S, components },
});
export const activity = (
  operations: A2UIOperation[],
  status: GenerativeUISurfaceContent["status"] = "streaming",
  target = "chat",
) => ({
  id: `activity-${operations.length}-${status}`,
  role: "activity",
  activityType: GENERATIVE_UI_ACTIVITY_TYPE,
  content: {
    surfaceId: S,
    target,
    catalogId: "bank",
    operations,
    status,
    rejected: [] as GenerativeUIRejectedOperation[],
  } satisfies GenerativeUISurfaceContent,
});

/** A list with a hole at every index that `entries` does not set. */
export function sparse(...entries: [number, unknown][]): unknown[] {
  const list: unknown[] = [];
  for (const [index, value] of entries) list[index] = value;
  return list;
}

/**
 * An agent that core can run: `runAgent` records its input and resolves at
 * once, so `copilotkit.runAgent` fires the run-start notification that the
 * provider ingests the agent's messages on.
 */
export class RunnableAgent extends SeededAgent {
  inputs: RunAgentParameters[] = [];
  async runAgent(parameters?: RunAgentParameters) {
    this.inputs.push(parameters ?? {});
    return { result: undefined, newMessages: [] };
  }
}

export type CopilotKitCore = ReturnType<typeof useCopilotKit>["copilotkit"];

/** Publishes the CopilotKit core to the test. */
function CoreProbe({
  coreRef,
}: {
  coreRef?: React.MutableRefObject<CopilotKitCore | null>;
}) {
  const { copilotkit } = useCopilotKit();
  if (coreRef) coreRef.current = copilotkit;
  return null;
}

export interface HarnessProps {
  children: (agent: AbstractAgent) => ReactNode;
  agentRef: React.MutableRefObject<AbstractAgent | null>;
  providerProps?: Partial<GenerativeUIProviderProps>;
  /**
   * The agent's messages before mount. The provider ingests them itself at
   * the next run start (`startRun`), and on every change after that.
   */
  messages?: Array<Record<string, unknown>>;
  /** Mounts the tree under `<React.StrictMode>`. */
  strict?: boolean;
  /** Receives the CopilotKit core. */
  coreRef?: React.MutableRefObject<CopilotKitCore | null>;
}

/** Renders `children` inside a real CopilotKit core and the RN provider. */
export function Harness({
  children,
  agentRef,
  providerProps,
  messages = [],
  strict = false,
  coreRef,
}: HarnessProps) {
  const [agent] = useState(() => new RunnableAgent());
  const tree = (
    <TestCopilotKit messages={messages} agentRef={agentRef} agent={agent}>
      <CoreProbe coreRef={coreRef} />
      <GenerativeUIProvider ui={ui} {...providerProps}>
        <AgentChildren agentRef={agentRef}>{children}</AgentChildren>
      </GenerativeUIProvider>
    </TestCopilotKit>
  );
  return strict ? <StrictMode>{tree}</StrictMode> : tree;
}
function AgentChildren({
  agentRef,
  children,
}: {
  agentRef: React.MutableRefObject<AbstractAgent | null>;
  children: (agent: AbstractAgent) => ReactNode;
}) {
  return <>{children(agentRef.current!)}</>;
}

/** A fresh agent ref for the harness. */
export function newAgentRef() {
  return { current: null } as React.MutableRefObject<AbstractAgent | null>;
}

/**
 * Starts a run of `agent` on `copilotkit` and waits for it. The provider
 * ingests the agent's messages at the start of the run.
 */
export async function startRun(
  copilotkit: CopilotKitCore,
  agent: AbstractAgent,
) {
  await act(async () => {
    await copilotkit.runAgent({ agent });
  });
}

/** Runs `fn` with `NODE_ENV=production`. */
export async function inProduction<T>(fn: () => T | Promise<T>): Promise<T> {
  vi.stubEnv("NODE_ENV", "production");
  try {
    return await fn();
  } finally {
    vi.unstubAllEnvs();
  }
}

/** The console calls whose first argument contains `needle`. */
export function warningsWith(
  warn: { mock: { calls: unknown[][] } },
  needle: string,
): string[] {
  return warn.mock.calls
    .map((c) => String(c[0]))
    .filter((message) => message.includes(needle));
}
