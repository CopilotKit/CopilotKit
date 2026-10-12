import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO_LOCAL_GIT_VARS,
  SKIP_DIRECTORIES,
  SKIP_FILES,
  requiresConformance,
  gatePassed,
} from "../gate.mjs";

/** The parent environment without repo-locating git variables, plus overrides. */
function fixtureEnv(overrides = {}) {
  const env = { ...process.env };
  for (const name of REPO_LOCAL_GIT_VARS) delete env[name];
  return { ...env, ...overrides };
}

test("runtime, fixture, dependency, and gate changes require conformance", () => {
  for (const path of [
    "packages/runtime/src/v2/runtime/runner/intelligence.ts",
    "packages/shared/src/index.ts",
    "packages/core/src/index.ts",
    "packages/runtime-python/src/copilotkit_runtime/runtime.py",
    "packages/runtime-go/runtime.go",
    "packages/runtime-ruby/lib/copilotkit/runtime.rb",
    "packages/runtime-dotnet/src/IntelligenceRuntime.cs",
    "tools/runtime-conformance/platform.mjs",

    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "package.json",
    "nx.json",
    "tsconfig.base.json",
    ".github/workflows/intelligence-runtimes.yml",
    ".github/CODEOWNERS",
  ]) {
    assert.equal(requiresConformance([path]), true, path);
  }
});

test("workspace packages the conformance build compiles require conformance", () => {
  // Transitive workspace dependencies of @copilotkit/runtime and
  // @copilotkit/core, which every leg builds with `nx run-many -t build`.
  for (const path of [
    "packages/channels/src/index.ts",
    "packages/channels-core/src/index.ts",
    "packages/channels-discord/src/index.ts",
    "packages/channels-intelligence/src/index.ts",
    "packages/channels-slack/src/index.ts",
    "packages/channels-teams/src/index.ts",
    "packages/channels-telegram/src/index.ts",
    "packages/channels-ui/src/index.ts",
    "packages/channels-whatsapp/src/index.ts",
    "packages/learning/src/index.ts",
    "packages/tsconfig/base.json",
    "packages/typescript-config/base.json",
    ".npmrc",
    ".pnpmfile.cjs",
  ]) {
    assert.equal(requiresConformance([path]), true, path);
  }
});

test("a pull request touching only a runtime dependency requires conformance", () => {
  scopeFixture(({ git, commitFile, scope }) => {
    commitFile("README.md");
    git("switch", "-c", "feature");
    const head = commitFile("packages/channels-ui/src/index.ts");
    git("switch", "main");
    git("merge", "--no-ff", "-m", "merge", "feature");
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA: head }),
      "required=true",
    );
  });
});

test("docs-only and empty changes do not require native toolchains", () => {
  assert.equal(
    requiresConformance(["showcase/shell-docs/README.md", "README.md"]),
    false,
  );
  assert.equal(requiresConformance([]), false);
});

test("the gate accepts a successful matrix or an explicit unrelated change", () => {
  assert.equal(gatePassed("success", "true", "success"), true);
  assert.equal(gatePassed("success", "false", "skipped"), true);
});

test("the gate rejects failed, cancelled, missing, and unexpectedly skipped jobs", () => {
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    assert.equal(gatePassed("success", "true", result), false);
  }
  assert.equal(gatePassed("failure", "false", "skipped"), false);
  assert.equal(gatePassed("cancelled", "true", "success"), false);
  assert.equal(gatePassed("success", undefined, "success"), false);
  assert.equal(gatePassed("success", "false", "failure"), false);
});

test("moving a runtime file outside the package still requires conformance", () => {
  const cwd = mkdtempSync(join(tmpdir(), "runtime-gate-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: fixtureEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init");
    mkdirSync(join(cwd, "packages", "runtime"), { recursive: true });
    mkdirSync(join(cwd, "docs"));
    writeFileSync(
      join(cwd, "packages", "runtime", "index.ts"),
      "export const runtime = true;\n",
    );
    git("add", ".");
    git(
      "-c",
      "user.name=Gate Test",
      "-c",
      "user.email=gate@example.test",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    );
    const base = git("rev-parse", "HEAD");
    git("mv", "packages/runtime/index.ts", "docs/runtime.ts");
    git(
      "-c",
      "user.name=Gate Test",
      "-c",
      "user.email=gate@example.test",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "move fixture",
    );
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("../gate.mjs", import.meta.url)), "scope"],
      {
        cwd,
        encoding: "utf8",
        env: fixtureEnv({ GITHUB_EVENT_NAME: "push", BASE_SHA: base }),
      },
    );
    assert.equal(output.trim(), "required=true");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("unrelated frontend packages skip native toolchains", () => {
  assert.equal(
    requiresConformance([
      "packages/react-core/src/index.ts",
      "packages/react-ui/src/index.ts",
    ]),
    false,
  );
});

test("build inputs outside the runtime packages require conformance", () => {
  for (const path of [
    // packages/runtime `build` runs this after tsdown.
    "scripts/deprecations/v1-dist-notices.mjs",
    // nx.json lists these as check-dts inputs; the TypeScript leg runs check-dts.
    "scripts/validate-dts-ambient.ts",
    "scripts/validate-x.ts",
    // Any script may become a build input, so all of scripts/ is required.
    "scripts/doc-tests/run.ts",
    // oxlint reads the root config for `runtime-conformance:lint`.
    ".oxlintrc.json",
    // Both .NET csproj files pack ../../../LICENSE.
    "LICENSE",
    // pnpm applies patchedDependencies from here during install.
    "patches/eventsource@3.0.7.patch",
    // `pnpm install` runs the root `prepare` script, `lefthook install`.
    "lefthook.yml",
    ".gitattributes",
    ".gitignore",
    "tsconfig.json",
    // runtime tests import this package's conformance snapshot by path.
    "packages/intelligence-delivery-core/conformance/snapshots.v1.json",
  ]) {
    assert.equal(requiresConformance([path]), true, path);
  }
});

test("a path outside the skip-list requires conformance, even a new one", () => {
  for (const path of [
    "brand-new-dir/index.ts",
    "new-root-file.json",
    "packages/brand-new-package/src/index.ts",
    "tools/brand-new-tool/run.mjs",
    ".github/actions/setup/action.yml",
  ]) {
    assert.equal(requiresConformance([path]), true, path);
  }
});

test("REPO_LOCAL_GIT_VARS covers the installed git's --local-env-vars", () => {
  const listed = execFileSync("git", ["rev-parse", "--local-env-vars"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  assert.ok(listed.length > 0, "git printed no local env vars");
  for (const name of listed) {
    assert.ok(REPO_LOCAL_GIT_VARS.includes(name), name);
  }
});

test("every skip-list entry skips the matrix", () => {
  for (const path of [
    "AGENTS.md",
    "CHANGELOG.md",
    "CLAUDE.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "README.md",
    "SECURITY.md",
    "VERSIONING.md",
    ".coderabbit.yaml",
    ".dockerignore",
    ".kodiak.toml",
    ".mcp.json",
    ".nvmrc",
    "commitlint.config.js",
    "dangerfile.js",
    "deploy-starter.sh",
    "docs",
    "release.config.json",
    "renovate.json",
    ".claude/docs/git.md",
    ".claude-plugin/plugin.json",
    ".cursor/rules/x.mdc",
    ".github/ISSUE_TEMPLATE/bug.yml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/config-allowlist.txt",
    ".github/scripts/check-config-allowlist.sh",
    ".github/workflows/other.yml",
    ".github/zizmor.yml",
    ".superset/config.json",
    "assets/logo.png",
    "codemods/x.ts",
    "community/x/README.md",
    "dev-docs/x.md",
    "docs/x.md",
    "examples/v2/react/demo/src/app.tsx",
    "prds/x.md",
    "sdk-python/copilotkit/x.py",
    "showcase/shell-docs/src/content/x.mdx",
    "skills/x/SKILL.md",
    "tasks/x.md",
    "tools/compatibility-monitor/x.mjs",
    "tools/intelligence-smoke/run.mjs",
    "tools/learned-skill-conformance/x.mjs",
    "packages/a2ui-renderer/src/x.ts",
    "packages/agentcore-runner/src/x.ts",
    "packages/angular/src/x.ts",
    "packages/demo-agents/src/x.ts",
    "packages/intelligence-adk-python/x.py",
    "packages/intelligence-agent-framework-dotnet/x.cs",
    "packages/intelligence-delivery-python-core/x.py",
    "packages/intelligence-langgraph/src/x.ts",
    "packages/intelligence-langgraph-python/x.py",
    "packages/intelligence-mastra/src/x.ts",
    "packages/mcp-apps-renderer/src/x.ts",
    "packages/react-core/src/x.ts",
    "packages/react-native/src/x.ts",
    "packages/react-textarea/src/x.ts",
    "packages/react-ui/src/x.ts",
    "packages/runtime-client-gql/src/x.ts",
    "packages/sdk-js/src/x.ts",
    "packages/sqlite-runner/src/x.ts",
    "packages/tailwind-config/x.js",
    "packages/voice/src/x.ts",
    "packages/vue/src/x.ts",
    "packages/web-components/src/x.ts",
    "packages/web-inspector/src/x.ts",
    ...SKIP_FILES,
    ...SKIP_DIRECTORIES.map((dir) => `${dir}/x.md`),
  ]) {
    assert.equal(requiresConformance([path]), false, path);
  }
});

test("skip-list entries match whole paths, not look-alikes", () => {
  for (const path of [
    // A skipped package name is only a prefix of these.
    "packages/react-core-next/src/index.ts",
    "packages/runtime-client-gql-next/src/index.ts",
    "packages/vue2/src/index.ts",
    "tools/intelligence-smoke-next/run.mjs",
    // A skipped directory name appears inside a required path.
    "packages/runtime/src/examples/x.ts",
    "scripts/docs/x.ts",
    "tools/runtime-conformance/showcase/x.mjs",
    // A skipped root file name appears below the root or with a suffix.
    "packages/runtime/README.md",
    "packages/runtime/LICENSE",
    "README.md.bak",
    "xREADME.md",
    "docsx",
    // A skipped top-level directory without its separator.
    "examples.json",
    // Required files inside a skipped directory.
    ".github/workflows/intelligence-runtimes.yml",
    ".github/CODEOWNERS",
  ]) {
    assert.equal(requiresConformance([path]), true, path);
  }
});

test("a workspace or project-graph manifest requires conformance, even in a skipped directory", () => {
  // Every matrix leg runs `pnpm install --frozen-lockfile`, which reads the
  // manifest of every workspace member, and builds the Nx project graph, which
  // reads every project.json in the repository. A manifest edit anywhere can
  // fail both, so the rule matches the file name in any directory.
  for (const path of [
    "packages/vue/package.json",
    "examples/v2/react/demo/package.json",
    "examples/v2/interrupts-langgraph/apps/web/project.json",
    "tools/learned-skill-conformance/package.json",
    "tools/learned-skill-conformance/project.json",
    "packages/web-inspector/project.json",
    "showcase/shared/typescript/project.json",
    "showcase/harness/package.json",
    "community/x/package.json",
    // pnpm also reads a member manifest written as YAML or JSON5.
    "packages/vue/package.yaml",
    "packages/vue/package.json5",
  ]) {
    assert.equal(requiresConformance([path]), true, path);
  }
});

test("other files beside a skipped manifest still skip the matrix", () => {
  for (const path of [
    "packages/vue/README.md",
    "packages/vue/src/package.json.ts",
    "packages/vue/my-package.json",
    "packages/vue/package.json.bak",
    "packages/vue/project.jsonc",
    "packages/vue/tsconfig.json",
    "examples/v2/react/demo/README.md",
    "tools/learned-skill-conformance/x.mjs",
  ]) {
    assert.equal(requiresConformance([path]), false, path);
  }
});

test("a pull request touching only a skipped package manifest requires conformance", () => {
  scopeFixture(({ git, commitFile, scope }) => {
    commitFile("README.md");
    git("switch", "-c", "feature");
    const head = commitFile("packages/vue/package.json");
    git("switch", "main");
    git("merge", "--no-ff", "-m", "merge", "feature");
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA: head }),
      "required=true",
    );
  });
});

test("a pull request touching only docs in a skipped package does not require conformance", () => {
  scopeFixture(({ git, commitFile, scope }) => {
    commitFile("packages/vue/package.json");
    git("switch", "-c", "feature");
    const head = commitFile("packages/vue/README.md");
    git("switch", "main");
    git("merge", "--no-ff", "-m", "merge", "feature");
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA: head }),
      "required=false",
    );
  });
});

test("one runtime file among skipped files requires conformance", () => {
  assert.equal(
    requiresConformance([
      "README.md",
      "showcase/shell-docs/src/content/x.mdx",
      "scripts/deprecations/v1-dist-notices.mjs",
    ]),
    true,
  );
});

test("a pull request touching only a runtime build script requires conformance", () => {
  scopeFixture(({ git, commitFile, scope }) => {
    commitFile("README.md");
    git("switch", "-c", "feature");
    const head = commitFile("scripts/deprecations/v1-dist-notices.mjs");
    git("switch", "main");
    git("merge", "--no-ff", "-m", "merge", "feature");
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA: head }),
      "required=true",
    );
  });
});

test("a pull request adding a new top-level directory requires conformance", () => {
  scopeFixture(({ git, commitFile, scope }) => {
    commitFile("README.md");
    git("switch", "-c", "feature");
    const head = commitFile("brand-new-dir/index.ts");
    git("switch", "main");
    git("merge", "--no-ff", "-m", "merge", "feature");
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA: head }),
      "required=true",
    );
  });
});

/** Build a throwaway repository and run the scope command inside it. */
function scopeFixture(run, { objectFormat = "sha1" } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "runtime-gate-"));
  // The git trace wrapper and its log live outside the fixture repository, so
  // `git add .` never commits them and they never appear in a scoped diff.
  const traceDir = mkdtempSync(join(tmpdir(), "runtime-gate-trace-"));
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Gate Test",
        "-c",
        "user.email=gate@example.test",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      {
        cwd,
        encoding: "utf8",
        env: fixtureEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  const commitFile = (path) => {
    mkdirSync(join(cwd, path, ".."), { recursive: true });
    writeFileSync(join(cwd, path), `${path}\n`);
    git("add", ".");
    git("commit", "-m", path);
    return git("rev-parse", "HEAD");
  };
  const scope = (env) =>
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("../gate.mjs", import.meta.url)), "scope"],
      {
        cwd,
        encoding: "utf8",
        env: fixtureEnv({
          GITHUB_EVENT_NAME: "",
          BASE_SHA: "",
          PR_HEAD_SHA: "",
          ...env,
        }),
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  // Run scope with a git wrapper first on PATH that logs every argument it
  // receives, so a test can prove which values reached git. Tests must assert
  // that an expected call was logged before they assert an argument is absent:
  // an empty log also results when the wrapper is not on PATH.
  const traced = (env) => {
    const bin = join(traceDir, "bin");
    const log = join(traceDir, "log");
    mkdirSync(bin, { recursive: true });
    writeFileSync(log, "");
    const realGit = execFileSync("sh", ["-c", "command -v git"], {
      encoding: "utf8",
      env: fixtureEnv(),
    }).trim();
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> '${log}'; done\nexec '${realGit}' "$@"\n`,
    );
    chmodSync(join(bin, "git"), 0o755);
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../gate.mjs", import.meta.url)), "scope"],
      {
        cwd,
        encoding: "utf8",
        env: fixtureEnv({
          GITHUB_EVENT_NAME: "",
          BASE_SHA: "",
          PR_HEAD_SHA: "",
          ...env,
          PATH: `${bin}:${process.env.PATH}`,
        }),
      },
    );
    return {
      status: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr,
      gitArgs: readFileSync(log, "utf8").split("\n").filter(Boolean),
    };
  };
  try {
    git("init", "-b", "main", `--object-format=${objectFormat}`);
    run({ git, commitFile, scope, traced });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(traceDir, { recursive: true, force: true });
  }
}

/** Assert that the traced scope run passed each argument to git. */
function assertReachedGit(result, ...args) {
  for (const arg of args) {
    assert.ok(
      result.gitArgs.includes(arg),
      `expected git to receive ${JSON.stringify(arg)}: ${result.gitArgs.join(" ")}`,
    );
  }
}

test("a pull request is scoped to its merge commit, not the stale base sha", () => {
  scopeFixture(({ git, commitFile, scope }) => {
    const staleBase = commitFile("README.md");
    git("switch", "-c", "feature");
    const head = commitFile("docs/guide.md");
    git("switch", "main");
    commitFile("packages/runtime/index.ts");
    git("merge", "--no-ff", "-m", "merge", "feature");
    assert.equal(
      scope({
        GITHUB_EVENT_NAME: "pull_request",
        BASE_SHA: staleBase,
        PR_HEAD_SHA: head,
      }),
      "required=false",
    );
  });
});

test("a pull request merge commit with runtime changes requires conformance", () => {
  scopeFixture(({ git, commitFile, scope }) => {
    commitFile("README.md");
    git("switch", "-c", "feature");
    const head = commitFile("packages/core/index.ts");
    git("switch", "main");
    git("merge", "--no-ff", "-m", "merge", "feature");
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA: head }),
      "required=true",
    );
  });
});

test("a pull request head that merged main in is not mistaken for GitHub's merge", () => {
  scopeFixture(({ git, commitFile, scope }) => {
    commitFile("README.md");
    git("switch", "-c", "feature");
    commitFile("packages/runtime/index.ts");
    git("switch", "main");
    commitFile("docs/guide.md");
    git("switch", "feature");
    git("merge", "--no-ff", "-m", "merge main into feature", "main");
    const head = git("rev-parse", "HEAD");
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA: head }),
      "required=true",
    );
  });
});

test("a pull request merge commit whose second parent is not the head runs everything", () => {
  scopeFixture(({ git, commitFile, scope }) => {
    const base = commitFile("README.md");
    git("switch", "-c", "feature");
    commitFile("docs/guide.md");
    git("switch", "main");
    git("merge", "--no-ff", "-m", "merge", "feature");
    // Control: with the real head, the docs-only merge is scoped.
    assert.equal(
      scope({
        GITHUB_EVENT_NAME: "pull_request",
        PR_HEAD_SHA: git("rev-parse", "HEAD^2"),
      }),
      "required=false",
    );
    // Well-formed commit ids that are not the merge's second parent.
    for (const PR_HEAD_SHA of [
      base,
      git("rev-parse", "HEAD^1"),
      git("rev-parse", "HEAD"),
      "f".repeat(40),
    ]) {
      assert.equal(
        scope({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA }),
        "required=true",
        PR_HEAD_SHA,
      );
    }
  });
});

test("a pull request without a head sha runs everything", () => {
  scopeFixture(({ commitFile, scope }) => {
    const parent = commitFile("README.md");
    commitFile("docs/guide.md");
    // Control: the change since the parent is docs-only.
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "push", BASE_SHA: parent }),
      "required=false",
    );
    // A non-merge checkout has no second parent, so an absent head must not
    // be compared with the equally absent HEAD^2.
    for (const PR_HEAD_SHA of [undefined, ""]) {
      assert.equal(
        scope({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA }),
        "required=true",
        String(PR_HEAD_SHA),
      );
    }
  });
});

test("a pull request head sha that is not a full commit id runs everything", () => {
  scopeFixture(
    ({ git, commitFile, traced }) => {
      commitFile("README.md");
      git("switch", "-c", "feature");
      const head = commitFile("docs/guide.md");
      assert.equal(head.length, 64);
      git("switch", "main");
      git("merge", "--no-ff", "-m", "merge", "feature");
      // Control: the real head, in either case, is checked against HEAD^2
      // and the docs-only merge is scoped.
      for (const PR_HEAD_SHA of [head, head.toUpperCase()]) {
        const control = traced({
          GITHUB_EVENT_NAME: "pull_request",
          PR_HEAD_SHA,
        });
        assert.equal(control.stdout, "required=false", PR_HEAD_SHA);
        assert.ok(
          control.gitArgs.includes("HEAD^2^{commit}"),
          control.gitArgs.join(" "),
        );
      }
      // A malformed head is rejected before any git call, so the run does
      // not depend on the HEAD^2 comparison to fall back.
      for (const PR_HEAD_SHA of [
        head.slice(0, 63),
        `${head}0`,
        ` ${head}`,
        `${head}\n`,
        "not-a-sha",
        "--upload-pack=touch pwned",
      ]) {
        const result = traced({
          GITHUB_EVENT_NAME: "pull_request",
          PR_HEAD_SHA,
        });
        assert.equal(result.status, 0, `${PR_HEAD_SHA}: ${result.stderr}`);
        assert.equal(result.stdout, "required=true", PR_HEAD_SHA);
        assert.ok(
          result.stderr.includes(
            `PR head ${JSON.stringify(PR_HEAD_SHA)} is not a commit id; running everything.`,
          ),
          result.stderr,
        );
        assert.deepEqual(result.gitArgs, [], PR_HEAD_SHA);
      }
    },
    { objectFormat: "sha256" },
  );
});

test("a pull request checkout without a merge commit runs everything", () => {
  scopeFixture(({ commitFile, scope }) => {
    const parent = commitFile("README.md");
    const head = commitFile("docs/guide.md");
    // Control: the change since the parent is docs-only.
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "push", BASE_SHA: parent }),
      "required=false",
    );
    // A valid head sha, but HEAD is that head rather than GitHub's merge.
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA: head }),
      "required=true",
    );
  });
});

test("each pull request fallback names its reason on stderr", () => {
  scopeFixture(({ git, commitFile, traced }) => {
    const base = commitFile("README.md");
    const linear = commitFile("docs/guide.md");
    const pr = (PR_HEAD_SHA) =>
      traced({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA });
    const cases = [
      ["", /PR_HEAD_SHA is not set; running everything\./],
      [
        "not-a-sha",
        /PR head "not-a-sha" is not a commit id; running everything\./,
      ],
      [
        linear.slice(0, 39),
        new RegExp(
          `PR head "${linear.slice(0, 39)}" is not a commit id; running everything\\.`,
        ),
      ],
      [linear, /HEAD is not a merge commit; running everything\./],
      // An uppercase head is a valid id, so it reaches the merge check.
      [
        linear.toUpperCase(),
        /HEAD is not a merge commit; running everything\./,
      ],
    ];
    for (const [head, reason] of cases) {
      const result = pr(head);
      assert.equal(result.status, 0, `${head}: ${result.stderr}`);
      assert.equal(result.stdout, "required=true", head);
      assert.match(result.stderr, reason, head);
    }
    git("switch", "-c", "feature");
    const second = commitFile("docs/other.md");
    git("switch", "main");
    git("merge", "--no-ff", "-m", "merge", "feature");
    const mismatch = pr(base);
    assert.equal(mismatch.stdout, "required=true");
    assert.ok(
      mismatch.stderr.includes(
        `HEAD^2 ${second} is not PR head ${base}; running everything.`,
      ),
      mismatch.stderr,
    );
  });
});

test("a merge group is scoped to every change since its base", () => {
  scopeFixture(({ git, commitFile, scope }) => {
    const base = commitFile("README.md");
    commitFile("packages/shared/index.ts");
    commitFile("docs/guide.md");
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "merge_group", BASE_SHA: base }),
      "required=true",
    );
    git("reset", "--hard", base);
    commitFile("docs/one.md");
    commitFile("docs/two.md");
    assert.equal(
      scope({ GITHUB_EVENT_NAME: "merge_group", BASE_SHA: base }),
      "required=false",
    );
  });
});

test("a missing, empty, or unknown base runs everything", () => {
  scopeFixture(({ commitFile, scope }) => {
    commitFile("README.md");
    commitFile("docs/guide.md");
    for (const env of [
      { GITHUB_EVENT_NAME: "workflow_dispatch" },
      { GITHUB_EVENT_NAME: "push", BASE_SHA: "0".repeat(40) },
      { GITHUB_EVENT_NAME: "merge_group", BASE_SHA: "" },
      { GITHUB_EVENT_NAME: "push", BASE_SHA: "deadbeef".repeat(5) },
    ]) {
      assert.equal(scope(env), "required=true", JSON.stringify(env));
    }
  });
});

test("a missing or empty base runs everything without a git lookup", () => {
  scopeFixture(({ commitFile, traced }) => {
    const valid = commitFile("README.md");
    commitFile("docs/guide.md");
    // Positive control: a well-formed base reaches git through the wrapper.
    const control = traced({ GITHUB_EVENT_NAME: "push", BASE_SHA: valid });
    assert.equal(control.stdout, "required=false", control.stderr);
    assertReachedGit(control, `${valid}^{commit}`, "diff", valid);
    for (const env of [
      { GITHUB_EVENT_NAME: "workflow_dispatch" },
      { GITHUB_EVENT_NAME: "merge_group", BASE_SHA: "" },
    ]) {
      const result = traced(env);
      const label = JSON.stringify(env);
      assert.equal(result.status, 0, `${label}: ${result.stderr}`);
      assert.equal(result.stdout, "required=true", label);
      // An absent base is not a malformed or unknown one.
      assert.doesNotMatch(result.stderr, /not a commit id|not found/, label);
      assert.deepEqual(result.gitArgs, [], label);
    }
  });
});

test("a malformed base runs everything without reaching git", () => {
  scopeFixture(({ commitFile, traced }) => {
    const valid = commitFile("README.md");
    commitFile("docs/guide.md");
    // Positive control: a well-formed base reaches git through the wrapper,
    // so an empty log below means the gate made no git call.
    const control = traced({ GITHUB_EVENT_NAME: "push", BASE_SHA: valid });
    assert.equal(control.stdout, "required=false", control.stderr);
    assertReachedGit(control, `${valid}^{commit}`, "diff", valid);
    for (const base of [
      "not-a-sha",
      "--upload-pack=touch pwned",
      "-c",
      "HEAD~1",
      "a".repeat(39),
      "a".repeat(41),
      ` ${"a".repeat(40)}`,
    ]) {
      const result = traced({ GITHUB_EVENT_NAME: "push", BASE_SHA: base });
      assert.equal(result.status, 0, `${base}: ${result.stderr}`);
      assert.equal(result.stdout, "required=true", base);
      assert.match(result.stderr, /not a commit id/, base);
      // commitId rejects the base before any git call, and with no base the
      // scope command never runs git, so the log must be empty.
      assert.deepEqual(result.gitArgs, [], base);
    }
  });
});

test("an unresolvable base, including the all-zero id, runs everything with a note", () => {
  scopeFixture(({ commitFile, traced }) => {
    commitFile("README.md");
    commitFile("docs/guide.md");
    for (const base of ["0".repeat(40), "b".repeat(40), "c".repeat(64)]) {
      const result = traced({
        GITHUB_EVENT_NAME: "merge_group",
        BASE_SHA: base,
      });
      assert.equal(result.status, 0, `${base}: ${result.stderr}`);
      assert.equal(result.stdout, "required=true", base);
      assert.match(result.stderr, /not found/, base);
      assertReachedGit(result, `${base}^{commit}`);
    }
    // An uppercase base is reported as the normalized id git was asked for.
    const upper = "B".repeat(40);
    const result = traced({
      GITHUB_EVENT_NAME: "merge_group",
      BASE_SHA: upper,
    });
    assert.equal(result.stdout, "required=true");
    assert.ok(
      result.stderr.includes(`Base ${upper.toLowerCase()} not found;`),
      result.stderr,
    );
    assertReachedGit(result, `${upper.toLowerCase()}^{commit}`);
  });
});

test("an uppercase base is accepted and scoped", () => {
  scopeFixture(({ commitFile, traced }) => {
    const base = commitFile("README.md");
    commitFile("docs/guide.md");
    const result = traced({
      GITHUB_EVENT_NAME: "push",
      BASE_SHA: base.toUpperCase(),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "required=false");
    // The base is normalized to lowercase before it reaches git.
    assertReachedGit(result, `${base}^{commit}`, "diff", base);
  });
});

test("a 64-hex SHA-256 base is accepted and scoped", () => {
  scopeFixture(
    ({ git, commitFile, traced }) => {
      const base = commitFile("README.md");
      assert.equal(base.length, 64);
      commitFile("docs/guide.md");
      const docsOnly = traced({ GITHUB_EVENT_NAME: "push", BASE_SHA: base });
      assert.equal(docsOnly.status, 0, docsOnly.stderr);
      assert.equal(docsOnly.stdout, "required=false");
      assertReachedGit(docsOnly, `${base}^{commit}`, "diff", base);
      commitFile("packages/runtime/index.ts");
      // The scoped change set holds only the committed fixture files.
      assert.deepEqual(git("diff", "--name-only", base, "HEAD").split("\n"), [
        "docs/guide.md",
        "packages/runtime/index.ts",
      ]);
      const runtime = traced({ GITHUB_EVENT_NAME: "push", BASE_SHA: base });
      assert.equal(runtime.stdout, "required=true");
      assertReachedGit(runtime, `${base}^{commit}`, "diff", base);
    },
    { objectFormat: "sha256" },
  );
});

/** Run the scope command in `cwd`, capturing stdout, stderr, and exit status. */
function runScope(cwd, env) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../gate.mjs", import.meta.url)), "scope"],
    {
      cwd,
      encoding: "utf8",
      env: fixtureEnv({
        GITHUB_EVENT_NAME: "",
        BASE_SHA: "",
        PR_HEAD_SHA: "",
        ...env,
      }),
    },
  );
}

test("a git failure still runs everything but explains why on stderr", () => {
  const cwd = mkdtempSync(join(tmpdir(), "runtime-gate-nogit-"));
  try {
    for (const [env, falseReason] of [
      // A well-formed head sha, so the gate reaches git before giving up.
      [
        { GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA: "a".repeat(40) },
        /not a merge commit/,
      ],
      [{ GITHUB_EVENT_NAME: "push", BASE_SHA: "A".repeat(40) }, /not found/],
    ]) {
      const event = env.GITHUB_EVENT_NAME;
      const result = runScope(cwd, {
        ...env,
        GIT_CEILING_DIRECTORIES: tmpdir(),
      });
      assert.equal(result.status, 0, event);
      assert.equal(result.stdout, "required=true\n", event);
      // The git error is the one reason given; git failing says nothing
      // about whether HEAD is a merge or the base exists.
      const lines = result.stderr.trim().split("\n");
      assert.equal(lines.length, 2, `${event}: ${result.stderr}`);
      assert.match(
        lines[0],
        /git rev-parse .* failed: .*not a git repository/i,
      );
      assert.doesNotMatch(result.stderr, falseReason, event);
      assert.equal(
        lines[1],
        `Runtime scope: event=${event}, no diff base; running full conformance.`,
      );
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the scope command logs the event and diff range on stderr only", () => {
  scopeFixture(({ git, commitFile }) => {
    commitFile("README.md");
    git("switch", "-c", "feature");
    commitFile("docs/guide.md");
    git("switch", "main");
    commitFile("packages/runtime/index.ts");
    git("merge", "--no-ff", "-m", "merge", "feature");
    const base = git("rev-parse", "HEAD^1");
    const head = git("rev-parse", "HEAD");
    const result = runScope(git("rev-parse", "--show-toplevel"), {
      GITHUB_EVENT_NAME: "pull_request",
      PR_HEAD_SHA: git("rev-parse", "HEAD^2"),
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "required=false\n");
    assert.match(result.stderr, /pull_request/);
    assert.ok(
      result.stderr.includes(`${base}..${head}`),
      `stderr should name the range: ${result.stderr}`,
    );
  });
});

test("a base that resolves but cannot be diffed runs everything with the git error", () => {
  scopeFixture(({ git, commitFile, traced }) => {
    const parent = commitFile("README.md");
    commitFile("docs/guide.md");
    // Write a base commit whose tree was never stored: the commit resolves,
    // so the base passes validation, but `git diff` cannot read its tree (as
    // in a broken or partial clone). Deleting a real tree's object file
    // instead depends on the object being loose, which git does not promise.
    const missingTree = "e".repeat(parent.length);
    assert.throws(() => git("cat-file", "-e", missingTree));
    const commitBody = join(git("rev-parse", "--absolute-git-dir"), "base");
    writeFileSync(
      commitBody,
      `tree ${missingTree}\nparent ${parent}\n` +
        "author Gate Test <gate@example.test> 0 +0000\n" +
        "committer Gate Test <gate@example.test> 0 +0000\n\nbase\n",
    );
    const base = git("hash-object", "-t", "commit", "-w", commitBody);
    const result = traced({ GITHUB_EVENT_NAME: "push", BASE_SHA: base });
    assert.ok(
      result.gitArgs.includes("diff"),
      `diff should be attempted: ${result.gitArgs.join(" ")}`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "required=true");
    assert.match(result.stderr, /Runtime scope: git diff .* failed: .*tree/);
  });
});

test("an inherited GIT_DIR does not point the scope at another repository", () => {
  scopeFixture(({ git, commitFile, traced }) => {
    const base = commitFile("README.md");
    git("switch", "-c", "feature");
    const head = commitFile("packages/runtime/src/index.ts");
    git("switch", "main");
    git("merge", "--no-ff", "-m", "merge", "feature");
    const merge = git("rev-parse", "HEAD");
    // A decoy clone that shares the base and the PR head, so every commit the
    // gate looks up also resolves there, but whose changes skip the matrix.
    const decoy = mkdtempSync(join(tmpdir(), "runtime-gate-decoy-"));
    const decoyGit = (...args) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Gate Test",
          "-c",
          "user.email=gate@example.test",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        {
          cwd: decoy,
          encoding: "utf8",
          env: fixtureEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      ).trim();
    try {
      decoyGit("clone", "--quiet", git("rev-parse", "--absolute-git-dir"), ".");
      const outer = { GIT_DIR: join(decoy, ".git"), GIT_WORK_TREE: decoy };
      const expectScopedToCheckout = (env) => {
        const result = traced({ ...env, ...outer });
        const label = JSON.stringify(env);
        assert.equal(result.status, 0, `${label}: ${result.stderr}`);
        assert.equal(
          result.stdout,
          "required=true",
          `${label}: ${result.stderr}`,
        );
        assert.ok(
          result.stderr.includes(`diffing ${base}..${merge}`),
          `${label}: stderr should name the checkout's range: ${result.stderr}`,
        );
      };

      // push: the decoy's HEAD is a docs-only commit on the base.
      decoyGit("reset", "--quiet", "--hard", base);
      mkdirSync(join(decoy, "docs"), { recursive: true });
      writeFileSync(join(decoy, "docs", "guide.md"), "decoy\n");
      decoyGit("add", ".");
      decoyGit("commit", "-m", "decoy docs");
      expectScopedToCheckout({ GITHUB_EVENT_NAME: "push", BASE_SHA: base });

      // pull_request: the decoy's HEAD is a merge of the same PR head whose
      // tree equals its first parent's tree, so its diff is empty.
      decoyGit("reset", "--quiet", "--hard", head);
      mkdirSync(join(decoy, "docs"), { recursive: true });
      writeFileSync(join(decoy, "docs", "guide.md"), "decoy\n");
      decoyGit("add", ".");
      decoyGit("commit", "-m", "decoy docs");
      const first = decoyGit("rev-parse", "HEAD");
      decoyGit(
        "reset",
        "--quiet",
        "--hard",
        decoyGit(
          "commit-tree",
          `${first}^{tree}`,
          "-p",
          first,
          "-p",
          head,
          "-m",
          "decoy merge",
        ),
      );
      expectScopedToCheckout({
        GITHUB_EVENT_NAME: "pull_request",
        PR_HEAD_SHA: head,
      });
    } finally {
      rmSync(decoy, { recursive: true, force: true });
    }
  });
});

/** GitHub's docs-only pull_request merge commit; returns the PR head sha. */
function docsOnlyMerge({ git, commitFile }) {
  commitFile("README.md");
  git("switch", "-c", "feature");
  const head = commitFile("docs/guide.md");
  git("switch", "main");
  git("merge", "--no-ff", "-m", "merge", "feature");
  return head;
}

test("an uppercase pull request head sha is accepted and scoped", () => {
  scopeFixture(({ git, commitFile, traced }) => {
    const head = docsOnlyMerge({ git, commitFile });
    const result = traced({
      GITHUB_EVENT_NAME: "pull_request",
      PR_HEAD_SHA: head.toUpperCase(),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "required=false");
    assertReachedGit(result, "HEAD^2^{commit}", "diff");
  });
});

test("a 64-hex SHA-256 pull request head sha is accepted and scoped", () => {
  scopeFixture(
    ({ git, commitFile, traced }) => {
      const head = docsOnlyMerge({ git, commitFile });
      assert.equal(head.length, 64);
      for (const PR_HEAD_SHA of [head, head.toUpperCase()]) {
        const result = traced({
          GITHUB_EVENT_NAME: "pull_request",
          PR_HEAD_SHA,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, "required=false", PR_HEAD_SHA);
        assertReachedGit(result, "HEAD^2^{commit}", "diff");
      }
    },
    { objectFormat: "sha256" },
  );
});

test("a malformed pull request head sha runs everything without reaching git", () => {
  scopeFixture(({ git, commitFile, traced }) => {
    const head = docsOnlyMerge({ git, commitFile });
    // Positive control: a valid head reaches git through the wrapper, so an
    // empty log below means the gate made no git call.
    const control = traced({
      GITHUB_EVENT_NAME: "pull_request",
      PR_HEAD_SHA: head,
    });
    assert.equal(control.stdout, "required=false", control.stderr);
    assertReachedGit(control, "HEAD^2^{commit}");
    for (const PR_HEAD_SHA of [
      "not-a-sha",
      "--upload-pack=touch pwned",
      "HEAD^2",
      head.slice(0, 39),
      `${head}a`,
      ` ${head}`,
    ]) {
      const result = traced({ GITHUB_EVENT_NAME: "pull_request", PR_HEAD_SHA });
      assert.equal(result.status, 0, `${PR_HEAD_SHA}: ${result.stderr}`);
      assert.equal(result.stdout, "required=true", PR_HEAD_SHA);
      assert.match(result.stderr, /not a commit id/, PR_HEAD_SHA);
      // commitId rejects the head before the HEAD^2 lookup, and with no base
      // the scope command never runs git, so the log must be empty.
      assert.deepEqual(result.gitArgs, [], PR_HEAD_SHA);
    }
  });
});

/** The repository root that contains this checkout of the gate. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The pnpm workspace member directories, read from pnpm-workspace.yaml. Only
 * literal and `*` path segments are expanded; any other glob syntax fails the
 * test so that a new pattern cannot hide a member.
 */
function workspaceMembers() {
  const yaml = readFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
  const block = yaml.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
  const include = [];
  const exclude = new Set();
  for (const line of block.split("\n")) {
    const match = line.match(/^\s+-\s+["']?([^"'#\s]+)["']?\s*(#.*)?$/);
    if (!match) continue;
    const pattern = match[1];
    if (pattern.startsWith("!")) exclude.add(pattern.slice(1));
    else include.push(pattern);
  }
  assert.ok(include.length > 0, "no packages: entries in pnpm-workspace.yaml");
  const members = new Set();
  for (const pattern of include) {
    let dirs = [""];
    for (const segment of pattern.split("/")) {
      assert.match(
        segment,
        /^(\*|[^*?[\]{}!]+)$/,
        `unsupported glob ${pattern}`,
      );
      dirs = dirs.flatMap((dir) => {
        if (segment !== "*") return [dir ? `${dir}/${segment}` : segment];
        const abs = join(REPO_ROOT, dir);
        if (!existsSync(abs)) return [];
        return readdirSync(abs, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => (dir ? `${dir}/${entry.name}` : entry.name));
      });
    }
    for (const dir of dirs) {
      if (existsSync(join(REPO_ROOT, dir, "package.json"))) members.add(dir);
    }
  }
  for (const dir of exclude) members.delete(dir);
  return members;
}

/**
 * The transitive workspace closure of the matrix roots, as a map from member
 * directory to the chain of directories that pulled it in. An edge is any
 * dependency of any kind (dependencies, devDependencies, peerDependencies,
 * optionalDependencies) whose name is a workspace package, and any
 * project.json implicitDependencies entry, the same rule nx uses for
 * `^build`.
 */
function workspaceClosure(roots) {
  const byName = new Map();
  const manifests = new Map();
  for (const dir of workspaceMembers()) {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, dir, "package.json"), "utf8"),
    );
    const projectPath = join(REPO_ROOT, dir, "project.json");
    const project = existsSync(projectPath)
      ? JSON.parse(readFileSync(projectPath, "utf8"))
      : {};
    manifests.set(dir, { pkg, project });
    if (pkg.name) byName.set(pkg.name, dir);
    if (project.name) byName.set(project.name, dir);
  }
  const chains = new Map();
  const queue = [];
  for (const root of roots) {
    assert.ok(manifests.has(root), `${root} is not a workspace member`);
    chains.set(root, [root]);
    queue.push(root);
  }
  while (queue.length > 0) {
    const dir = queue.shift();
    const { pkg, project } = manifests.get(dir);
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...(project.implicitDependencies ?? []),
    ];
    for (const name of names) {
      const dep = byName.get(name);
      if (dep === undefined || chains.has(dep)) continue;
      chains.set(dep, [...chains.get(dir), dep]);
      queue.push(dep);
    }
  }
  return chains;
}

test("no package in the matrix's workspace dependency closure is skipped", () => {
  // The roots the matrix builds, tests, and lints: runtime and core (nx
  // `^build` pulls in their dependencies), the conformance harness, and the
  // four native runtimes.
  const closure = workspaceClosure([
    "packages/runtime",
    "packages/core",
    "tools/runtime-conformance",
    "packages/runtime-python",
    "packages/runtime-go",
    "packages/runtime-ruby",
    "packages/runtime-dotnet",
  ]);
  // Positive control: the walk follows real edges, so the check below cannot
  // pass on an empty closure.
  for (const dir of [
    "packages/shared",
    "packages/learning",
    "packages/channels-ui",
  ]) {
    assert.ok(closure.has(dir), `${dir} missing from the closure`);
  }
  // Probe a source file, not the manifest: a manifest requires conformance in
  // every directory, so it cannot tell whether the directory itself is skipped.
  const skipped = [...closure]
    .filter(([dir]) => !requiresConformance([`${dir}/src/index.ts`]))
    .map(([dir, chain]) => `${dir} (via ${chain.join(" -> ")})`);
  assert.deepEqual(
    skipped,
    [],
    `gate.mjs skips packages the matrix builds: ${skipped.join("; ")}`,
  );
});
