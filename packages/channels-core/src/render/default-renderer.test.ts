import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
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

// Points `takumi-js` at a package that does not exist, so Node's own resolver
// fails exactly as in an app that never installed the peer.
const hideTakumi = `
export async function resolve(specifier, context, next) {
  return next(specifier === "takumi-js" ? "takumi-js-not-installed" : specifier, context);
}`;

const RED = [220, 30, 30] as const;
const BLUE = [30, 30, 220] as const;

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
const { jsx, Fragment } = await import(${JSON.stringify(url("jsx-runtime.js"))});

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
// A host root holding a fragment of keyed component nodes: exercises the
// fragment, key and component paths of the converter under native ESM.
const Swatch = ({ color }) =>
  jsx("div", { style: { flexGrow: 1, height: "100%", backgroundColor: color } });
const card = jsx("div", {
  style: { display: "flex", width: "100%", height: "100%" },
  children: jsx(Fragment, {
    children: [
      jsx(Swatch, { color: "rgb(${RED.join(", ")})" }, "left"),
      jsx(Swatch, { color: "rgb(${BLUE.join(", ")})" }, "right"),
    ],
  }),
});
try {
  await thread.post(card, { filename: "card.png" });
  console.log(JSON.stringify({ ok: true, uploads: uploads.length, png: Buffer.from(uploads[0].bytes).toString("base64") }));
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

function countPixels(
  png: { data: Uint8Array },
  [r, g, b]: readonly number[],
): number {
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (
      png.data[i + 3]! >= 128 &&
      Math.abs(png.data[i]! - r!) < 40 &&
      Math.abs(png.data[i + 1]! - g!) < 40 &&
      Math.abs(png.data[i + 2]! - b!) < 40
    )
      n++;
  }
  return n;
}

describe("default image renderer in plain Node", () => {
  it("loads takumi-js at call time and uploads a PNG", () => {
    const result = postImage({ hideTakumi: false });
    expect(result).toMatchObject({ ok: true, uploads: 1 });
    const png = PNG.sync.read(Buffer.from(result.png!, "base64"));
    expect([png.width, png.height]).toEqual([64, 32]);
    // Both keyed swatches inside the fragment were rendered.
    expect(countPixels(png, RED)).toBeGreaterThan(200);
    expect(countPixels(png, BLUE)).toBeGreaterThan(200);
  }, 30_000);

  it("names the missing optional peers when takumi-js is not installed", () => {
    const result = postImage({ hideTakumi: true });
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "JSX image rendering needs the optional peer dependencies `react` and `takumi-js`. Install them (for example `pnpm add react takumi-js`); if they are installed, make sure your deployment ships them with the server.",
    );
  }, 30_000);
});
