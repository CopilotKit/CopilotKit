import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

const DEPLOY_SCRIPTS = ["deploy-langgraph.sh", "deploy-strands.sh"] as const;

/** Run a frontend-only deploy from a clean directory with no backend secrets. */
function runFrontendOnly(scriptName: (typeof DEPLOY_SCRIPTS)[number]) {
  const directory = mkdtempSync(join(tmpdir(), "agentcore-frontend-only-"));
  const scriptPath = join(directory, scriptName);
  const frontendMarker = join(directory, "frontend-ran");
  const fakeBin = join(directory, "bin");
  mkdirSync(fakeBin);
  mkdirSync(join(directory, "scripts"));
  copyFileSync(
    resolve("examples/integrations/agentcore", scriptName),
    scriptPath,
  );
  chmodSync(scriptPath, 0o755);
  writeFileSync(
    join(directory, "config.yaml"),
    [
      "stack_name_base: agentcore-contract",
      "copilotkit_intelligence_api_key_secret_name: ignored",
      "backend:",
      "  pattern: ignored",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "scripts", "deploy-frontend.py"),
    [
      "from pathlib import Path",
      `Path(${JSON.stringify(frontendMarker)}).write_text('ran')`,
    ].join("\n"),
  );
  writeFileSync(join(fakeBin, "aws"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(fakeBin, "aws"), 0o755);

  const result = spawnSync("/bin/bash", [scriptPath, "--skip-backend"], {
    cwd: directory,
    encoding: "utf8",
    env: {
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    },
  });

  return {
    output: `${result.stdout}${result.stderr}`,
    frontendRan: existsSync(frontendMarker)
      ? readFileSync(frontendMarker, "utf8")
      : null,
    status: result.status,
    teardown: () => rmSync(directory, { force: true, recursive: true }),
  };
}

test.each(DEPLOY_SCRIPTS)(
  "%s runs --skip-backend without a .env file or backend credentials",
  (scriptName) => {
    const result = runFrontendOnly(scriptName);

    try {
      expect(result.status).toBe(0);
      expect(result.frontendRan).toBe("ran");
      expect(result.output).toContain(
        "Skipping backend deploy (--skip-backend)",
      );
      expect(result.output).not.toContain("CPK_INTELLIGENCE_API_KEY");
      expect(result.output).not.toContain("INTELLIGENCE_API_URL");
      expect(result.output).not.toContain("INTELLIGENCE_GATEWAY_WS_URL");
      expect(result.output).not.toContain("Secrets Manager");
    } finally {
      result.teardown();
    }
  },
);
