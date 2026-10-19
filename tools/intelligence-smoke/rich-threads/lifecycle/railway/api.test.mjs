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

test("provider trace correlation is bounded and never changes outcome classification", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "railway-traces-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, "fake-railway");
  await writeFile(
    executable,
    `#!${process.execPath}
process.stdout.write(process.env.TEST_RESPONSE);
`,
    { mode: 0o700 },
  );
  const errors = [
    {
      traceId: "9219678863388380150",
      extensions: {
        code: "INTERNAL_SERVER_ERROR",
        traceId: "7992771584715554281",
      },
    },
    ...[
      "PRIVATE_TRACE",
      "1".repeat(100),
      "18446744073709551616",
      "01",
      "-1",
      "1\n",
      123,
      null,
      { secret: "PRIVATE_TRACE" },
    ].map((traceId) => ({
      traceId,
      extensions: { code: "INTERNAL_SERVER_ERROR", traceId },
    })),
  ];
  const diagnosticDirectory = join(root, "diagnostics");
  const api = railwayApi({
    executable,
    diagnosticDirectory,
    env: { TEST_RESPONSE: JSON.stringify({ data: null, errors }) },
  });
  await assert.rejects(api.request("createEnvironment", {}), (error) => {
    assert.deepEqual(error.diagnostic.traceIds, [
      "9219678863388380150",
      "7992771584715554281",
    ]);
    assert.equal(error.diagnostic.outcome, "unknown");
    return true;
  });
  const saved = JSON.parse(
    await readFile(
      join(diagnosticDirectory, (await readdir(diagnosticDirectory))[0]),
      "utf8",
    ),
  );
  assert.deepEqual(saved.traceIds, [
    "9219678863388380150",
    "7992771584715554281",
  ]);
  assert.equal(JSON.stringify(saved).includes("PRIVATE_"), false);
  const many = railwayApi({
    executable,
    env: {
      TEST_RESPONSE: JSON.stringify({
        errors: Array.from({ length: 100 }, (_, i) => ({
          traceId: String(i + 1),
        })),
      }),
    },
  });
  await assert.rejects(
    many.request("createEnvironment", {}),
    (error) => error.diagnostic.traceIds.length === 16,
  );
});

test("known name rejection is persisted without arbitrary provider messages", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "railway-name-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, "fake-railway");
  await writeFile(
    executable,
    `#!${process.execPath}
process.stdout.write(process.env.TEST_RESPONSE);
`,
    { mode: 0o700 },
  );
  const diagnosticDirectory = join(root, "diagnostics");
  const knownMessage = "Error in name - Invalid input";
  const api = railwayApi({
    executable,
    diagnosticDirectory,
    env: {
      TEST_RESPONSE: JSON.stringify({
        data: null,
        errors: [
          knownMessage,
          knownMessage,
          `${knownMessage}: PRIVATE_VALUE`,
          "PRIVATE_MESSAGE",
        ].map((message) => ({
          message,
          extensions: { code: "BAD_USER_INPUT" },
        })),
      }),
    },
  });
  await assert.rejects(api.request("createEnvironment", {}), (error) => {
    assert.deepEqual(error.diagnostic.messages, [knownMessage]);
    assert.equal(error.diagnostic.outcome, "unknown");
    return true;
  });
  const files = await readdir(diagnosticDirectory);
  assert.equal(files.length, 1);
  const saved = await readFile(join(diagnosticDirectory, files[0]), "utf8");
  assert.deepEqual(JSON.parse(saved).messages, [knownMessage]);
  assert.equal(saved.includes("PRIVATE_"), false);
});

const page = (ids, next = false, cursor) => ({
  edges: ids.map((id) => ({ node: { id, projectId: "project" } })),
  pageInfo: { hasNextPage: next, endCursor: cursor },
});

test("CLI inventory rejects incomplete pages, cycles, duplicates and cross-project entries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "railway-pages-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, "fake-railway");
  await writeFile(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
const vars = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--variables') + 1].slice(1), 'utf8'));
const pages = JSON.parse(process.env.TEST_PAGES);
process.stdout.write(JSON.stringify({data:{project:{environments:pages[vars.after || 'first']}}}));
`,
    { mode: 0o700 },
  );
  const cases = [
    [
      {
        first: page(["one"], true, "a"),
        a: page(["two"], true, "b"),
        b: page(["three"], true, "a"),
      },
      /pagination/,
    ],
    [{ first: page(["one"], true, "a"), a: page(["one"]) }, /duplicate/],
    [{ first: { edges: [], pageInfo: {} } }, /Incomplete/],
    [
      {
        first: {
          edges: [{ node: { id: "one", projectId: "other" } }],
          pageInfo: { hasNextPage: false },
        },
      },
      /Malformed/,
    ],
  ];
  for (const [pages, expected] of cases) {
    const api = railwayApi({
      executable,
      env: { TEST_PAGES: JSON.stringify(pages) },
    });
    await assert.rejects(api.list("environments", "project"), expected);
  }
  const api = railwayApi({
    executable,
    env: {
      TEST_PAGES: JSON.stringify({
        first: page(["one"], true, "a"),
        a: page(["two"]),
      }),
    },
  });
  assert.deepEqual(
    (await api.list("environments", "project")).map((v) => v.id),
    ["one", "two"],
  );
});

test("rejection structure is bounded, correlated and excludes arbitrary strings", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "railway-structure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, "fake-railway");
  await writeFile(
    executable,
    `#!${process.execPath}
process.stdout.write(process.env.TEST_RESPONSE);
`,
    { mode: 0o700 },
  );
  const diagnosticDirectory = join(root, "diagnostics");
  const errors = [
    {
      message: "Error in sourceEnvironmentId - Invalid input",
      path: ["environmentCreate", "PRIVATE_PATH"],
      extensions: { code: "BAD_USER_INPUT", secret: "PRIVATE_EXTENSION" },
    },
    {
      message: "Error in name - Invalid input: PRIVATE_VALUE",
      path: ["PRIVATE_ROOT"],
      extensions: { code: "PRIVATE_CODE" },
    },
    { message: "Error in PRIVATE_FIELD - Invalid input" },
    null,
    "PRIVATE_ERROR",
    ...Array.from({ length: 30 }, () => ({ message: "PRIVATE_MESSAGE" })),
  ];
  const api = railwayApi({
    executable,
    diagnosticDirectory,
    env: {
      TEST_RESPONSE: JSON.stringify({
        data: { environmentCreate: { id: "PRIVATE_ID" } },
        errors,
      }),
    },
  });
  let diagnostic;
  await assert.rejects(
    api.request("createEnvironment", { input: { secret: "PRIVATE_VARIABLE" } }),
    (error) => {
      diagnostic = error.diagnostic;
      assert.equal(diagnostic.outcome, "unknown");
      return true;
    },
  );
  const structure = diagnostic.structure;
  assert.equal(structure.errorCount, 17);
  assert.equal(structure.errorsTruncated, true);
  assert.equal(structure.dataKind, "object");
  assert.equal(structure.errors.length, 16);
  assert.equal(structure.errors[0].validationField, "sourceEnvironmentId");
  assert.equal(structure.errors[0].code, "BAD_USER_INPUT");
  assert.equal(structure.errors[0].rootFieldMatched, true);
  assert.equal(structure.errors[1].messageRecognized, false);
  assert.equal(structure.errors[1].rootFieldMatched, false);
  assert.equal(structure.errors[2].validationField, undefined);
  assert.equal(structure.errors[3].kind, "null");
  assert.equal(structure.errors[4].kind, "string");
  const saved = await readFile(
    join(diagnosticDirectory, `${diagnostic.id}.json`),
    "utf8",
  );
  assert.deepEqual(JSON.parse(saved), diagnostic);
  assert.equal(saved.includes("PRIVATE_"), false);
  assert.ok(saved.length < 8192);

  // A familiar validation phrase on another operation must not be attributed
  // to EnvironmentCreateInput, and malformed paths must not crash diagnostics.
  const other = railwayApi({
    executable,
    env: {
      TEST_RESPONSE: JSON.stringify({
        errors: [
          {
            message: "Error in sourceEnvironmentId - Invalid input",
            path: { secret: "PRIVATE_PATH" },
          },
        ],
      }),
    },
  });
  await assert.rejects(other.request("createService", {}), (error) => {
    assert.equal(
      error.diagnostic.structure.errors[0].validationField,
      undefined,
    );
    assert.equal(error.diagnostic.structure.errors[0].pathKind, "object");
    assert.equal(error.diagnostic.outcome, "unknown");
    return true;
  });
});
