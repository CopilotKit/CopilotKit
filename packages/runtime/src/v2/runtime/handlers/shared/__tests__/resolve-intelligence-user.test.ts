import { expect, test, vi } from "vitest";
import type { CopilotIntelligenceRuntimeLike } from "../../../core/runtime";
import { resolveIntelligenceUser } from "../resolve-intelligence-user";

/**
 * Build a minimal intelligence-runtime stub whose `identifyUser` returns the
 * supplied user. Only the fields `resolveIntelligenceUser` reads are populated.
 */
function setup(user: Awaited<ReturnType<typeof identity>>) {
  const identifyUser = vi.fn().mockResolvedValue(user);
  const runtime = {
    identifyUser,
  } as unknown as CopilotIntelligenceRuntimeLike;
  const request = new Request("https://example.com/intelligence");

  return { runtime, request, identifyUser };
}

// Helper so the `setup` param type tracks the identify result shape.
async function identity() {
  return { id: "u1", name: "User One" } as {
    id: string;
    name: string;
    learningContainers?: {
      readableContainers?: string[];
      writableContainers?: string[];
    };
  };
}

test("passes through learningContainers when identifyUser returns them", async () => {
  const { runtime, request } = setup({
    id: "u1",
    name: "User One",
    learningContainers: {
      readableContainers: ["project", "team-a"],
      writableContainers: ["team-a"],
    },
  });

  const result = await resolveIntelligenceUser({ runtime, request });

  expect(result).toEqual({
    id: "u1",
    name: "User One",
    learningContainers: {
      readableContainers: ["project", "team-a"],
      writableContainers: ["team-a"],
    },
  });
});

test("preserves an empty writableContainers array (write-nowhere)", async () => {
  const { runtime, request } = setup({
    id: "u1",
    name: "User One",
    learningContainers: { writableContainers: [] },
  });

  const result = await resolveIntelligenceUser({ runtime, request });

  expect(result).toEqual({
    id: "u1",
    name: "User One",
    learningContainers: { writableContainers: [] },
  });
});

test("omits learningContainers when identifyUser does not provide them", async () => {
  const { runtime, request } = setup({ id: "u1", name: "User One" });

  const result = await resolveIntelligenceUser({ runtime, request });

  expect(result).toEqual({ id: "u1", name: "User One" });
  expect(result).not.toHaveProperty("learningContainers");
});
