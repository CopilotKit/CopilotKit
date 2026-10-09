import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

// This local transport fixture tests driver wiring. The server-owned acceptance
// fixture separately supplies a real delivery API with project authorization.
const files = {
  "SKILL.md": "Follow the learned procedure.",
  "references/policy.txt": "Refund €10",
};
const bytes = zipSync({
  "manifest.json": strToU8(
    JSON.stringify({
      schemaVersion: 1,
      revision: "local-revision",
      skills: [
        {
          name: "refund",
          description:
            "Use when refund is required. Do not use for unrelated work.",
          files: Object.entries(files).map(([path, text]) => ({
            path,
            size: Buffer.byteLength(text),
            sha256: createHash("sha256").update(text).digest("hex"),
          })),
        },
      ],
    }),
  ),
  ...Object.fromEntries(
    Object.entries(files).map(([path, text]) => [
      `refund/${path}`,
      strToU8(text),
    ]),
  ),
});
const root = fileURLToPath(new URL("../../", import.meta.url));

for (const adapter of ["typescript", "mastra"]) {
  test(
    `${adapter}: native discovery, skill load, and supporting-file read over local HTTP`,
    { timeout: 30_000 },
    async (t) => {
      const requests = [];
      const server = createServer((request, response) => {
        requests.push({
          url: request.url,
          authorization: request.headers.authorization,
        });
        response.writeHead(200, {
          "Content-Type": "application/zip",
          "X-CopilotKit-Skills-Revision": "local-revision",
          ETag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
        });
        response.end(bytes);
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      t.after(() => new Promise((resolve) => server.close(resolve)));
      const child = spawn(
        process.execPath,
        ["tools/learned-skill-conformance/run.mjs", adapter],
        {
          cwd: root,
          env: {
            ...process.env,
            INTELLIGENCE_API_URL: `http://127.0.0.1:${server.address().port}`,
            CPK_INTELLIGENCE_API_KEY: "local-delivery-fixture-key",
            CPK_INTELLIGENCE_LEARNING_CONTAINER_ID: "local-container",
            COPILOTKIT_TELEMETRY_DISABLED: "true",
            CPK_INTELLIGENCE_SKILLS_REVISION: undefined,
            LEARNED_SKILL_ACCEPTANCE_GROUP: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        },
      );
      let output = "";
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (chunk) => {
          output = (output + chunk).slice(-16000);
        });
      const deadline = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }, 25_000);
      const exit = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      }).finally(() => clearTimeout(deadline));
      assert.equal(exit, 0, output);
      assert.match(output, new RegExp(`PASS ${adapter}:`));
      assert.equal(
        requests.length,
        2,
        "Initialize and invocation preflight each fetch the snapshot once.",
      );
      for (const request of requests) {
        assert.equal(
          request.url,
          "/api/v1/learning/containers/local-container/skills",
        );
        assert.equal(
          request.authorization,
          "Bearer local-delivery-fixture-key",
        );
      }
    },
  );
}
