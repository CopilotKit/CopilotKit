import { vi } from "vitest";
import { z } from "zod";

// Mock modules that cause ES module issues
vi.mock("@segment/analytics-node", () => ({
  Analytics: vi.fn().mockImplementation(() => ({
    track: vi.fn(),
    identify: vi.fn(),
    page: vi.fn(),
    group: vi.fn(),
    alias: vi.fn(),
  })),
}));

vi.mock("@copilotkit/shared", () => ({
  parseJson: vi.fn((jsonString, defaultValue) => {
    try {
      return JSON.parse(jsonString);
    } catch {
      return defaultValue;
    }
  }),
  dataToUUID: vi.fn((data) => JSON.stringify(data)),
  getZodParameters: vi.fn(() => z.object({})),
  randomId: vi.fn(() => "test-random-id"),
  CopilotKitAgentDiscoveryError: vi.fn(),
  randomUUID: vi.fn(() => "mock-thread-id"),
}));

// Mock react-dom/test-utils to avoid compatibility issues
vi.mock("react-dom/test-utils", () => ({
  act: vi.fn((fn) => fn()),
}));
