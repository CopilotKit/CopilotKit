// Import reflect-metadata to support TypeGraphQL
import "reflect-metadata";

// Import Jest types and functions
import {
  jest,
  describe,
  expect,
  it,
  test,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "@jest/globals";

// Suppress console output during tests
jest.spyOn(console, "log").mockImplementation(() => {});
jest.spyOn(console, "error").mockImplementation(() => {});

// The global types are already declared in global.d.ts, so we don't need to set globals here
