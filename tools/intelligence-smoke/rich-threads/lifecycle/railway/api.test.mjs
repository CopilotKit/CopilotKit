import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { railwayApi, RailwayRequestError } from "./api.mjs";

test("CLI boundary retains bounded classification without private payloads", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "railway-api-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, "fake-railway");
  await writeFile(
    executable,
    `#!${process.execPath}
if (!process.argv.includes('--allow-errors')) process.exit(8);
process.stderr.write('PRIVATE_STDERR');
process.stdout.write(process.env.TEST_RESPONSE);
process.exit(Number(process.env.TEST_EXIT || 0));
`,
    { mode: 0o700 },
  );
  const diagnosticDirectory = join(root, "diagnostics");
  const cases = [
    [
      {
        errors: [
          {
            message: "PRIVATE_MESSAGE",
            extensions: {
              code: "GRAPHQL_VALIDATION_FAILED",
              secret: "PRIVATE_EXTENSION",
            },
          },
        ],
      },
      0,
      "not-executed",
      "graphql-rejected",
    ],
    [
      { errors: [{ extensions: { code: "GRAPHQL_PARSE_FAILED" } }] },
      0,
      "not-executed",
      "graphql-rejected",
    ],
    [
      {
        data: null,
        errors: [{ extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }],
      },
      0,
      "unknown",
      "graphql-rejected",
    ],
    [
      { errors: [{ extensions: { code: "BAD_USER_INPUT" } }] },
      0,
      "unknown",
      "graphql-rejected",
    ],
    [
      {
        errors: [
          {
            message: "Not Authorized",
            extensions: { code: "INTERNAL_SERVER_ERROR" },
          },
        ],
      },
      0,
      "unknown",
      "graphql-rejected",
    ],
    [
      { errors: [{ extensions: { code: "PRIVATE_UNKNOWN_CODE" } }] },
      0,
      "unknown",
      "graphql-rejected",
    ],
    [
      { data: { environmentCreate: { id: "created" } } },
      1,
      "unknown",
      "cli-failed",
    ],
    ["PRIVATE_MALFORMED", 0, "unknown", "invalid-response"],
  ];
  for (const [body, exit, outcome, failureClass] of cases) {
    const api = railwayApi({
      executable,
      diagnosticDirectory,
      env: {
        TEST_RESPONSE: typeof body === "string" ? body : JSON.stringify(body),
        TEST_EXIT: String(exit),
      },
    });
    await assert.rejects(
      api.request("createEnvironment", {
        input: { secret: "PRIVATE_VARIABLE" },
      }),
      (error) => {
        assert.ok(error instanceof RailwayRequestError);
        assert.equal(error.diagnostic.outcome, outcome);
        assert.equal(error.diagnostic.failureClass, failureClass);
        if (exit) assert.equal(error.diagnostic.exitCode, exit);
        assert.equal(JSON.stringify(error).includes("PRIVATE_"), false);
        return true;
      },
    );
  }
  await assert.rejects(
    railwayApi({
      executable: join(root, "missing"),
      diagnosticDirectory,
    }).request("createEnvironment", {}),
    (e) => e.diagnostic.outcome === "not-executed",
  );
  const files = await readdir(diagnosticDirectory);
  assert.equal(files.length, cases.length + 1);
  for (const file of files) {
    const path = join(diagnosticDirectory, file);
    const content = await readFile(path, "utf8");
    assert.equal(content.includes("PRIVATE_"), false);
    assert.ok(content.length < 1024);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
});
