// Test setup file for Vitest
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Mock ResizeObserver which is not available in jsdom
global.ResizeObserver = class ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  callback: ResizeObserverCallback;
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock scrollIntoView which is not available in jsdom
HTMLElement.prototype.scrollIntoView = vi.fn();

// Ensure we cleanup between tests to avoid lingering handles
afterEach(() => {
  cleanup();
});

// Mock @copilotkit/react-core/v2
vi.mock("@copilotkit/react-core/v2", () => ({
  useCopilotKit: vi.fn(() => ({
    copilotkit: {
      properties: {},
      setProperties: vi.fn(),
      runAgent: vi.fn().mockResolvedValue(undefined),
    },
  })),
}));
