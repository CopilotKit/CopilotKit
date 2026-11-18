import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// `npm run dev` reads the development files and `npm start` the production ones.
for (const mode of ["development", "production"] as const)
  test(`agent:plan reads the ${mode} env files, as the app does`, async () => {
    // A stand-in Omnara API that records which project the script asks for.
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(404, { "content-type": "application/json" }).end("{}");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    const dir = mkdtempSync(path.join(tmpdir(), "omnara-env-"));
    mkdirSync(path.join(dir, "omnara"));
    writeFileSync(path.join(dir, "omnara", "agent.yaml"), "version: v1\n");
    writeFileSync(
      path.join(dir, ".env"),
      [
        "OMNARA_API_KEY=test-key",
        "OMNARA_ORG_ID=org_test",
        "OMNARA_PROJECT_ID=proj_env",
        `OMNARA_API_URL=http://127.0.0.1:${port}/v1`,
      ].join("\n"),
    );
    for (const each of ["development", "production"])
      writeFileSync(
        path.join(dir, `.env.${each}.local`),
        `OMNARA_PROJECT_ID=proj_${each}\n`,
      );

    // Run from the temp folder with no inherited Omnara settings. The stand-in
    // API answers 404, so the script exits with an error after its first call.
    await new Promise<void>((resolve) =>
      execFile(
        path.join(root, "node_modules", ".bin", "tsx"),
        [path.join(root, "scripts", "profile.ts"), "--dry-run"],
        { cwd: dir, env: { NODE_ENV: mode, PATH: process.env.PATH } },
        () => resolve(),
      ),
    );
    server.close();
    rmSync(dir, { recursive: true, force: true });

    assert.ok(requests.length > 0, "the script made no Omnara request");
    assert.match(requests[0], new RegExp(`/projects/proj_${mode}/`));
  });
