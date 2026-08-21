// @vitest-environment jsdom

import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFrontendTool, useRenderTool } from "@copilotkit/react-core/v2";

import { useFrontendTools } from "./useFrontendTools";

vi.mock("@copilotkit/react-core/v2", () => ({
  useFrontendTool: vi.fn(),
  useRenderTool: vi.fn(),
}));

function registeredRenderer(name: string) {
  const registration = vi
    .mocked(useRenderTool)
    .mock.calls.map(([candidate]) => candidate)
    .find((candidate) => candidate.name === name);

  if (!registration || typeof registration.render !== "function") {
    throw new Error(`Missing renderer registration for ${name}`);
  }

  return registration;
}

describe("useFrontendTools", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("registers backend operations as render-only tools", () => {
    renderHook(() => useFrontendTools());

    expect(useFrontendTool).not.toHaveBeenCalled();
    expect(
      vi.mocked(useRenderTool).mock.calls.map(([tool]) => tool.name),
    ).toEqual([
      "add_resource",
      "connect_resources",
      "remove_resource",
      "move_to_vpc",
    ]);
  });

  it.each([
    {
      name: "add_resource",
      parameters: { resource_type: "ec2", name: "web-server" },
      expected: ["ec2", "web-server"],
    },
    {
      name: "connect_resources",
      parameters: { source_id: "alb-1", target_id: "ec2-1" },
      expected: ["alb-1", "ec2-1"],
    },
    {
      name: "remove_resource",
      parameters: { resource_id: "rds-1" },
      expected: ["Removing resource", "rds-1"],
    },
    {
      name: "move_to_vpc",
      parameters: { resource_id: "ec2-1", vpc_id: "vpc-1" },
      expected: ["Moving to VPC", "ec2-1 → vpc-1"],
    },
  ])(
    "renders the $name backend tool card",
    ({ name, parameters, expected }) => {
      renderHook(() => useFrontendTools());

      render(
        registeredRenderer(name).render({
          name,
          toolCallId: `${name}-1`,
          parameters,
          status: "complete",
          result: "ok",
        }),
      );

      for (const text of expected) {
        expect(screen.getByText(text)).toBeTruthy();
      }
    },
  );
});
