import { describe, test, expect, jest, beforeEach } from "@jest/globals";
import spawn from "cross-spawn";

jest.mock("cross-spawn", () => ({
  __esModule: true,
  default: {
    sync: jest.fn(),
  },
}));

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

jest.mock("inquirer", () => ({
  __esModule: true,
  default: {
    prompt: jest.fn().mockResolvedValue({ scope: "project" } as never),
  },
}));

describe("skill onboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("syncs skills before printing onboarding instructions", async () => {
    const mockSync = spawn.sync as jest.MockedFunction<typeof spawn.sync>;
    mockSync.mockReturnValue({
      status: 0,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const { default: SkillOnboard } =
      await import("../../../src/commands/skill/onboard.js");

    const cmd = new SkillOnboard([], {} as any);
    const logOutput: string[] = [];
    cmd.log = jest.fn((msg?: string) => {
      if (msg !== undefined) logOutput.push(msg);
    }) as any;
    // @ts-expect-error - accessing protected method for testing
    cmd.parse = jest.fn().mockResolvedValue({
      flags: { global: false },
      args: {},
    });

    await cmd.run();

    // Verify sync was called
    expect(mockSync).toHaveBeenCalledWith(
      "npx",
      ["skills", "add", "copilotkit/skills", "--full-depth", "-y"],
      { stdio: "inherit" },
    );

    // Verify onboarding instructions are printed after sync
    const output = logOutput.join("\n");
    expect(output).toContain("Help me onboard to CopilotKit");
    expect(output).toContain("AI coding agent");
  });

  test("passes --global flag through to sync", async () => {
    const mockSync = spawn.sync as jest.MockedFunction<typeof spawn.sync>;
    mockSync.mockReturnValue({
      status: 0,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const { default: SkillOnboard } =
      await import("../../../src/commands/skill/onboard.js");

    const cmd = new SkillOnboard([], {} as any);
    cmd.log = jest.fn() as any;
    // @ts-expect-error - accessing protected method for testing
    cmd.parse = jest.fn().mockResolvedValue({
      flags: { global: true },
      args: {},
    });

    await cmd.run();

    expect(mockSync).toHaveBeenCalledWith(
      "npx",
      ["skills", "add", "copilotkit/skills", "--full-depth", "-y", "--global"],
      { stdio: "inherit" },
    );
  });

  test("fails gracefully when sync fails", async () => {
    const mockSync = spawn.sync as jest.MockedFunction<typeof spawn.sync>;
    mockSync.mockReturnValue({
      status: 1,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const { default: SkillOnboard } =
      await import("../../../src/commands/skill/onboard.js");

    const cmd = new SkillOnboard([], {} as any);
    cmd.log = jest.fn() as any;
    // @ts-expect-error - accessing protected method for testing
    cmd.parse = jest.fn().mockResolvedValue({
      flags: { global: false },
      args: {},
    });

    const mockExit = jest
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await cmd.run();

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });
});
