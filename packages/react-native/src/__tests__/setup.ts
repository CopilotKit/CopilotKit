import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// React Native global — always true in test environment
(globalThis as any).__DEV__ = true;

afterEach(() => {
  cleanup();
});
