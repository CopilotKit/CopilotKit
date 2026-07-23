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
//     breaking. The real Node-side fix is targeted for Node 26.0
//     (semver-major), no backport — see nodejs/node#60303.
//
// On Node 22.4–24.x, the API exists but stays behind
// `--experimental-webstorage`, so nothing gets installed and tests pass
// without any workaround. The bug ONLY bites on Node 25+.
//
// Workaround: pass `--no-experimental-webstorage` to the vitest worker so
// Node doesn't install the stub and jsdom owns the localStorage globals
// cleanly. This is the canonical community workaround (also used by
// happy-dom#1950, ArkType, and the vitest#8757 thread).
//
// Version gate:
//   - Lower bound (Node 22.4+): the flag only exists from Node 22.4
//     onward. Passing it to older Node (e.g. CI's Node 20) makes Node
//     refuse to start with "not allowed in NODE_OPTIONS". On Node
//     22.4–24.x the flag is a harmless no-op since webstorage is still
//     gated by --experimental-webstorage, but we keep the lower bound
//     strict so we don't silently fail closed on Node 20.
//   - Upper bound (Node < 26): Node 26 is expected to land the upstream
//     fix and may remove / rename this flag as part of the unflagging
//     cleanup. We gate the upper bound so this config doesn't blow up
//     on Node 26+ in the future. Node 26 isn't out as of this commit,
//     so the upper bound is purely defensive.
//
// When the minimum supported Node version is >=26 (which will be a long
// time — Node 26 will likely arrive in late 2026 and need to age into
// LTS), this whole block can be removed outright.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const needsNoExperimentalWebstorage =
  // lower bound: flag exists (Node 22.4+)
  (nodeMajor! > 22 || (nodeMajor === 22 && nodeMinor! >= 4)) &&
  // upper bound: Node hasn't fixed the underlying bug yet (< 26)
  nodeMajor! < 26;

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
