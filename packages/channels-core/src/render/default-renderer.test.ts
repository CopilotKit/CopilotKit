import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";

// Runs the BUILT package in a plain Node process, with no bundler or module
// mocking in between: the render path loads its optional peers through native
// `import()`, and that is what an app's server actually executes. A vitest
// module mock cannot stand in here, since it wraps a failing factory and drops
// the resolver's error code. `nx test` depends on `build`, so dist is current.

const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist",
);
const url = (file: string) => pathToFileURL(path.join(dist, file)).href;

// Makes `takumi-js` unresolvable, as in an app that never installed the peer.
const hideTakumi = `
export async function resolve(specifier, context, next) {
  if (specifier === "takumi-js") {
    throw Object.assign(new Error("Cannot find package 'takumi-js'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
  }
  return next(specifier, context);
}`;

function postImage(options: { hideTakumi: boolean }) {
  const script = `
import { register } from "node:module";
if (${options.hideTakumi}) {
  register("data:text/javascript," + encodeURIComponent(${JSON.stringify(hideTakumi)}));
}
const { Thread } = await import(${JSON.stringify(url("thread.js"))});
const { FakeAdapter } = await import(${JSON.stringify(url("testing/fake-adapter.js"))});
const { ActionRegistry } = await import(${JSON.stringify(url("action-registry.js"))});
const { MemoryStore } = await import(${JSON.stringify(url("state/memory-store.js"))});
const { kvActionStore } = await import(${JSON.stringify(url("state/kv-action-store.js"))});
const { jsx } = await import(${JSON.stringify(url("jsx-runtime.js"))});

const adapter = new FakeAdapter();
const uploads = [];
adapter.postFile = async (_target, args) => {
  uploads.push(args);
  return { ok: true, messageId: "M1" };
};
const store = new MemoryStore();
const thread = new Thread({
  adapter,
  replyTarget: {},
  conversationKey: "c",
  registry: new ActionRegistry({ store: kvActionStore(store) }),
  agentFactory: () => { throw new Error("no agent"); },
  tools: new Map(),
  toolDescriptors: [],
  context: [],
  registerWaiter: () => {},
  interruptHandlers: new Map(),
  state: store,
  user: null,
  actor: { id: "actor", kind: "unknown" },
  channelName: "test",
  threadId: "c",
  render: { width: 64, height: 32 },
});
const box = jsx("div", { style: { width: "100%", height: "100%", backgroundColor: "rgb(90, 60, 209)" } });
try {
  await thread.post(box, { filename: "box.png" });
  console.log(JSON.stringify({ ok: true, uploads: uploads.length, png: Buffer.from(uploads[0].bytes).subarray(1, 4).toString() }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, message: err.message }));
}
`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--no-warnings", "-e", script],
    { encoding: "utf8", cwd: path.dirname(dist) },
  );
  expect(child.status, child.stderr).toBe(0);
  const lastLine = child.stdout.trim().split("\n").pop() ?? "";
  return JSON.parse(lastLine) as {
    ok: boolean;
    uploads?: number;
    png?: string;
    message?: string;
  };
}

describe("default image renderer in plain Node", () => {
  it("loads takumi-js at call time and uploads a PNG", () => {
    expect(postImage({ hideTakumi: false })).toEqual({
      ok: true,
      uploads: 1,
      png: "PNG",
    });
  }, 30_000);

  it("names the missing optional peers when takumi-js is not installed", () => {
    const result = postImage({ hideTakumi: true });
    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      "JSX image rendering needs the optional peer dependencies `react` and `takumi-js`",
    );
  }, 30_000);
});
