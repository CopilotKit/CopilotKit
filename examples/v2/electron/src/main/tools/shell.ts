import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(nodeExecFile);

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ShellExec = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<ShellResult>;

export function formatShellCommand(command: string, args: string[]): string {
  const parts = [
    command,
    ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)),
  ];
  return parts.join(" ").trim();
}

const defaultExec: ShellExec = async (
  command: string,
  args: string[],
  cwd: string,
): Promise<ShellResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd });
    return { stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 };
  } catch (err: unknown) {
    const error = err as {
      stdout?: string;
      stderr?: string;
      code?: unknown;
    } | null;
    const exitCode =
      typeof error?.code === "number" ? error.code : error ? 1 : 0;
    return {
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
      exitCode,
    };
  }
};

export async function runShell(opts: {
  command: string;
  args: string[];
  cwd: string;
  exec?: ShellExec;
}): Promise<ShellResult> {
  const exec = opts.exec ?? defaultExec;
  return exec(opts.command, opts.args, opts.cwd);
}
