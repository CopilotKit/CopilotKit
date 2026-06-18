import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { ToolCallStatus } from "@copilotkit/core";
import { z } from "zod";
import { ApprovalCard } from "./ApprovalCard";

export function useLocalTools(): void {
  useHumanInTheLoop<{ path: string; content: string }>({
    name: "fs_write",
    description: "Write content to a file on disk",
    parameters: z.object({ path: z.string(), content: z.string() }),
    render: ({ args, status, result, respond }) => {
      const detail = `${args?.path ?? ""}\n\n${args?.content ?? ""}`;

      if (status === ToolCallStatus.Executing && respond) {
        return (
          <ApprovalCard
            title="Write file?"
            detail={detail}
            onApprove={async () => {
              try {
                const res = await window.electron.fs.write(
                  args.path,
                  args.content,
                );
                await respond(
                  JSON.stringify({ approved: true, wrote: res.path }),
                );
              } catch (e) {
                await respond(
                  JSON.stringify({ approved: true, error: String(e) }),
                );
              }
            }}
            onDeny={() => void respond(JSON.stringify({ approved: false }))}
          />
        );
      }

      return (
        <ApprovalCard
          title="Write file?"
          detail={detail}
          outcome={typeof result === "string" ? result : undefined}
        />
      );
    },
  });

  useHumanInTheLoop<{ command: string; args?: string[] }>({
    name: "shell_run",
    description: "Run a shell command",
    parameters: z.object({
      command: z.string(),
      args: z.array(z.string()).optional(),
    }),
    render: ({ args, status, result, respond }) => {
      const argv = args?.args ?? [];
      const detail = [args?.command, ...argv].join(" ");

      if (status === ToolCallStatus.Executing && respond) {
        return (
          <ApprovalCard
            title="Run shell command?"
            detail={detail}
            onApprove={async () => {
              const res = await window.electron.shell.run(args.command, argv);
              await respond(
                JSON.stringify({
                  approved: true,
                  command: res.command,
                  exitCode: res.exitCode,
                  stdout: res.stdout.slice(0, 4000),
                  stderr: res.stderr.slice(0, 4000),
                }),
              );
            }}
            onDeny={() => void respond(JSON.stringify({ approved: false }))}
          />
        );
      }

      return (
        <ApprovalCard
          title="Run shell command?"
          detail={detail}
          outcome={typeof result === "string" ? result : undefined}
        />
      );
    },
  });
}
