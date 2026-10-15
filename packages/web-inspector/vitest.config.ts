import { defineConfig } from "vitest/config";

// Node 25.0 unflagged the experimental Web Storage API (nodejs/node#57658),
// so on Node 25+ a stub `window.localStorage` is installed BEFORE vitest's
// jsdom environment runs. vitest's jsdom env does NOT replace it, so the
// stub stays in place — and it has no `.clear()` / `.getItem()` /
// `.setItem()` methods. Any test that touches localStorage crashes with
// `TypeError: window.localStorage.clear is not a function`.
//
// This is NOT fixed by upgrading vitest or jsdom:
//   - vitest 4.x + jsdom 29 still leave Node's stub in place — confirmed
//     in vitest-dev/vitest#8757 (closed as "non-LTS, won't fix").
//   - Node 25.2.0 tried throwing on access; 25.2.1 reverted it as too
//     breaking. The Node-side fix was targeted for 26.0
//     (nodejs/node#60303). Node 26 still ships a stub / empty accessor,
//     so `window.localStorage.getItem` is missing and host tests that
//     mount the inspector crash.
//
// On Node 22.4–24.x, the API exists but stays behind
// `--experimental-webstorage`, so nothing gets installed and tests pass
// without any workaround. The bug bites on Node 25+.
//
// Workaround: pass `--no-experimental-webstorage` to the vitest worker so
// Node doesn't install the stub and jsdom owns the localStorage globals
// cleanly. This is the canonical community workaround (also used by
// happy-dom#1950, ArkType, and the vitest#8757 thread).
//
// The flag exists from Node 22.4 onward. Passing it to older Node makes
// Node refuse to start with "not allowed in NODE_OPTIONS". On Node
// 22.4–24.x the flag is a harmless no-op. Keep it on 26 until Node
// gives jsdom a real Storage object.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const needsNoExperimentalWebstorage =
  nodeMajor! > 22 || (nodeMajor === 22 && nodeMinor! >= 4);

const workerExecArgv = needsNoExperimentalWebstorage
  ? ["--no-experimental-webstorage"]
  : [];

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    clearMocks: true,
    setupFiles: ["./vitest.setup.ts"],
    reporters: [["default", { summary: false }]],
    silent: true,
    poolOptions: {
      forks: { execArgv: workerExecArgv },
      threads: { execArgv: workerExecArgv },
    },
  },
});
