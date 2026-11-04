import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { FrontendToolHandlerContext } from "../../types";
import { ɵHumanInTheLoopRegistry } from "../human-in-the-loop";
import type { ɵProviderRegistryInput } from "../provider-config";
import {
  ɵSTABLE_ARRAY_WARNINGS,
  ɵassembleActivityRenderers,
  ɵassembleProviderRegistry,
  ɵresolveA2UIActivation,
  ɵstableArrayPropWarning,
} from "../provider-config";

type Render = (label: string) => string;

type Input = ɵProviderRegistryInput<{ name: string }, Render, Render>;

function assemble(
  input: Partial<Input>,
  registry = new ɵHumanInTheLoopRegistry(),
) {
  return ɵassembleProviderRegistry<{ name: string }, Render, Render>({
    humanInTheLoopRegistry: registry,
    wrapHumanInTheLoopRender: (render, tool) => (label) =>
      `hitl(${tool.name}):${render(label)}`,
    ...input,
  });
}

describe("ɵassembleProviderRegistry", () => {
  it("orders renderers as app renderers, frontend tools, built-in tools, then human-in-the-loop", () => {
    const params = z.object({});
    const { tools, renderToolCalls } = assemble({
      renderToolCalls: [{ name: "app" }],
      frontendTools: [
        {
          name: "search",
          parameters: params,
          render: (l: string) => `search ${l}`,
        },
      ],
      builtInFrontendTools: [
        {
          name: "built-in",
          parameters: params,
          render: (l: string) => `bi ${l}`,
        },
      ],
      humanInTheLoop: [
        {
          name: "approve",
          parameters: params,
          render: (l: string) => `ok ${l}`,
        },
      ],
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "search",
      "built-in",
      "approve",
    ]);
    expect(renderToolCalls.map((renderer) => renderer.name)).toEqual([
      "app",
      "search",
      "built-in",
      "approve",
    ]);
  });

  it("gives a wildcard tool without parameters a renderer that accepts any arguments", () => {
    const { renderToolCalls } = assemble({
      frontendTools: [
        { name: "*", render: () => "wild" },
        { name: "no-params", render: () => "skipped" },
      ],
    });

    expect(renderToolCalls).toHaveLength(1);
    const [wildcard] = renderToolCalls as Array<{
      name: string;
      args: { "~standard": { validate: (v: unknown) => unknown } };
    }>;
    expect(wildcard!.name).toBe("*");
    expect(wildcard!.args["~standard"].validate({ anything: 1 })).toEqual({
      value: { anything: 1 },
    });
  });

  it("keeps the tool's agentId on the renderer", () => {
    const { renderToolCalls } = assemble({
      frontendTools: [
        {
          name: "search",
          agentId: "research",
          parameters: z.object({}),
          render: () => "",
        },
      ],
    });

    expect(renderToolCalls).toEqual([
      expect.objectContaining({ name: "search", agentId: "research" }),
    ]);
  });

  it("builds a human-in-the-loop tool that waits for the render's response", async () => {
    const registry = new ɵHumanInTheLoopRegistry();
    const { tools, renderToolCalls } = assemble(
      {
        humanInTheLoop: [
          {
            name: "approve",
            parameters: z.object({}),
            render: (label: string) => `ask ${label}`,
          },
        ],
      },
      registry,
    );

    const tool = tools[0]!;
    expect(tool.type).toBe("human-in-the-loop");
    const pending = tool.handler!({}, {
      toolCall: { id: "call-1" },
    } as FrontendToolHandlerContext);
    registry.respond("call-1", "approved");
    await expect(pending).resolves.toBe("approved");

    const renderer = renderToolCalls[0] as { render: Render };
    expect(renderer.render("now")).toBe("hitl(approve):ask now");
  });

  it("reads a registry getter only when a call runs", async () => {
    let registry: ɵHumanInTheLoopRegistry | undefined;
    const getRegistry = vi.fn(() => registry!);
    const { tools } = assemble({
      humanInTheLoop: [{ name: "approve", parameters: z.object({}) }],
      humanInTheLoopRegistry: getRegistry,
    });
    expect(getRegistry).not.toHaveBeenCalled();

    registry = new ɵHumanInTheLoopRegistry();
    const pending = tools[0]!.handler!({}, {
      toolCall: { id: "call-2" },
    } as FrontendToolHandlerContext);
    registry.respond("call-2", "yes");
    await expect(pending).resolves.toBe("yes");
  });
});

describe("ɵresolveA2UIActivation", () => {
  it("turns A2UI on from the runtime or from a catalog", () => {
    expect(
      ɵresolveA2UIActivation({ runtimeEnabled: true, hasCatalog: false }),
    ).toEqual({ active: true, missingCatalog: false });
    expect(
      ɵresolveA2UIActivation({ runtimeEnabled: false, hasCatalog: true }),
    ).toEqual({ active: true, missingCatalog: false });
    expect(
      ɵresolveA2UIActivation({ runtimeEnabled: false, hasCatalog: false }),
    ).toEqual({ active: false, missingCatalog: false });
  });

  it("keeps A2UI off without a catalog when one is required, and reports it", () => {
    expect(
      ɵresolveA2UIActivation({
        runtimeEnabled: true,
        hasCatalog: false,
        requireCatalog: true,
      }),
    ).toEqual({ active: false, missingCatalog: true });
    expect(
      ɵresolveA2UIActivation({
        runtimeEnabled: false,
        hasCatalog: false,
        requireCatalog: true,
      }),
    ).toEqual({ active: false, missingCatalog: false });
  });
});

describe("ɵassembleActivityRenderers", () => {
  it("puts app renderers first, then A2UI, then the other built-ins, without empty entries", () => {
    expect(
      ɵassembleActivityRenderers({
        app: ["app"],
        a2ui: "a2ui",
        builtIns: ["mcp", false, undefined, "ogui"],
      }),
    ).toEqual(["app", "a2ui", "mcp", "ogui"]);
  });
});

describe("ɵstableArrayPropWarning", () => {
  it("warns for a new frontendTools array", () => {
    const initial = [{ name: "a" }];
    expect(ɵstableArrayPropWarning("frontendTools", initial, initial)).toBe(
      undefined,
    );
    expect(
      ɵstableArrayPropWarning("frontendTools", initial, [...initial]),
    ).toBe(ɵSTABLE_ARRAY_WARNINGS.frontendTools);
  });

  it("warns for renderToolCalls only when the names change", () => {
    const initial = [{ name: "a" }];
    expect(
      ɵstableArrayPropWarning("renderToolCalls", initial, [{ name: "a" }]),
    ).toBe(undefined);
    expect(
      ɵstableArrayPropWarning("renderToolCalls", initial, [{ name: "b" }]),
    ).toBe(ɵSTABLE_ARRAY_WARNINGS.renderToolCalls);
  });
});
