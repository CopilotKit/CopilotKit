import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startPlatform } from "./platform.mjs";
import { cases } from "./cases.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Start only the chosen driver, with fixture URLs and no live service keys. */
async function startDriver(
  command,
  cwd,
  platform,
  configuration = {},
  environment = {},
) {
  const inheritedNames = [
    "PATH",
    "HOME",
    "TMPDIR",
    "USER",
    "GEM_HOME",
    "GEM_PATH",
    "DOTNET_ROOT",
    "SYSTEMROOT",
  ];
  const env = Object.fromEntries(
    inheritedNames
      .filter((name) => process.env[name])
      .map((name) => [name, process.env[name]]),
  );
  env.CPK_CONFIG = JSON.stringify({
    port: 0,
    apiUrl: platform.url,
    runnerUrl: `${platform.wsUrl}/runner`,
    clientUrl: `${platform.wsUrl}/client`,
    apiKey: platform.apiKey,
    agentUrl: `${platform.url}/agent`,
    telemetryUrl: `${platform.url}/telemetry`,
    telemetrySampleRate: 1,
    ...configuration,
  });
  env.OPENAI_API_KEY = "fixture-only";
  env.COPILOTKIT_TELEMETRY_DISABLED = "false";
  env.DO_NOT_TRACK = "false";
  for (const [name, value] of Object.entries(environment)) {
    if (
      ![
        "DO_NOT_TRACK",
        "COPILOTKIT_TELEMETRY_DISABLED",
        "COPILOTKIT_TELEMETRY_SAMPLE_RATE",
        "CPK_TELEMETRY_ID",
        "COPILOTKIT_LICENSE_TOKEN",
      ].includes(name)
    )
      throw new Error(`Unsupported fixture environment key: ${name}`);
    env[name] = value;
  }
  const child = spawn(command[0], command.slice(1), {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  const lines = createInterface({ input: child.stdout });
  child.stderr.on("data", (chunk) => {
    logs = (logs + chunk).slice(-8000);
  });
  const closed = new Promise((resolveClose) =>
    child.once("close", resolveClose),
  );
  const stop = async () => {
    lines.close();
    if (child.exitCode !== null || child.signalCode) return;
    child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 3000);
    await closed.catch(() => {});
    clearTimeout(kill);
  };
  try {
    const port = await new Promise((resolvePort, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`Driver did not report port in 30 seconds\n${logs}`),
          ),
        30000,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Driver exited ${code}\n${logs}`));
      });
      lines.on("line", (line) => {
        try {
          const info = JSON.parse(line);
          if (
            Number.isInteger(info.port) &&
            info.port > 0 &&
            info.port < 65536
          ) {
            clearTimeout(timer);
            resolvePort(info.port);
          }
        } catch {
          logs = (logs + line + "\n").slice(-8000);
        }
      });
    });
    return { url: `http://127.0.0.1:${port}/copilotkit`, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** Run each case in a fresh runtime/platform pair and report stable case IDs. */
export async function runSuite(
  command,
  { cwd = root, filter = "", caseTimeoutMs = 60000 } = {},
) {
  const selected = cases.filter((entry) => entry.id.includes(filter));
  if (!selected.length) throw new Error(`No cases match ${filter}`);
  const results = [];
  for (const spec of selected) {
    const platform = await startPlatform();
    let driver;
    const start = Date.now();
    try {
      const configuration =
        typeof spec.configuration === "function"
          ? await spec.configuration(platform)
          : spec.configuration;
      driver = await startDriver(
        command,
        cwd,
        platform,
        configuration,
        spec.environment,
      );
      const request = async (method, path, body, headers = {}) => {
        const response = await fetch(`${driver.url}${path}`, {
          method,
          headers: { "Content-Type": "application/json", ...headers },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(15000),
        });
        const text = await response.text();
        return {
          status: response.status,
          body: text ? JSON.parse(text) : undefined,
          headers: response.headers,
        };
      };
      let timer;
      try {
        await Promise.race([
          spec.run({ request, platform, runtimeUrl: driver.url }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(`Case ${spec.id} exceeded ${caseTimeoutMs}ms`),
                ),
              caseTimeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      results.push({
        id: spec.id,
        status: "passed",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      results.push({
        id: spec.id,
        status: "failed",
        durationMs: Date.now() - start,
        error: error.stack ?? String(error),
      });
    } finally {
      if (driver) await driver.stop();
      await platform.close();
    }
    process.stdout.write(JSON.stringify(results.at(-1)) + "\n");
  }
  return results;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const split = args.indexOf("--");
  if (split < 0 || split === args.length - 1) {
    process.stderr.write(
      "Usage: node tools/runtime-conformance/run.mjs [--filter case-id] [--cwd directory] -- command args...\n",
    );
    process.exitCode = 2;
  } else {
    const value = (flag) => {
      const index = args.slice(0, split).indexOf(flag);
      return index < 0 ? undefined : args[index + 1];
    };
    const results = await runSuite(args.slice(split + 1), {
      filter: value("--filter"),
      cwd: value("--cwd"),
    });
    process.exitCode = results.some((result) => result.status === "failed")
      ? 1
      : 0;
  }
}
