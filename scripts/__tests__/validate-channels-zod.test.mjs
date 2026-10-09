import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateChannelsZod,
  channelsPackageDirs,
  formatViolations,
  CHECKED_FIELDS,
} from "../validate-channels-zod.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

let fixtureDir;

afterEach(() => {
  if (fixtureDir) {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fixtureDir = undefined;
  }
});

/** Write a `packages/`-shaped fixture tree: { dirName: manifestObject }. */
function setupFixture(packages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "validate-channels-zod-"));
  for (const [dirName, manifest] of Object.entries(packages)) {
    const dir = path.join(root, dirName);
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(manifest, null, 2),
    );
  }
  fixtureDir = root;
  return root;
}

describe("validateChannelsZod", () => {
  test("passes when no channels package declares zod", () => {
    const dir = setupFixture({
      "channels-discord": {
        name: "@copilotkit/channels-discord",
        dependencies: { "discord.js": "^14.16.0" },
      },
      "channels-core": {
        name: "@copilotkit/channels-core",
        dependencies: { "zod-to-json-schema": "^3.24.1" },
      },
    });
    assert.deepEqual(validateChannelsZod(dir), []);
  });

  test("allows zod in devDependencies — consumers do not install them", () => {
    const dir = setupFixture({
      "channels-slack": {
        name: "@copilotkit/channels-slack",
        devDependencies: { zod: "^3.25.76" },
      },
    });
    assert.deepEqual(validateChannelsZod(dir), []);
  });

  for (const field of CHECKED_FIELDS) {
    test(`flags a zod range in ${field}`, () => {
      const dir = setupFixture({
        "channels-telegram": {
          name: "@copilotkit/channels-telegram",
          [field]: { zod: "^3.25.76" },
        },
      });
      const violations = validateChannelsZod(dir);
      assert.equal(violations.length, 1);
      assert.equal(violations[0].package, "@copilotkit/channels-telegram");
      assert.equal(violations[0].rule, "channels-zod-range");
      assert.equal(violations[0].field, field);
      assert.equal(violations[0].range, "^3.25.76");
    });
  }

  test("flags a permissive range too — the rule is no range at all", () => {
    // `*` cannot conflict with anything, but a declaration that exists can be
    // tightened by a later edit. The check is on the declaration, not on
    // whether today's value happens to resolve.
    const dir = setupFixture({
      channels: { name: "@copilotkit/channels", dependencies: { zod: "*" } },
    });
    assert.equal(validateChannelsZod(dir).length, 1);
  });

  test("reports one violation per offending field", () => {
    const dir = setupFixture({
      "channels-discord": {
        name: "@copilotkit/channels-discord",
        dependencies: { zod: "^3.25.76" },
        peerDependencies: { zod: "^3.25.76" },
      },
    });
    assert.equal(validateChannelsZod(dir).length, 2);
  });

  test("ignores packages outside the channels family", () => {
    const dir = setupFixture({
      runtime: {
        name: "@copilotkit/runtime",
        dependencies: { zod: "^3.23.3" },
      },
      "react-core": {
        name: "@copilotkit/react-core",
        peerDependencies: { zod: ">=3.25" },
      },
    });
    assert.deepEqual(validateChannelsZod(dir), []);
  });

  test("exempts a private package, which ships to nobody", () => {
    const dir = setupFixture({
      "channels-fixtures": {
        name: "@copilotkit/channels-fixtures",
        private: true,
        dependencies: { zod: "^3.25.76" },
      },
    });
    assert.deepEqual(validateChannelsZod(dir), []);
  });

  test("reports an unparseable manifest instead of skipping it", () => {
    const dir = setupFixture({
      "channels-broken": { name: "@copilotkit/channels-broken" },
    });
    fs.writeFileSync(path.join(dir, "channels-broken", "package.json"), "{ oh");
    const violations = validateChannelsZod(dir);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "unreadable-manifest");
  });

  test("returns an empty list for a directory that does not exist", () => {
    assert.deepEqual(channelsPackageDirs("/no/such/dir"), []);
    assert.deepEqual(validateChannelsZod("/no/such/dir"), []);
  });

  test("formatViolations names the package, the field and the range", () => {
    const dir = setupFixture({
      "channels-telegram": {
        name: "@copilotkit/channels-telegram",
        dependencies: { zod: "^3.25.76" },
      },
    });
    const text = formatViolations(validateChannelsZod(dir));
    assert.match(text, /@copilotkit\/channels-telegram/);
    assert.match(text, /dependencies\.zod = "\^3\.25\.76"/);
    assert.match(text, /::error file=/);
  });
});

describe("the real packages/ tree", () => {
  test("finds the channels packages", () => {
    const dirs = channelsPackageDirs(path.join(REPO_ROOT, "packages"));
    // Guards against the check silently passing because its glob stopped
    // matching anything. The floor is well under today's count.
    assert.ok(
      dirs.length >= 5,
      `expected at least 5 channels packages, found ${dirs.length}`,
    );
    assert.ok(
      dirs.some((d) => path.basename(d) === "channels-discord"),
      "channels-discord not found",
    );
    assert.ok(
      dirs.some((d) => path.basename(d) === "channels-telegram"),
      "channels-telegram not found",
    );
  });

  test("no channels package declares a zod range", () => {
    const violations = validateChannelsZod(path.join(REPO_ROOT, "packages"));
    assert.deepEqual(
      violations,
      [],
      "\n" + formatViolations(violations) + "\n",
    );
  });
});
