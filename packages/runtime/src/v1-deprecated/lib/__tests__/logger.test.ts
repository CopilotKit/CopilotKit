import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPinoLogger } = vi.hoisted(() => ({
  createPinoLogger: vi.fn(() => ({
    child: vi.fn(() => ({ __child: true })),
  })),
}));

vi.mock("pino", () => ({ default: createPinoLogger }));
vi.mock("pino-pretty", () => ({ default: vi.fn(() => ({ __stream: true })) }));

import { createLogger } from "../logger";

function optionsPassedToPino() {
  expect(createPinoLogger).toHaveBeenCalled();
  return createPinoLogger.mock.calls.at(-1)![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LOG_LEVEL;
});

describe("createLogger", () => {
  // Regression guard for issue #2355. pino 9 hands `redact.paths` to
  // fast-redact, which validates each path by calling `Function(...)`.
  // Cloudflare Workers and other edge runtimes forbid code generation from
  // strings, so building the logger throws there and the validator blames the
  // first path in the array ("invalid path (pid)"). Any redact path fails, not
  // just `pid`, so the only safe configuration is to pass none.
  //
  // This monorepo pins pino to 10 through a pnpm override, and pino 10 swapped
  // fast-redact for @pinojs/redact, which uses no code generation. That means
  // the failure cannot be reproduced by running a logger here; the assertion
  // has to be on the options we hand pino.
  it("passes no redact option to pino, because redact paths need code generation", () => {
    createLogger();

    expect(optionsPassedToPino()).not.toHaveProperty("redact");
  });

  it("suppresses pid and hostname with base instead", () => {
    createLogger();

    expect(optionsPassedToPino().base).toBeNull();
  });

  it("defaults to the error level and honours LOG_LEVEL over the argument", () => {
    createLogger();
    expect(optionsPassedToPino().level).toBe("error");

    createLogger({ level: "warn" });
    expect(optionsPassedToPino().level).toBe("warn");

    process.env.LOG_LEVEL = "debug";
    createLogger({ level: "warn" });
    expect(optionsPassedToPino().level).toBe("debug");
  });

  it("returns a child logger only when a component is named", () => {
    const plain = createLogger();
    expect(plain).not.toHaveProperty("__child");

    const scoped = createLogger({ component: "copilotkit-debug" });
    expect(scoped).toHaveProperty("__child", true);
  });
});
