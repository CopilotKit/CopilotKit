import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import yaml from "yaml";
import * as scripts from "../../harness/src/probes/drivers/d6-all-pills.js";
import { D5_REGISTRY } from "../../harness/src/probes/helpers/d5-registry.js";
import { validateE2eCoverage } from "../validate-e2e-coverage.js";

const showcase = fileURLToPath(new URL("../..", import.meta.url));
const demoIds = [
  "agentic-chat",
  "frontend-tools",
  "tool-rendering-default-catchall",
];
const fixtureFile = "aimock/d6/omnara/agentic-chat.json";
const registry = new Map(D5_REGISTRY);
let root: string;
const file = (relative: string) => path.join(root, relative);
const read = (relative: string) => fs.readFileSync(file(relative), "utf8");
function write(relative: string, contents: string) {
  const target = file(relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}
function integration(slug: string, shared = false, demos = demoIds) {
  fs.mkdirSync(file(`integrations/${slug}/src`), {
    recursive: true,
  });
  write(
    `integrations/${slug}/manifest.yaml`,
    yaml.stringify({
      slug,
      ...(shared ? { test_coverage: "shared-d6" } : {}),
      demos: demos.map((id) => ({ id })),
    }),
  );
}
function specs(slug: string, count: number) {
  fs.mkdirSync(file(`integrations/${slug}/tests/e2e`), {
    recursive: true,
  });
  for (let i = 0; i < count; i++)
    write(`integrations/${slug}/tests/e2e/${i}.spec.ts`, "");
}
function sharedIntegration() {
  integration("omnara", true);
  fs.cpSync(path.join(showcase, "aimock/d6/omnara"), file("aimock/d6/omnara"), {
    recursive: true,
  });
}
const check = () => validateE2eCoverage({ showcaseRoot: root });
const errors = async () => (await check()).errors.join("\n");
beforeAll(async () => {
  const failures: string[] = [];
  await scripts.defaultScriptLoader({
    now: () => new Date(),
    env: {},
    logger: {
      info() {},
      debug() {},
      warn: (msg) => failures.push(msg),
      error: (msg) => failures.push(msg),
    },
  });
  expect(failures).toEqual([]);
  for (const [id, script] of D5_REGISTRY) registry.set(id, script);
});
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-coverage-"));
  write("scripts/fail-baseline.json", '{"baselineDemoCount":9}');
  fs.mkdirSync(file("integrations"));
});
afterEach(() => {
  vi.restoreAllMocks();
  D5_REGISTRY.clear();
  for (const [id, script] of registry) D5_REGISTRY.set(id, script);
  fs.rmSync(root, { recursive: true, force: true });
});

it("retains the nine direct-file spec floor and aggregates package failures", async () => {
  integration("eight");
  specs("eight", 8);
  write("integrations/eight/tests/e2e/nested/extra.spec.ts", "");
  fs.mkdirSync(file("integrations/eight/tests/e2e/directory.spec.ts"));
  integration("nine");
  specs("nine", 9);
  integration("missing");
  write("integrations/meta/manifest.yaml", "slug: meta\n");
  const result = await check();
  expect(result.exitCode).toBe(1);
  expect(result.errors).toEqual([
    expect.stringMatching(/eight.*8.*minimum required is 9/),
    expect.stringMatching(/missing.*missing tests\/e2e/),
  ]);
  expect(result.messages).toEqual([
    "skip: meta (manifest-only, no src/)",
    "ok: nine has 9 spec(s)",
  ]);
});
it.each([
  ["{", 2],
  ['{"baselineDemoCount":-1}', 3],
  ['{"baselineDemoCount":"9"}', 3],
  ["null", 3],
])("rejects baseline %s with exit %s", async (raw, exitCode) => {
  write("scripts/fail-baseline.json", raw as string);
  expect((await check()).exitCode).toBe(exitCode);
});
it("fails empty or manifest-only source discovery", async () => {
  expect(await errors()).toMatch(/No .*integrations/);
  write("integrations/meta/manifest.yaml", "slug: meta\n");
  expect((await check()).exitCode).toBe(1);
});
it("reports metadata and discovery IO failures", async () => {
  integration("bad");
  fs.rmSync(file("integrations/bad/manifest.yaml"));
  fs.mkdirSync(file("integrations/bad/manifest.yaml"));
  expect(await errors()).toMatch(/manifest.*unreadable/);
  fs.rmSync(file("integrations"), { recursive: true });
  expect(await errors()).toMatch(/discover.*ENOENT/);
});
it("aggregates enumeration IO failures without disguising them as low counts", async () => {
  integration("bad");
  specs("bad", 9);
  integration("missing");
  const original = fs.readdirSync;
  vi.spyOn(fs, "readdirSync").mockImplementation(((p: any, ...args: any[]) => {
    if (String(p).endsWith("bad/tests/e2e"))
      throw new Error("EACCES: injected spec read");
    return (original as any)(p, ...args);
  }) as typeof fs.readdirSync);
  const result = await check();
  expect(result.errors).toHaveLength(2);
  expect(result.errors.join("\n")).toMatch(/enumerating specs.*EACCES/);
});
describe("shared D6 inventory", () => {
  beforeEach(sharedIntegration);
  it("validates three real Omnara scripts and fixture inventories", async () => {
    const result = await check();
    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.messages).toContain(
      "ok: omnara has structural shared-d6 coverage for 3 demo(s)",
    );
  });
  it("still requires nine specs without explicit shared opt-in, even with fixtures", async () => {
    integration("omnara", false);
    expect(await errors()).toMatch(/missing tests\/e2e/);
    specs("omnara", 8);
    expect(await errors()).toMatch(/8.*minimum required is 9/);
  });
  it.each([
    [[], /declared demos/],
    [[...demoIds, "unmapped"], /unmapped.*mapping/],
  ])("requires nonempty mapped demos %j", async (demos, diagnostic) => {
    integration("omnara", true, demos as string[]);
    expect(await errors()).toMatch(diagnostic as RegExp);
  });
  it("requires actual mapped registrations", async () => {
    D5_REGISTRY.delete("frontend-tools");
    expect(await errors()).toMatch(/frontend-tools.*registered/);
  });
  it.each(["warn", "error", "throw"] as const)(
    "rejects shared loader %s failures",
    async (failure) => {
      vi.spyOn(scripts, "defaultScriptLoader").mockImplementation(
        async (ctx) => {
          if (failure === "throw") throw new Error("broken import");
          ctx.logger[failure]("script-import-failed", { err: "broken import" });
        },
      );
      expect(await errors()).toMatch(
        /shared script loading failed.*broken import/,
      );
    },
  );
  it.each([
    undefined,
    "../chat.json",
    "/chat.json",
    "nested/chat.json",
    "..\\chat.json",
  ])("rejects absent or unsafe fixture basename %s", async (basename) => {
    D5_REGISTRY.set("agentic-chat", {
      ...D5_REGISTRY.get("agentic-chat")!,
      fixtureFile: basename,
    });
    expect(await errors()).toMatch(/agentic-chat.*fixture.*basename/);
  });
  it.each([
    null,
    "{",
    "{}",
    '{"fixtures":[]}',
    '{"fixtures":[{}]}',
    '{"fixtures":[{"match":{"context":"omnara"},"response":{}}]}',
  ])(
    "rejects missing, malformed, empty or invalid inventory %s",
    async (raw) => {
      if (raw === null) fs.unlinkSync(file(fixtureFile));
      else write(fixtureFile, raw);
      expect(await errors()).toMatch(
        /agentic-chat.*aimock\/d6\/omnara\/agentic-chat.json/,
      );
    },
  );
  it.each(["another-slug", undefined, "mixed"])(
    "requires exact-slug inventory, context=%s",
    async (context) => {
      const data = JSON.parse(read(fixtureFile));
      const altered = data.fixtures.map((f: any) => ({
        ...f,
        match: {
          ...f.match,
          context: context === "mixed" ? undefined : context,
        },
      }));
      write(
        fixtureFile,
        JSON.stringify({
          fixtures:
            context === "mixed" ? [...altered, ...data.fixtures] : altered,
        }),
      );
      expect((await check()).exitCode).toBe(context === "mixed" ? 0 : 1);
    },
  );
});
it("validates actual Omnara schema and rejects unsupported modes", () => {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(
    JSON.parse(
      fs.readFileSync(
        path.join(showcase, "shared/manifest.schema.json"),
        "utf8",
      ),
    ),
  );
  const manifest = yaml.parse(
    fs.readFileSync(
      path.join(showcase, "integrations/omnara/manifest.yaml"),
      "utf8",
    ),
  );
  const { test_coverage, ...legacy } = manifest;
  expect(test_coverage).toBe("shared-d6");
  expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  expect(validate({ ...manifest, test_coverage: "shared-d5" })).toBe(false);
  expect(validate(legacy)).toBe(true);
});
