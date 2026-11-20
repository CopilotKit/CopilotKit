// entrypoint-watchdog.test.ts — CI gate for the dual-process container
// watchdog in every showcase integration's entrypoint.sh.
//
// Why this exists: the public-$PORT guard was added to claude-sdk-python in
// July 2026 and to nowhere else, so 18 integrations spent months able to serve
// 502s from a wedged Next.js while Railway still reported the service Online
// (its healthcheck reached the still-alive agent). Nothing detected the drift,
// because nothing asserted the guard fleet-wide.
//
// The mechanism itself — detect, alert, kill the right PID — is proven against
// the REAL extracted guard by showcase/tests/repro/stdout-wedge/watchdog-fleet.sh.
// This suite is the cheap always-on half: it proves the guard is PRESENT and
// structurally intact in every dual-process entrypoint, and that the
// create-integration scaffolder emits it for new integrations.

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const INTEGRATIONS = path.resolve(__dirname, "../../integrations");

interface Entrypoint {
  slug: string;
  source: string;
}

/**
 * `wait -n` is the dual-process marker: the entrypoint supervises an agent AND
 * Next.js, so a hang in either can strand the container. Single-process
 * integrations (`exec next start`) have one process whose death Railway already
 * observes, and carry no watchdog.
 */
function dualProcessEntrypoints(): Entrypoint[] {
  return fs
    .readdirSync(INTEGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => ({
      slug: e.name,
      file: path.join(INTEGRATIONS, e.name, "entrypoint.sh"),
    }))
    .filter((e) => fs.existsSync(e.file))
    .map((e) => ({ slug: e.slug, source: fs.readFileSync(e.file, "utf8") }))
    .filter((e) => e.source.includes("wait -n"));
}

/**
 * Shell code only — comment lines dropped, so prose cannot satisfy or fail a
 * code assertion.
 */
function codeOnly(shell: string): string {
  return shell
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/**
 * The guard block: from its comment header to the `fi` that closes it at the
 * same indentation. Returned verbatim so the assertions below read the real
 * shell, not a paraphrase of it.
 */
function extractGuard(source: string): string | null {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => l.includes("# Public front door guard"));
  if (start === -1) return null;
  const indent = lines[start].match(/^[ \t]*/)![0];
  const end = lines.findIndex((l, n) => n > start && l === `${indent}fi`);
  if (end === -1) return null;
  return lines.slice(start, end + 1).join("\n");
}

const entrypoints = dualProcessEntrypoints();

describe("dual-process entrypoint watchdogs", () => {
  it("finds the dual-process integrations to gate", () => {
    // Guards the guard: if discovery silently returned [], every per-slug
    // assertion below would vacuously pass.
    expect(entrypoints.length).toBeGreaterThanOrEqual(19);
  });

  describe.each(entrypoints.map((e) => [e.slug, e.source] as const))(
    "%s",
    (slug, source) => {
      const guard = extractGuard(source);

      it("has a public $PORT front-door guard", () => {
        expect(
          guard,
          `${slug}/entrypoint.sh supervises two processes but only probes the ` +
            `agent. A wedged Next.js would serve 502s indefinitely while the ` +
            `container stays up. Port the guard from claude-sdk-python.`,
        ).not.toBeNull();
      });

      it("probes /api/health on the public port", () => {
        // The port must come from $PORT — a hardcoded port would probe the
        // wrong listener on Railway, where $PORT is assigned at runtime.
        expect(guard).toMatch(
          /curl -fsS --max-time 5 "http:\/\/127\.0\.0\.1:\$\{PORT(:-\d+)?\}\/api\/health"/,
        );
      });

      it("counts strikes on its own counter", () => {
        // A shared counter would let a flapping agent kill the frontend.
        expect(guard).toContain("PUBLIC_FAILS=$((PUBLIC_FAILS + 1))");
        expect(guard).toMatch(
          /if \[ \$PUBLIC_FAILS -ge (3|"\$HEALTH_STRIKE_LIMIT") \]; then/,
        );
        expect(source).toMatch(/^\s*PUBLIC_FAILS=0$/m);
      });

      it("pages #oss-alerts before killing", () => {
        expect(guard).toContain("SLACK_WEBHOOK_OSS_ALERTS");
        expect(guard).toContain("-X POST -H 'Content-type: application/json'");
        // The alert must name the integration, or an on-call page cannot say
        // which service wedged.
        expect(guard).toContain(`[${slug}]`);
        // Alert BEFORE kill, never after: a kill-first ordering loses the page
        // whenever the restart races the webhook.
        const alertAt = guard!.indexOf("SLACK_WEBHOOK_OSS_ALERTS");
        const killAt = guard!.search(/kill -9 |_kill_agent_tree /);
        expect(alertAt).toBeGreaterThan(-1);
        expect(killAt).toBeGreaterThan(alertAt);
      });

      it("kills the frontend, never the agent", () => {
        const pidVar = guard!.match(/killing PID \$([A-Z_]+)/)?.[1];
        expect(pidVar, "guard does not name the PID it kills").toBeTruthy();
        expect(guard).toMatch(
          new RegExp(
            `(kill -9 "?\\$${pidVar}"?|_kill_agent_tree "\\$${pidVar}")`,
          ),
        );
        // Killing the agent here would restart the wrong process and leave the
        // wedged listener holding $PORT.
        expect(guard).not.toMatch(/kill -9 "?\$(AGENT|LANGGRAPH|JAVA)_PID/);
      });

      it("uses the same tree-kill as the agent branch when the file has one", () => {
        // In the entrypoints that wrap their processes in process substitution,
        // a single-PID kill reaps only the wrapper and orphans the real node
        // server — which keeps holding $PORT across the restart. Those files
        // define _kill_agent_tree; the frontend kill must route through it too.
        if (!source.includes("_kill_agent_tree()")) return;
        const code = codeOnly(guard!);
        expect(code).toContain("_kill_agent_tree");
        expect(code).not.toContain("kill -9");
      });
    },
  );
});

describe("public health routes stay decoupled from the agent", () => {
  // The watchdog reads /api/health as "is the Next.js listener serving?".
  // A route that returns 503 because the AGENT is unhealthy turns a slow agent
  // into a frontend restart loop, and fails the Railway healthcheck for a
  // frontend that is serving fine. Agent health belongs in the response body.
  it.each(entrypoints.map((e) => e.slug))("%s", (slug) => {
    const file = path.join(INTEGRATIONS, slug, "src/app/api/health/route.ts");
    if (!fs.existsSync(file)) {
      throw new Error(
        `${slug} has a public $PORT watchdog probe but no /api/health route — ` +
          `the probe would 404 and restart-loop the container.`,
      );
    }
    const route = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(route).not.toMatch(/status:\s*(?:[^,}]*\?[^,}]*:\s*)?5\d\d/);
    expect(route).not.toMatch(/status:\s*httpStatus/);
  });
});

describe("create-integration scaffolder", () => {
  // Asserts on GENERATED OUTPUT, not on the generator's source text. Grepping
  // index.ts only proves a string exists somewhere in a 2000-line file — it
  // stayed green when the template's webhook var was renamed. So run the real
  // generator into a tmpdir and read what a new integration would actually get.
  let entrypoint = "";
  let entrypointPath = "";
  let healthRoute = "";

  beforeAll(() => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "wd-scaffold-"));
    const workflows = fs.mkdtempSync(path.join(os.tmpdir(), "wd-workflows-"));
    execFileSync(
      process.execPath,
      [
        path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs"),
        path.resolve(__dirname, "../create-integration/index.ts"),
        "--name",
        "Watchdog Probe",
        "--slug",
        "watchdog-probe",
        "--category",
        "emerging",
        "--language",
        "python",
        "--features",
        "agentic-chat",
      ],
      {
        env: {
          ...process.env,
          CREATE_INTEGRATION_PACKAGES_DIR: out,
          CREATE_INTEGRATION_WORKFLOWS_DIR: workflows,
        },
        stdio: "pipe",
      },
    );
    const pkg = path.join(out, "watchdog-probe");
    entrypointPath = path.join(pkg, "entrypoint.sh");
    entrypoint = fs.readFileSync(entrypointPath, "utf8");
    healthRoute = fs.readFileSync(
      path.join(pkg, "src/app/api/health/route.ts"),
      "utf8",
    );
  });

  it("emits a runnable entrypoint", () => {
    expect(entrypoint).toMatch(/^#!\/bin\/bash/);
    // Proves the emitted shell parses — a template with a quoting slip would
    // otherwise ship broken to every new integration. Check the file the
    // generator wrote, not stdin: `bash -n /dev/stdin` exits 126 on the CI
    // runner, which made this assertion fail for a reason unrelated to the
    // shell it was meant to check.
    execFileSync("bash", ["-n", entrypointPath], { stdio: "pipe" });
  });

  it("emits the agent probe", () => {
    expect(entrypoint).toContain("http://127.0.0.1:8000/health");
    expect(entrypoint).toMatch(/kill -9 \$AGENT_PID/);
  });

  it("emits the public front-door guard", () => {
    const guard = extractGuard(entrypoint);
    expect(
      guard,
      "the scaffolder emits no public $PORT guard, so every new integration " +
        "starts with the gap this suite exists to close",
    ).not.toBeNull();
    expect(guard).toMatch(
      /curl -fsS --max-time 5 "http:\/\/127\.0\.0\.1:\$\{PORT\}\/api\/health"/,
    );
    expect(guard).toContain("PUBLIC_FAILS=$((PUBLIC_FAILS + 1))");
    expect(guard).toContain("SLACK_WEBHOOK_OSS_ALERTS");
    // The alert must interpolate the real slug, not a placeholder.
    expect(guard).toContain("[watchdog-probe]");
    expect(guard).toMatch(/kill -9 \$NEXTJS_PID/);
    expect(codeOnly(guard!)).not.toMatch(/kill -9 \$AGENT_PID/);
  });

  it("emits a health route that does not 503 on agent trouble", () => {
    const code = healthRoute
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/status:\s*(?:[^,}]*\?[^,}]*:\s*)?5\d\d/);
    expect(code).not.toMatch(/status:\s*httpStatus/);
    expect(code).toContain("status: 200");
  });
});
