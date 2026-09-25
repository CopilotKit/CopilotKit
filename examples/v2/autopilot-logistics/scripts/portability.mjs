import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Allocate a separate loopback port so an existing demo cannot masquerade as
// the packed consumer. A bind failure below is fatal, never a passing probe.
const reservation = createServer();
await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", resolve);
});
const port = reservation.address().port;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);
const baseUrl = `http://127.0.0.1:${port}`;
const app = process.cwd();
const root = resolve(app, "../../..");
const packagesDir = join(root, "packages");
const evidence = join(root, ".context/autopilot-evidence/portability");
mkdirSync(evidence, { recursive: true });
const consumer = mkdtempSync(join(tmpdir(), "copilotkit-autopilot-portable-"));
const packs = join(consumer, "packs");
mkdirSync(packs);
const report = {
  commit: "",
  consumer,
  baseUrl,
  packages: [],
  checks: [],
  status: "running",
};
const log = [];
function command(program, args, cwd, env = process.env) {
  const result = spawnSync(program, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
  });
  log.push(
    `$ ${program} ${args.join(" ")}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
  );
  if (result.status !== 0)
    throw new Error(
      `${program} ${args[0]} failed (${result.status ?? result.error?.message})`,
    );
  return result.stdout;
}
function save() {
  writeFileSync(
    join(evidence, "portability.json"),
    JSON.stringify(report, null, 2),
  );
  writeFileSync(join(evidence, "portability.log"), log.join("\n"));
}
try {
  report.commit = command("git", ["rev-parse", "HEAD"], root).trim();
  report.sourceState = command("git", ["status", "--porcelain"], root).trim()
    ? "uncommitted changes"
    : "clean commit";
  const available = new Map();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = join(packagesDir, entry.name, "package.json");
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (pkg.name?.startsWith("@copilotkit/"))
        available.set(pkg.name, { dir: join(packagesDir, entry.name), pkg });
    }
  }
  const required = new Set();
  function add(name) {
    if (required.has(name)) return;
    const found = available.get(name);
    if (!found) throw new Error(`Workspace package ${name} is missing`);
    required.add(name);
    for (const [dependency, version] of Object.entries({
      ...found.pkg.dependencies,
      ...found.pkg.optionalDependencies,
      ...found.pkg.peerDependencies,
    })) {
      if (String(version).startsWith("workspace:")) add(dependency);
    }
  }
  for (const name of [
    "@copilotkit/core",
    "@copilotkit/react-core",
    "@copilotkit/runtime",
    "@copilotkit/web-inspector",
  ])
    add(name);
  const artifacts = new Map();
  for (const name of [...required].sort()) {
    const { dir, pkg } = available.get(name);
    const packed = JSON.parse(
      command("pnpm", ["pack", "--pack-destination", packs, "--json"], dir),
    );
    const artifact = join(packs, basename(packed.filename));
    const sha256 = createHash("sha256")
      .update(readFileSync(artifact))
      .digest("hex");
    report.packages.push({
      name,
      version: pkg.version,
      file: basename(artifact),
      sha256,
      bytes: readFileSync(artifact).length,
    });
    artifacts.set(name, basename(artifact));
  }
  for (const entry of readdirSync(app, { withFileTypes: true })) {
    if (
      [
        "node_modules",
        ".next",
        "data",
        "test-results",
        "playwright-report",
        ".env",
        ".env.local",
        "package.json",
      ].includes(entry.name)
    )
      continue;
    cpSync(join(app, entry.name), join(consumer, entry.name), {
      recursive: true,
    });
  }
  const manifest = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  delete manifest.nx;
  for (const [name, file] of artifacts) {
    manifest.dependencies[name] = `file:./packs/${file}`;
    if (manifest.devDependencies?.[name]?.startsWith("workspace:"))
      manifest.devDependencies[name] = `file:./packs/${file}`;
  }
  manifest.pnpm = {
    overrides: Object.fromEntries(
      [...artifacts].map(([name, file]) => [name, `file:./packs/${file}`]),
    ),
  };
  manifest.scripts.start = `next start --hostname 127.0.0.1 --port ${port}`;
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(manifest, null, 2),
  );
  if (existsSync(join(app, ".env"))) process.loadEnvFile(join(app, ".env"));
  if (existsSync(join(app, ".env.local")))
    process.loadEnvFile(join(app, ".env.local"));
  if (!process.env.OPENAI_API_KEY || !process.env.CPK_INTELLIGENCE_API_KEY)
    throw new Error("Live credential names are missing");
  const isolatedEnv = {
    ...process.env,
    NORTHSTAR_DB_PATH: join(consumer, "data/northstar.sqlite"),
    AUTOPILOT_BASE_URL: baseUrl,
    AUTOPILOT_EVIDENCE_ROOT: join(evidence, "live"),
  };
  command("pnpm", ["install", "--no-frozen-lockfile"], consumer, isolatedEnv);
  report.checks.push("isolated install passed");
  save();
  for (const name of required) {
    const path = realpathSync(
      join(consumer, "node_modules", ...name.split("/")),
    );
    if (!path.startsWith(join(realpathSync(consumer), "node_modules")))
      throw new Error(`${name} resolves outside the consumer`);
    report.packages.find((item) => item.name === name).resolvedPath = path;
  }
  command("pnpm", ["run", "check-types"], consumer, isolatedEnv);
  report.checks.push("isolated type check passed");
  save();
  command("pnpm", ["run", "build"], consumer, isolatedEnv);
  report.checks.push("isolated production build passed");
  save();
  command("pnpm", ["run", "reset"], consumer, isolatedEnv);
  const server = spawn("pnpm", ["run", "start"], {
    cwd: consumer,
    env: isolatedEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  try {
    let ready = false;
    for (let index = 0; index < 100; index++) {
      if (server.exitCode !== null)
        throw new Error(`Isolated server exited (${server.exitCode})`);
      try {
        if ((await fetch(`${baseUrl}/sign-in`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(300);
    }
    if (!ready)
      throw new Error("Isolated production server did not become ready");
    report.checks.push("isolated server reachable");
    save();
    command(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "tests/connection.spec.ts",
        "tests/autopilot-read.spec.ts",
        "tests/autopilot-navigation.spec.ts",
        "tests/autopilot-create.spec.ts",
        "tests/autopilot-edit.spec.ts",
        "tests/autopilot-cancel.spec.ts",
        "tests/inspector.spec.ts",
      ],
      consumer,
      isolatedEnv,
    );
    report.checks.push("isolated live browser/SQL sequence passed");
  } finally {
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    log.push(`Isolated server output:\n${serverOutput}`);
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (report.status === "passed") {
    rmSync(consumer, { recursive: true, force: true });
    report.consumerRemoved = true;
  }
  save();
}
if (report.status !== "passed") process.exitCode = 1;
