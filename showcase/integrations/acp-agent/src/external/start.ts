import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";

const startChild = (command: string, args: readonly string[]): ChildProcess =>
  spawn(command, args, { stdio: "inherit" });

const relay = startChild("node_modules/.bin/tsx", [
  "src/external/start-relay.ts",
]);
const web = startChild("node_modules/.bin/next", ["start"]);
const children = [relay, web] as const;
let stopping = false;

/** Forwards one container stop signal to both Showcase fixture processes. */
const stopChildren = (signal: NodeJS.Signals): void => {
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => stopChildren(signal));
}

/** Keeps the container alive until either fixture process exits. */
const main = async (): Promise<void> => {
  const firstExit = await Promise.race(
    children.map(async (child) => {
      const [code, signal] = (await once(child, "close")) as [
        number | null,
        NodeJS.Signals | null,
      ];
      return { code, signal };
    }),
  );

  if (!stopping) stopChildren("SIGTERM");
  await Promise.allSettled(
    children.map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) {
        await once(child, "close");
      }
    }),
  );
  process.exitCode = firstExit.code ?? (firstExit.signal ? 1 : 0);
};

main().catch((error: unknown) => {
  console.error("ACP Showcase process supervisor failed", error);
  if (!stopping) stopChildren("SIGTERM");
  process.exitCode = 1;
});
