// Import reflect-metadata to support TypeGraphQL
import "reflect-metadata";

import { vi } from "vitest";

// Suppress console output during tests
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
