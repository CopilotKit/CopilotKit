#!/usr/bin/env npx tsx
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import net from "node:net";

// stdio is ["ignore", "pipe", "pipe"], so stdin is null and stdout/stderr are
// readable streams. Model that precisely instead of ChildProcessWithoutNullStreams
// (which would wrongly claim a writable stdin).
type ServerProcess = ChildProcessByStdio<null, Readable, Readable>;

// A spawned dev server plus a reader for its captured stdout/stderr tail.
type SpawnedServer = { process: ServerProcess; readOutput: () => string };

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const PYTHON_QUICKSTART = join(
  REPO_ROOT,
  "showcase/shell-docs/src/content/docs/integrations/claude-sdk-python/quickstart.mdx",
);
const TYPESCRIPT_QUICKSTART = join(
  REPO_ROOT,
  "showcase/shell-docs/src/content/docs/integrations/claude-sdk-typescript/quickstart.mdx",
);

type CodeBlock = {
  lang: string;
  title?: string;
  code: string;
};

type RunResult = {
  stdout: string;
  stderr: string;
};

const args = new Set(process.argv.slice(2));
const KEEP_TEMP = args.has("--keep-temp");
const ALLOW_MISSING_RUNTIMES = args.has("--allow-missing-runtimes");
const RUN_PYTHON = !args.has("--skip-python");
const RUN_TYPESCRIPT = !args.has("--skip-typescript");
const LIVE_ANTHROPIC =
  args.has("--live-anthropic") || process.env.CLAUDE_QUICKSTART_LIVE === "1";
const PYTHON_VERSIONS = (process.env.PYTHON_VERSIONS ?? "3.11,3.12")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function usage() {
  console.log(`Usage: npm --prefix showcase/scripts run check-claude-quickstarts:runtime -- [options]

Options:
  --skip-python               Skip Python quickstart checks.
  --skip-typescript           Skip TypeScript quickstart checks.
  --allow-missing-runtimes    Skip missing pythonX.Y commands instead of failing.
  --live-anthropic            Use ANTHROPIC_API_KEY and require RUN_FINISHED.
  --keep-temp                 Keep generated temp projects for inspection.

Environment:
  PYTHON_VERSIONS=3.11,3.12   Python interpreters to test.
  CLAUDE_QUICKSTART_LIVE=1     Equivalent to --live-anthropic.
`);
}

if (args.has("--help")) {
  usage();
  process.exit(0);
}

function parseCodeBlocks(mdx: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const fencePattern = /```([^\n]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(mdx))) {
    const meta = match[1]?.trim() ?? "";
    const code = dedent(match[2] ?? "");
    const [lang = ""] = meta.split(/\s+/, 1);
    const titleMatch = /title=(?:"([^"]+)"|'([^']+)')/.exec(meta);
    const title = titleMatch?.[1] ?? titleMatch?.[2];
    blocks.push({ lang, title, code: code.replace(/\n$/, "") });
  }

  return blocks;
}

function dedent(value: string): string {
  const lines = value.replace(/\t/g, "  ").split(/\r?\n/);
  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();

  const indent = lines
    .filter((line) => line.trim().length > 0)
    .reduce<number | null>((min, line) => {
      const length = line.match(/^ */)?.[0].length ?? 0;
      return min == null ? length : Math.min(min, length);
    }, null);

  if (!indent) return lines.join("\n");
  return lines.map((line) => line.slice(indent)).join("\n");
}

function readBlocks(filePath: string): CodeBlock[] {
  return parseCodeBlocks(readFileSync(filePath, "utf-8"));
}

function blockByTitle(blocks: CodeBlock[], title: string): string {
  const block = blocks.find((candidate) => candidate.title === title);
  if (!block) {
    throw new Error(`Missing code block titled ${title}`);
  }
  return block.code;
}

function bashCommand(blocks: CodeBlock[], startsWith: string): string {
  const command = blocks
    .filter((block) => block.lang === "bash" || block.lang === "sh")
    .flatMap((block) => block.code.split(/\r?\n/).map((line) => line.trim()))
    .find((line) => line.startsWith(startsWith));

  if (!command) {
    throw new Error(`Missing documented command starting with: ${startsWith}`);
  }

  return command;
}

function writeProjectFile(root: string, relativePath: string, content: string) {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${content.trimEnd()}\n`);
}

function splitSimpleCommand(command: string): string[] {
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g);
  if (!parts?.length) {
    throw new Error(`Unable to parse command: ${command}`);
  }
  return parts.map((part) => part.replace(/^"|"$/g, ""));
}

function runCommand(
  command: string,
  commandArgs: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  },
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      // Escalate to SIGKILL if the child ignores SIGTERM, so a stuck process
      // can't linger and keep the event loop alive after we've rejected.
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      reject(
        new Error(
          `${command} ${commandArgs.join(" ")} timed out after ${timeoutMs}ms\n${stderr}`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${commandArgs.join(" ")} exited ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
        ),
      );
    });
  });
}

async function runShellLine(
  commandLine: string,
  cwd: string,
  timeoutMs?: number,
) {
  const [command, ...commandArgs] = splitSimpleCommand(commandLine);
  await runCommand(command, commandArgs, { cwd, timeoutMs });
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await runCommand(command, ["--version"], {
      cwd: REPO_ROOT,
      timeoutMs: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

function currentNodeMajor(): number {
  return Number(process.versions.node.split(".")[0]);
}

function assertCurrentNodeIsSupported() {
  const major = currentNodeMajor();
  if (major !== 20 && major !== 22) {
    throw new Error(
      `Claude SDK TypeScript quickstart must be checked under Node 20 and Node 22; current Node is ${process.version}.`,
    );
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a port"));
        return;
      }
      const port = address.port;
      server.close(() => resolvePromise(port));
    });
  });
}

async function waitForHealth(
  url: string,
  readOutput?: () => string,
  timeoutMs = 20_000,
) {
  const started = Date.now();
  let lastError: unknown;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  }

  // Surface the server's own stdout/stderr (traceback, import error,
  // EADDRINUSE, …) — otherwise lastError is only the client-side ECONNREFUSED
  // and the real reason the server never booted is lost.
  const serverOutput = readOutput
    ? `\n--- server output ---\n${readOutput()}`
    : "";
  throw new Error(
    `Health check never passed for ${url}: ${String(lastError)}${serverOutput}`,
  );
}

function spawnServer(
  command: string,
  commandArgs: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): SpawnedServer {
  const child = spawn(command, commandArgs, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Drain both pipes into a bounded ring buffer. Leaving them unread lets a
  // chatty or crash-looping server fill the OS pipe buffer and block on
  // write(); draining also captures the output we surface on health failure.
  const tail: string[] = [];
  const record = (chunk: Buffer) => {
    tail.push(chunk.toString());
    if (tail.length > 400) tail.splice(0, tail.length - 400);
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  return { process: child, readOutput: () => tail.join("") };
}

async function stopServer(child: ServerProcess) {
  if (child.exitCode != null || child.signalCode != null) return;

  await new Promise<void>((resolvePromise) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise();
    }, 3_000);
    child.once("close", () => {
      clearTimeout(timer);
      resolvePromise();
    });
    child.kill("SIGTERM");
  });
}

function buildRunInput(threadId: string) {
  return {
    threadId,
    runId: randomUUID(),
    state: {},
    messages: [
      {
        id: randomUUID(),
        role: "user",
        content: "Reply with one short sentence.",
      },
    ],
    tools: [],
    context: [],
    forwardedProps: {},
  };
}

function parseSse(text: string): unknown[] {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean);

  if (dataLines.length === 0) {
    throw new Error(`SSE response did not contain data lines:\n${text}`);
  }

  return dataLines
    .filter((line) => line !== "[DONE]")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid SSE JSON data line ${line}: ${String(error)}`,
          { cause: error },
        );
      }
    });
}

function assertAgUiTermination(
  events: unknown[],
  bodyText: string,
  options: { allowRunError: boolean },
) {
  const types = events
    .map((event) =>
      event && typeof event === "object" && "type" in event
        ? String((event as { type: unknown }).type)
        : "",
    )
    .filter(Boolean);

  const hasFinished = types.includes("RUN_FINISHED");
  const hasRunError = types.includes("RUN_ERROR");
  if (!hasFinished && (!options.allowRunError || !hasRunError)) {
    throw new Error(
      `Expected ${options.allowRunError ? "RUN_FINISHED or RUN_ERROR" : "RUN_FINISHED"} in AG-UI stream, got ${types.join(", ") || "(none)"}`,
    );
  }

  // bodyText is the raw SSE payload; a JS stack trace embedded in a JSON
  // message field has its newlines escaped as the literal two chars "\n", so
  // match both a real newline and an escaped one before the "at …(" frame.
  if (
    /Traceback \(most recent call last\)|(?:\n|\\n)\s+at\s+\S+\s+\(/.test(
      bodyText,
    )
  ) {
    throw new Error(`AG-UI stream leaked a raw stack trace:\n${bodyText}`);
  }
}

async function postAgUiRun(
  url: string,
  threadId: string,
  headers: Record<string, string> = {},
  options: { allowRunError?: boolean } = {},
) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(buildRunInput(threadId)),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(
      `AG-UI POST failed with ${response.status}: ${await response.text()}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error(`Expected text/event-stream, got ${contentType}`);
  }

  const text = await response.text();
  const events = parseSse(text);
  assertAgUiTermination(events, text, {
    allowRunError: options.allowRunError ?? true,
  });
  return { contentType, events, text };
}

function assertRuntimeRouteContract(blocks: CodeBlock[]) {
  const route = blockByTitle(blocks, "app/api/copilotkit/route.ts");
  if (!/export\s+const\s+POST\s*=/.test(route)) {
    throw new Error("CopilotKit runtime route must export POST");
  }
  if (/export\s+const\s+GET\s*=/.test(route)) {
    throw new Error(
      "Quickstart should not document a GET /api/copilotkit info route",
    );
  }
}

async function checkTypeScriptQuickstart() {
  assertCurrentNodeIsSupported();
  if (LIVE_ANTHROPIC && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("--live-anthropic requires ANTHROPIC_API_KEY");
  }
  const blocks = readBlocks(TYPESCRIPT_QUICKSTART);
  assertRuntimeRouteContract(blocks);

  const root = mkdtempSync(join(tmpdir(), "claude-sdk-ts-"));
  console.log(`[ts] temp project: ${root}`);

  try {
    writeProjectFile(
      root,
      "package.json",
      JSON.stringify(
        {
          private: true,
          type: "module",
          scripts: {
            typecheck: "tsc --noEmit",
            start: "tsx src/agent-server.ts",
          },
        },
        null,
        2,
      ),
    );
    writeProjectFile(
      root,
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            noEmit: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
    );
    writeProjectFile(
      root,
      "src/agent-server.ts",
      blockByTitle(blocks, "src/agent-server.ts"),
    );

    await runShellLine(
      bashCommand(blocks, "npm install @anthropic-ai/claude-agent-sdk"),
      root,
      180_000,
    );
    await runShellLine(
      bashCommand(blocks, "npm install -D typescript"),
      root,
      180_000,
    );

    await runShellLine("npm run typecheck", root, 120_000);

    const port = await getFreePort();
    const server = spawnServer("npm", ["run", "start"], {
      cwd: root,
      env: {
        AGENT_PORT: String(port),
        ANTHROPIC_API_KEY: LIVE_ANTHROPIC
          ? process.env.ANTHROPIC_API_KEY
          : "test-key",
        CLAUDE_MODEL: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6",
      },
    });

    try {
      await waitForHealth(`http://127.0.0.1:${port}/health`, server.readOutput);
      await postAgUiRun(
        `http://127.0.0.1:${port}/`,
        "thread-ts",
        {},
        {
          allowRunError: !LIVE_ANTHROPIC,
        },
      );

      // postAgUiRun throws unless the response is text/event-stream, so this
      // asserts the server keeps emitting SSE even when the client requests
      // protobuf via Accept. (A dedicated content-type check here would be
      // dead code — postAgUiRun can never return a non-SSE content type.)
      await postAgUiRun(
        `http://127.0.0.1:${port}/`,
        "thread-ts-proto",
        {
          Accept: "application/vnd.ag-ui.event+proto",
        },
        {
          allowRunError: !LIVE_ANTHROPIC,
        },
      );
    } finally {
      await stopServer(server.process);
    }
  } finally {
    if (!KEEP_TEMP) rmSync(root, { recursive: true, force: true });
  }
}

async function checkPythonVersion(version: string) {
  if (LIVE_ANTHROPIC && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("--live-anthropic requires ANTHROPIC_API_KEY");
  }
  const pythonCommand = `python${version}`;
  if (!(await commandExists(pythonCommand))) {
    const message = `[python ${version}] missing ${pythonCommand}`;
    if (ALLOW_MISSING_RUNTIMES) {
      console.warn(
        `${message}; skipping because --allow-missing-runtimes is set`,
      );
      return;
    }
    throw new Error(message);
  }

  if (!(await commandExists("uv"))) {
    throw new Error("Python quickstart runtime check requires uv");
  }

  const blocks = readBlocks(PYTHON_QUICKSTART);
  assertRuntimeRouteContract(blocks);

  const root = mkdtempSync(
    join(tmpdir(), `claude-sdk-py${version.replace(".", "")}-`),
  );
  console.log(`[python ${version}] temp project: ${root}`);

  try {
    await runCommand("uv", ["init", "--bare", "--python", pythonCommand], {
      cwd: root,
      timeoutMs: 60_000,
    });

    writeProjectFile(root, "main.py", blockByTitle(blocks, "main.py"));

    const [command, ...commandArgs] = splitSimpleCommand(
      bashCommand(blocks, "uv add "),
    );
    await runCommand(command, commandArgs, { cwd: root, timeoutMs: 180_000 });

    await runCommand(
      "uv",
      [
        "run",
        "--python",
        pythonCommand,
        "python",
        "-m",
        "py_compile",
        "main.py",
      ],
      {
        cwd: root,
        timeoutMs: 60_000,
      },
    );
    await runCommand(
      "uv",
      ["run", "--python", pythonCommand, "python", "-c", "import main"],
      {
        cwd: root,
        timeoutMs: 60_000,
      },
    );

    const port = await getFreePort();
    const server = spawnServer(
      "uv",
      [
        "run",
        "--python",
        pythonCommand,
        "uvicorn",
        "main:app",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: root,
        env: {
          ANTHROPIC_API_KEY: LIVE_ANTHROPIC
            ? process.env.ANTHROPIC_API_KEY
            : "test-key",
          ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        },
      },
    );

    try {
      await waitForHealth(`http://127.0.0.1:${port}/health`, server.readOutput);
      const threadId = `thread-py-${version}`;
      await postAgUiRun(
        `http://127.0.0.1:${port}/`,
        threadId,
        {},
        {
          allowRunError: !LIVE_ANTHROPIC,
        },
      );
      await postAgUiRun(
        `http://127.0.0.1:${port}/`,
        threadId,
        {},
        {
          allowRunError: !LIVE_ANTHROPIC,
        },
      );
    } finally {
      await stopServer(server.process);
    }
  } finally {
    if (!KEEP_TEMP) rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  if (RUN_TYPESCRIPT) {
    console.log(
      `[ts] checking Claude SDK TypeScript quickstart on Node ${process.version}`,
    );
    await checkTypeScriptQuickstart();
  }

  if (RUN_PYTHON) {
    for (const version of PYTHON_VERSIONS) {
      console.log(`[python ${version}] checking Claude SDK Python quickstart`);
      await checkPythonVersion(version);
    }
  }

  console.log("Claude SDK quickstart runtime checks passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
