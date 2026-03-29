import { describe, test, expect, jest } from "@jest/globals";

jest.mock("@sentry/node", () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    captureException: jest.fn(),
    close: jest.fn(),
  },
  consoleIntegration: jest.fn(),
}));

jest.mock("superjson", () => ({
  __esModule: true,
  default: { serialize: jest.fn(), deserialize: jest.fn() },
}));

jest.mock("@trpc/client", () => ({
  __esModule: true,
  createTRPCClient: jest.fn(),
  httpBatchLink: jest.fn(),
}));

describe("skill onboard", () => {
  test("prints onboarding instructions", async () => {
    const { default: SkillOnboard } =
      await import("../../../src/commands/skill/onboard.js");

    const cmd = new SkillOnboard([], {} as any);
    const logOutput: string[] = [];
    cmd.log = jest.fn((msg?: string) => {
      if (msg !== undefined) logOutput.push(msg);
    }) as any;
    // @ts-expect-error - accessing protected method for testing
    cmd.parse = jest.fn().mockResolvedValue({ flags: {}, args: {} });

    await cmd.run();

    const output = logOutput.join("\n");
    expect(output).toContain("onboard me");
    expect(output).toContain("Claude Code");
  });
});
