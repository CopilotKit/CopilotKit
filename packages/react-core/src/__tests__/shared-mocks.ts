import { vi } from "vitest";
import { z } from "zod";

vi.mock("@copilotkit/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@copilotkit/shared")>();
  return {
    ...actual,
    parseJson: vi.fn((jsonString, defaultValue) => {
      try {
        return JSON.parse(jsonString);
      } catch {
        return defaultValue;
      }
    }),
    getZodParameters: vi.fn(() => z.object({})),
    randomId: vi.fn(() => "test-random-id"),
    CopilotKitAgentDiscoveryError: vi.fn(),
    randomUUID: vi.fn(() => "mock-thread-id"),
  };
});

// Mock react-dom/test-utils to avoid compatibility issues
vi.mock("react-dom/test-utils", () => ({
  act: vi.fn((fn) => fn()),
}));
