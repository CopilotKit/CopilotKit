import { chat } from "@tanstack/ai";
import { codexText } from "@tanstack/ai-codex";
import { defineSandbox, localSource, withSandbox } from "@tanstack/ai-sandbox";
import { localProcessSandbox } from "@tanstack/ai-sandbox-local-process";

/**
 * The VIRTUAL workspace root every sandbox provider presents to a harness, and
 * the codex adapter's own default for `cwd`. It is NOT a host path: the
 * local-process handle maps it onto whatever real directory backs the sandbox
 * (`LocalProcessHandle.resolve`), which is why the real scratch dir is handed to
 * the PROVIDER as `dir` and never to the adapter as `cwd`. See the block comment
 * on `createExpenseHarnessStream`.
 */
const SANDBOX_WORKSPACE_ROOT = "/workspace";

/**
 * Bridge our caller's `AbortSignal` onto the `AbortController` `chat()` wants.
 * Forwarding the reason keeps a cancel distinguishable from a timeout in the
 * error the stream ends with.
 */
const controllerFor = (signal: AbortSignal): AbortController => {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller;
};

/**
 * The ONE place the harness is launched. Shared verbatim by both arms — Arm A
 * drains it privately; Arm C hands it to `BuiltInAgent`'s tanstack stream
 * factory. Keeping the launch here is what makes the two arms a one-file diff
 * rather than two implementations.
 *
 * `withSandbox()` is MANDATORY: `codexText` declares
 * `requires = [SandboxCapability]` and throws
 * ("Adapter \"codex\" requires a sandbox…") without it, because it spawns
 * `codex exec --experimental-json` THROUGH the sandbox handle rather than
 * directly on the host.
 *
 * We use the LOCAL-PROCESS provider, which runs on the host with no isolation.
 * That is deliberate for a presenter demo: the Homebrew `codex` binary and an
 * existing `codex login` are reachable, and there is no image to build. A hosted
 * deploy would need the Docker provider instead — the isolation this one lacks
 * is exactly what a shared environment requires.
 *
 * ## Why the scratch dir is the provider's `dir`, not the adapter's `cwd`
 *
 * `CodexTextConfig.cwd` is a path in the sandbox's VIRTUAL filesystem, not on
 * the host. The adapter documents this at its `buildCommand` (it deliberately
 * does NOT pass `--cd`), and the local-process handle enforces it: `resolve()`
 * strips a leading `/` and resolves the REMAINDER against the sandbox root. So
 * `cwd: "/var/folders/…/harness-x"` would silently become
 * `<sandbox-root>/var/folders/…/harness-x` — a directory that does not exist,
 * holding none of `prepareWorkspace`'s `expenses.csv`.
 *
 * Pointing the PROVIDER at the dir instead makes the scratch dir the sandbox
 * root, so the virtual root and the real dir are the same place. That also
 * settles teardown: `removeOnDestroy` defaults to FALSE whenever `dir` is set,
 * so the sandbox's destroy never deletes the directory `readSummary` is about to
 * read out of.
 */
export const createExpenseHarnessStream = (opts: {
  dir: string;
  prompt: string;
  abortSignal: AbortSignal;
}): AsyncIterable<unknown> =>
  chat({
    // NOT a `*-codex` model, deliberately. The codex-branded ids are rejected
    // outright on a ChatGPT-account `codex login` — `gpt-5.1-codex` comes back
    // 400 "The 'gpt-5.1-codex' model is not supported when using Codex with a
    // ChatGPT account", and it arrives as a RUN_ERROR *chunk* rather than a
    // throw, so it reads as a harness that ran and said nothing. This id is
    // reachable on both auth modes and is what the gate probe's successful runs
    // used. It rides the `(string & {})` escape hatch in `CodexModel` (it is not
    // in `CODEX_MODELS`), which is supported — the harness accepts any id its
    // backend does. Switching back is a one-line change once an API key exists.
    adapter: codexText("gpt-5.6-sol", {
      // The virtual root, which the provider maps to `opts.dir` (see above).
      cwd: SANDBOX_WORKSPACE_ROOT,
      // Codex's OWN --sandbox flag, independent of the TanStack sandbox above:
      // lets it write summary.json and its scripts, nothing wider.
      sandboxMode: "workspace-write",
      // Both required by the beat: the prompt's step 2 searches every unknown
      // merchant, step 4 POSTs to the local ledger.
      networkAccessEnabled: true,
      webSearchMode: "live",
      modelReasoningEffort: "high",
      // The scratch dir is not a git repo and does not need to be.
      skipGitRepoCheck: true,
      // VISIBLE THINKING — the feature's headline claim, and NOT implied by
      // `modelReasoningEffort` above. Effort governs how hard the model thinks;
      // this governs whether it ever SUMMARISES that thinking on the wire.
      // Without it the gate probe observed ZERO `REASONING_*` chunks: the run
      // works, reasons hard, and streams nothing to show for it.
      //
      // `"auto"` specifically. `"detailed"` is the tempting choice and is WRONG
      // here — measured, it yields no reasoning items at all.
      //
      // The inner quotes are load-bearing: `config` values are interpolated
      // into `--config key=value` VERBATIM as TOML, so a TOML string has to
      // arrive already quoted (the same shape the adapter builds by hand for
      // `model_reasoning_effort`).
      config: { model_reasoning_summary: '"auto"' },
    }),
    messages: [{ role: "user", content: opts.prompt }],
    // `chat()` takes an AbortController, NOT a signal — and this is the wiring
    // that makes cancel real rather than cosmetic: the adapter forwards this
    // controller's signal to `spawnNdjson`, where the local-process handle
    // registers it to `killTree` the codex process group. Drop it and a
    // cancelled run leaves `codex` burning tokens with nobody listening.
    abortController: controllerFor(opts.abortSignal),
    middleware: [
      withSandbox(
        defineSandbox({
          id: "banking-expense-harness",
          // The scratch dir IS the sandbox root; nothing to build or copy.
          provider: localProcessSandbox({ dir: opts.dir }),
          // MANDATORY, and not for the reason its name suggests. `withSandbox`
          // declares `provides: [SandboxCapability, ProjectionCapability]`
          // unconditionally, but only calls `provideWorkspaceProjection()` when
          // the definition carries a `workspace` — and `@tanstack/ai`'s
          // middleware runner throws when a DECLARED capability is never
          // provided ('provides "sandbox-projection" but never called
          // provide()'). Omit this block and the run dies at middleware setup,
          // before it can reach the model at all.
          //
          // It is a no-op on disk, which the gate probe verified across two runs
          // (`expenses.csv` survived both, and the harness wrote `summary.json`
          // normally). `bootstrapWorkspace` lands a source only when
          // `source.type === "git"`; with no `skills`, no `instructions`, no
          // `scripts` and no `setup`, every other write it can perform is
          // skipped too. So this declares where the tree already is rather than
          // asking for one to be created — `prepareWorkspace` populated it.
          //
          // ONE cosmetic side effect, observed and benign: the projector's
          // idempotency marker gets its path resolved TWICE — once by
          // `resolveHarnessCwd` (virtual `/workspace` → the real dir) and again
          // by `handle.fs.write` (which strips the leading `/` and re-roots it),
          // so an empty `.tanstack-projected-<hash>` lands under a mirrored
          // `var/folders/…/` tree inside the scratch dir instead of at its top.
          // Nothing reads it (the projection is a no-op here anyway) and
          // `expenses.csv`/`summary.json` are untouched — but do not go hunting
          // for a rogue harness when you see that directory.
          workspace: {
            root: SANDBOX_WORKSPACE_ROOT,
            source: localSource(opts.dir),
          },
          lifecycle: {
            // Every run gets a FRESH `mkdtemp` dir from `prepareWorkspace`, so
            // resuming a previous run's sandbox record would root this run at a
            // stale (or deleted) directory — `provider.resume` honours the
            // recorded id, not our `dir`. Keying the instance by thread AND run
            // makes that structurally impossible.
            reuse: "none",
            // Prune this run's instance record on finish/error (abort already
            // destroys unconditionally). It does NOT reclaim anything on disk or
            // in the process table: `provider.destroy` holds no handle, so it
            // cannot kill children, and it skips the directory because
            // `removeOnDestroy` is false for a fixed `dir` — both of which are
            // what we want, since `readSummary` still has to read the dir. What
            // it does buy is the record itself: `reuse: "none"` mints a new key
            // per run, and without a destroy those pile up forever in the
            // MODULE-LEVEL fallback instance store. The codex process is
            // reclaimed by the abort signal above (`killTree`), or has already
            // exited on its own when the run finishes normally.
            destroyOnComplete: true,
          },
        }),
      ),
    ],
  });
