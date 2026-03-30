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

describe("skill sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("calls npx skills add with correct arguments for project scope", async () => {
    const mockSync = spawn.sync as jest.MockedFunction<typeof spawn.sync>;
    mockSync.mockReturnValue({
      status: 0,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const { default: SkillSync } =
      await import("../../../src/commands/skill/sync.js");

    const cmd = new SkillSync([], {} as any);
    cmd.log = jest.fn() as any;
    // @ts-expect-error - accessing protected method for testing
    cmd.parse = jest.fn().mockResolvedValue({
      flags: { global: false },
      args: {},
    });

    await cmd.run();

    expect(mockSync).toHaveBeenCalledWith(
      "npx",
      ["skills", "add", "copilotkit/skills", "--full-depth", "-y"],
      { stdio: "inherit" },
    );
  });

  test("passes --global flag when specified", async () => {
    const mockSync = spawn.sync as jest.MockedFunction<typeof spawn.sync>;
    mockSync.mockReturnValue({
      status: 0,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const { default: SkillSync } =
      await import("../../../src/commands/skill/sync.js");

    const cmd = new SkillSync([], {} as any);
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

  test("passes --agent flags when specified", async () => {
    const mockSync = spawn.sync as jest.MockedFunction<typeof spawn.sync>;
    mockSync.mockReturnValue({
      status: 0,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const { default: SkillSync } =
      await import("../../../src/commands/skill/sync.js");

    const cmd = new SkillSync([], {} as any);
    cmd.log = jest.fn() as any;
    // @ts-expect-error - accessing protected method for testing
    cmd.parse = jest.fn().mockResolvedValue({
      flags: { global: true, agent: ["claude-code", "cursor"] },
      args: {},
    });

    await cmd.run();

    expect(mockSync).toHaveBeenCalledWith(
      "npx",
      [
        "skills",
        "add",
        "copilotkit/skills",
        "--full-depth",
        "-y",
        "--global",
        "--agent",
        "claude-code",
        "cursor",
      ],
      { stdio: "inherit" },
    );
  });

  test("reports error when spawn returns non-zero exit code", async () => {
    const mockSync = spawn.sync as jest.MockedFunction<typeof spawn.sync>;
    mockSync.mockReturnValue({
      status: 1,
      signal: null,
      output: [],
      pid: 1234,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    });

    const { default: SkillSync } =
      await import("../../../src/commands/skill/sync.js");

    const cmd = new SkillSync([], {} as any);
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
