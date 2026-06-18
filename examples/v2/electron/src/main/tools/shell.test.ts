import { describe, it, expect, vi } from "vitest";
import { formatShellCommand, runShell } from "./shell";
import type { ShellResult } from "./shell";

describe("formatShellCommand", () => {
  it("renders a bare command with no args", () => {
    expect(formatShellCommand("ls", [])).toBe("ls");
  });

  it("renders a command with plain args (no whitespace)", () => {
    expect(formatShellCommand("ls", ["-la", "src"])).toBe("ls -la src");
  });

  it("wraps an arg in double-quotes when it contains whitespace", () => {
    expect(formatShellCommand("cat", ["my file.txt"])).toBe(
      'cat "my file.txt"',
    );
  });
});

describe("runShell", () => {
  it("passes command, args, and cwd to the exec function", async () => {
    const fakeExec = vi.fn<Parameters<typeof runShell>[0]["exec"] & {}>(
      async (): Promise<ShellResult> => ({
        stdout: "hello",
        stderr: "",
        exitCode: 0,
      }),
    );

    await runShell({
      command: "echo",
      args: ["hello"],
      cwd: "/tmp",
      exec: fakeExec,
    });

    expect(fakeExec).toHaveBeenCalledOnce();
    expect(fakeExec).toHaveBeenCalledWith("echo", ["hello"], "/tmp");
  });

  it("returns the stdout, stderr, and exitCode from the exec function", async () => {
    const fakeExec = vi.fn(
      async (): Promise<ShellResult> => ({
        stdout: "output text",
        stderr: "error text",
        exitCode: 0,
      }),
    );

    const result = await runShell({
      command: "echo",
      args: [],
      cwd: "/tmp",
      exec: fakeExec,
    });

    expect(result).toEqual({
      stdout: "output text",
      stderr: "error text",
      exitCode: 0,
    });
  });

  it("propagates a non-zero exitCode from the exec function", async () => {
    const fakeExec = vi.fn(
      async (): Promise<ShellResult> => ({
        stdout: "",
        stderr: "command not found",
        exitCode: 127,
      }),
    );

    const result = await runShell({
      command: "nonexistent",
      args: [],
      cwd: "/tmp",
      exec: fakeExec,
    });

    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe("command not found");
  });
});
