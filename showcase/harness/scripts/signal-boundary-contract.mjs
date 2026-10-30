// Offline consumer audit. Run only in provisioned CI through signal-boundary-audit.py.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { types } from "node:util";

const harness = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const poolSource = readFileSync(
  resolve(harness, "src/probes/helpers/browser-pool.ts"),
  "utf8",
);
// Bounded syntax guard for the reported direct Promise.race array pattern in
// both recovery drains, not a parser or universal leak proof (aliases, helpers
// and other subscription forms need behavioral tests/review). Cancellation must
// release recovery on shutdown AND dispose its registration on serve success;
// browser-pool.test.ts exercises those lifetime orderings in both real loops.
for (const method of ["recycleBrowser", "startSelfHeal"]) {
  const declaration = new RegExp(
    `^  private (?:async )?${method}\\(`,
    "m",
  ).exec(poolSource);
  assert(declaration, `missing recovery method: ${method}`);
  const remainder = poolSource.slice(declaration.index + declaration[0].length);
  const nextMember = remainder.search(/^  private /m);
  assert(nextMember >= 0, `missing recovery method boundary: ${method}`);
  const recoverySource = remainder.slice(0, nextMember);
  for (const [, entries] of recoverySource.matchAll(
    /Promise\s*\.\s*race\s*\(\s*\[([^;]*?)\]\s*\)/g,
  )) {
    assert(
      !(
        /this\s*\.\s*serveNextWaiter\s*\(/.test(entries) &&
        /this\s*\.\s*shutdownSignal\b/.test(entries)
      ),
      `${method}: direct recovery serve races retain shared shutdownSignal reactions; use a cancellable registration disposed on success and shutdown`,
    );
  }
}
console.log("RECOVERY_DIRECT_RACE_SYNTAX_GUARD", "PASS");

const require = createRequire(resolve(harness, "package.json"));
const playwright = require("playwright");
const coreRequire = createRequire(require.resolve("playwright/package.json"));
const core = dirname(coreRequire.resolve("playwright-core/package.json"));
console.log(
  "CONSUMER_METADATA",
  JSON.stringify({
    node: process.version,
    playwright: require("playwright/package.json").version,
    playwrightCore: coreRequire("playwright-core/package.json").version,
    vitest: require("vitest/package.json").version,
    tsxLoader: require.resolve("tsx"),
    browserRevisions: JSON.parse(
      readFileSync(resolve(core, "browsers.json"), "utf8"),
    ).browsers.filter(({ name }) => name.startsWith("chromium")),
  }),
);

// ChannelOwner validates before calling this connection method. Keep the real
// producer, launch converter and validator; stop before any browser is launched.
const { chromium } = playwright;
const originalLaunch = chromium.launch;
const connection = chromium._connection;
const originalSend = connection.sendMessageToServer;
const sentinel = `SIGNAL_BOUNDARY_TRANSPORT_${process.pid}`;
let producer;
let wire;
let launchCalls = 0;
let sendCalls = 0;
chromium.launch = async function (options) {
  launchCalls++;
  producer = options;
  return originalLaunch.call(this, options);
};
connection.sendMessageToServer = async function (owner, method, params) {
  sendCalls++;
  assert.equal(owner, chromium, "unexpected transport owner");
  assert.equal(method, "launch", "unexpected transport method");
  wire = params;
  throw new Error(sentinel);
};
let pool;
try {
  const { BrowserPool } = await import(
    pathToFileURL(resolve(harness, "src/probes/helpers/browser-pool.ts"))
  );
  pool = new BrowserPool({
    browsers: 1,
    maxContexts: 1,
    heartbeatMs: 0,
    launchStaggerMs: 0,
  });
  await assert.rejects(
    () => pool.init(),
    (error) => {
      assert(error instanceof Error);
      assert(
        error.message.includes(sentinel),
        `unexpected init failure: ${error.stack}`,
      );
      return true;
    },
  );
} finally {
  try {
    await pool?.shutdown();
  } finally {
    chromium.launch = originalLaunch;
    connection.sendMessageToServer = originalSend;
  }
}
assert.equal(launchCalls, 1);
assert.equal(sendCalls, 1);
assert(producer && wire, "missing producer or validated wire capture");
const fields = ["handleSIGTERM", "handleSIGINT", "handleSIGHUP"];
for (const value of [producer, wire]) {
  for (const field of fields) assert.equal(value[field], false);
  assert.equal(value.headless, true);
  assert.deepEqual(value.args, ["--no-sandbox", "--disable-dev-shm-usage"]);
}
console.log("ACTUAL_PRODUCER", JSON.stringify(producer));
console.log("ACTUAL_VALIDATED_WIRE", JSON.stringify(wire));

const { findValidator } = coreRequire(
  resolve(core, "lib/protocol/validator.js"),
);
const { ValidationError } = coreRequire(
  resolve(core, "lib/protocol/validatorPrimitives.js"),
);
const validate = findValidator("BrowserType", "launch", "Params");
const cases = [];
const add = (id, input, expected, invalidField) =>
  cases.push({ id, input, expected, invalidField });

// Expectations follow locked tOptional/tBoolean/tObject: undefined omitted,
// Boolean boxes unwrapped, inherited properties read, extras stripped except
// own enumerable __testHook* keys in isUnderTest mode. No unrelated schema sweep.
for (const a of [undefined, false, true]) {
  for (const b of [undefined, false, true]) {
    for (const c of [undefined, false, true]) {
      const input = { ...wire };
      [a, b, c].forEach((value, i) => {
        if (value === undefined) delete input[fields[i]];
        else input[fields[i]] = value;
      });
      add(`optional:${[a, b, c].map(String).join("/")}`, input, { ...input });
    }
  }
}
for (const field of fields) {
  const expectedAbsent = { ...wire };
  delete expectedAbsent[field];
  add(
    `${field}:explicit-undefined`,
    { ...wire, [field]: undefined },
    expectedAbsent,
  );
  for (const value of [false, true]) {
    add(
      `${field}:boxed-${value}`,
      { ...wire, [field]: new Boolean(value) },
      { ...wire, [field]: value },
    );
  }
  for (const [label, value] of [
    ["null", null],
    ["zero", 0],
    ["string", "false"],
    ["array", []],
  ]) {
    add(
      `${field}:reject-${label}`,
      { ...wire, [field]: value },
      undefined,
      field,
    );
  }
}
const inherited = Object.assign(
  Object.create(Object.fromEntries(fields.map((field) => [field, false]))),
  wire,
);
for (const field of fields) delete inherited[field];
add("inherited-signals", inherited, { ...wire });
class LaunchShape {
  constructor() {
    Object.assign(this, wire);
  }
  toJSON() {
    return { ...this };
  }
}
add("class-instance", new LaunchShape(), { ...wire });
add(
  "unknown-and-test-hook",
  { ...wire, unknownSignalAudit: "strip", __testHookSignalAudit: "hook" },
  { ...wire },
);
add("actual-wire", wire, { ...wire });
assert.equal(cases.length, 52);

function describeInput(input) {
  return {
    json: input,
    prototype: Object.getPrototypeOf(input)?.constructor?.name,
    signals: Object.fromEntries(
      fields.map((field) => [
        field,
        {
          own: Object.hasOwn(input, field),
          type: types.isBooleanObject(input[field])
            ? "boxed-boolean"
            : typeof input[field],
          value: input[field] === undefined ? "<undefined>" : input[field],
        },
      ]),
    ),
  };
}
let accepted = 0;
let rejected = 0;
const ids = new Set();
for (const underTest of [false, true]) {
  for (const entry of cases) {
    const id = `${entry.id}:isUnderTest=${underTest}`;
    assert(!ids.has(id));
    ids.add(id);
    const context = {
      binary: "buffer",
      isUnderTest: () => underTest,
      tChannelImpl: () => {
        throw new Error("unexpected channel in launch params");
      },
    };
    let output;
    let error;
    try {
      output = validate(entry.input, "", context);
    } catch (caught) {
      error = caught;
    }
    try {
      if (entry.invalidField) {
        assert(
          error instanceof ValidationError,
          "wrong scalar was accepted or failed outside validator",
        );
        assert(
          error.message.startsWith(`${entry.invalidField}: expected boolean`),
        );
        rejected++;
      } else {
        assert.equal(error, undefined);
        const expected = { ...entry.expected };
        if (underTest && entry.id === "unknown-and-test-hook")
          expected.__testHookSignalAudit = "hook";
        assert.equal(Object.getPrototypeOf(output), Object.prototype);
        assert.deepEqual(output, expected);
        accepted++;
      }
    } catch (failure) {
      console.log(
        "CONTRACT_CASE",
        JSON.stringify({
          id,
          input: describeInput(entry.input),
          output,
          error: String(error),
          verdict: "FAIL",
        }),
      );
      throw failure;
    }
    console.log(
      "CONTRACT_CASE",
      JSON.stringify({
        id,
        input: describeInput(entry.input),
        output,
        error: error?.message,
        verdict: "PASS",
      }),
    );
  }
}
assert.equal(ids.size, 104);
assert.equal(accepted, 80);
assert.equal(rejected, 24);
console.log(
  "CONTRACT_VERDICT",
  JSON.stringify({
    verdict: "PASS",
    cases: ids.size,
    accepted,
    rejected,
    optionalBooleanCases: 54,
  }),
);
