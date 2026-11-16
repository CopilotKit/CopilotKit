// A scripted Gemini for end-to-end tests, served by aimock.
//
// The Antigravity harness sends native Gemini requests to GOOGLE_GEMINI_BASE_URL.
// Point that here and the real harness, real tools, real shell and the real
// CopilotKit UI all run; only the model's decisions are scripted. Each request
// gets the next step of the playbook, picked by how many tool calls the model
// has already made in the current turn. The main playbook is
// google-gemini/genai-processors (the first card on the empty state); tqdm/tqdm
// and beets-filetote replay older runs when a message names them, and
// "python version" drives the shell command path.
//
//   pnpm mock-model                 # serves on :4010
//   GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:4010 GEMINI_API_KEY=mock pnpm dev
import { readFileSync } from "node:fs";
import { LLMock } from "@copilotkit/aimock";

const PORT = Number(process.env.MOCK_MODEL_PORT ?? 4010);
const TQDM = "tqdm/tqdm";
const BEETS = "gtronset/beets-filetote";
const FIX = JSON.parse(
  readFileSync(
    new URL("./fixtures/beets-filetote-fix.json", import.meta.url),
    "utf8",
  ),
);
// What clone_repo reports for each repo when the agent runs on Python 3.13
// (agent/.python-version and the Docker image). The tool refuses any other.
const BEETS_INSTALL =
  "uv venv .venv --quiet --allow-existing --python 3.13 && uv pip install --python .venv --quiet -e . --group test --group dev pytest";
const TQDM_INSTALL =
  "uv venv .venv --quiet --allow-existing --python 3.13 && uv pip install --python .venv --quiet -e . pytest pytest-asyncio pytest-cov pytest-timeout";

// CI's full benchmark job runs on setup-python "3.x" (3.14) and replays every
// release from v3.2.0. Releases up to v4.20.0 crash on Python 3.12+. `-I`
// keeps the checkout's own tqdm/ package off sys.path, so the pinned release
// is the one that runs.
const TQDM_BENCH_LINE =
  "        asv run -j 8 --interleave-processes --skip-existing v3.2.0..HEAD";
const tqdmCheck = (versions) =>
  `for v in ${versions}; do echo "tqdm $v:"; uv run --no-project --quiet --python 3.14 --with tqdm==$v ` +
  `python -I -c "from tqdm import tqdm; p = tqdm(range(3)); [x for x in p]; p.close(); print('ok')" 2>&1 | tail -1; done`;

/** The workspace path the harness puts in its system prompt. */
function workspaceOf(req) {
  const system = req.messages.find((m) => m.role === "system")?.content ?? "";
  const match = /Active Workspaces:\s*\n-\s*(\S+)/.exec(String(system));
  if (!match) throw new Error("No active workspace in the system prompt");
  return match[1];
}

/** Model tool calls made since the last user message. */
function callsThisTurn(req) {
  const lastUser = req.messages.findLastIndex((m) => m.role === "user");
  return req.messages
    .slice(lastUser + 1)
    .flatMap((m) => m.tool_calls ?? [])
    .map((c) => c.function?.name);
}

function lastUserText(req) {
  const msg = req.messages.findLast((m) => m.role === "user");
  return String(msg?.content ?? "").toLowerCase();
}

const meta = (summary, action) => ({
  toolSummary: summary,
  toolAction: action,
});

const edit = (ws, { target, replacement, lines, description }) => ({
  name: "replace_file_content",
  arguments: {
    TargetFile: `${ws}/${FIX.file}`,
    Instruction: description,
    Description: description,
    AllowMultiple: false,
    TargetContent: target,
    ReplacementContent: replacement,
    StartLine: lines[0],
    EndLine: lines[1],
    ...meta("File edit", "Editing file"),
  },
});

const command = (ws, commandLine, summary, action) => ({
  name: "run_command",
  arguments: {
    CommandLine: commandLine,
    Cwd: ws,
    WaitMsBeforeAsync: 60000,
    ...meta(summary, action),
  },
});

/** The tqdm playbook: one entry per model call. */
const tqdm = [
  () => ({
    content: "I'll clone the repo and check its latest CI runs.",
    toolCalls: [{ name: "clone_repo", arguments: { repo_ref: TQDM } }],
  }),
  () => ({ toolCalls: [{ name: "ci_status", arguments: {} }] }),
  // No narration here, as in real runs: the approval card follows the CI card directly.
  () => ({
    toolCalls: [
      { name: "install_dependencies", arguments: { command: TQDM_INSTALL } },
    ],
  }),
  () => ({ toolCalls: [{ name: "run_tests", arguments: {} }] }),
  (ws) => ({
    // A bare "*" glob at the root: the row reads "Listed files in repo root".
    toolCalls: [
      {
        name: "find_by_name",
        arguments: {
          SearchDirectory: ws,
          Pattern: "*",
          MaxDepth: 1,
          ...meta("File listing", "Listing files"),
        },
      },
    ],
  }),
  (ws) => ({
    // A file that does not exist in a clone: setuptools-scm writes it at build
    // time. Real runs hit this; the tool error must go back to the model.
    toolCalls: [
      {
        name: "view_file",
        arguments: {
          AbsolutePath: `${ws}/tqdm/_version.py`,
          ...meta("Version module", "Reading version module"),
        },
      },
    ],
  }),
  (ws) => ({
    content:
      "The Check workflow fails in its Benchmark (Full) job, at the Benchmark step, and the unit tests pass here, so the failure is in that job. `tqdm/_version.py` is generated by setuptools-scm at build time, so it is not in the clone. Reading the workflow.",
    toolCalls: [
      {
        name: "view_file",
        arguments: {
          AbsolutePath: `${ws}/.github/workflows/check.yml`,
          StartLine: 30,
          EndLine: 57,
          ...meta("Workflow review", "Reading workflow"),
        },
      },
    ],
  }),
  (ws) => ({
    content:
      "The job runs asv over every release from v3.2.0 on setup-python 3.x, which is Python 3.14 today. I'll check whether an old release still runs there, next to a newer one.",
    toolCalls: [
      command(
        ws,
        tqdmCheck("4.20.0 4.21.0"),
        "Reproduce on Python 3.14",
        "Running old releases",
      ),
    ],
  }),
  (ws) => ({
    content:
      "tqdm 4.20.0 crashes on Python 3.14 with the AttributeError above, and 4.21.0 runs. Every release before 4.21.0 fails the same way, so the range can no longer be benchmarked on this Python. I'll start the range at v4.21.0.",
    toolCalls: [
      {
        name: "replace_file_content",
        arguments: {
          TargetFile: `${ws}/.github/workflows/check.yml`,
          Instruction: "Start the benchmark range at v4.21.0",
          Description: "Start the benchmark range at v4.21.0",
          AllowMultiple: false,
          TargetContent: TQDM_BENCH_LINE,
          ReplacementContent:
            "        # Releases before v4.21.0 crash on Python 3.12+, which setup-python 3.x installs.\n" +
            TQDM_BENCH_LINE.replace("v3.2.0..HEAD", "v4.21.0..HEAD"),
          StartLine: 56,
          EndLine: 56,
          ...meta("File edit", "Editing file"),
        },
      },
    ],
  }),
  () => ({
    toolCalls: [
      {
        name: "show_diff",
        arguments: {
          summary:
            "The full benchmark job now starts at v4.21.0, the first release that runs on the Python 3.x that CI installs.",
        },
      },
    ],
  }),
  (ws) => ({
    content: "Checking that the new start of the range runs on Python 3.14.",
    toolCalls: [
      command(
        ws,
        tqdmCheck("4.21.0"),
        "Verify on Python 3.14",
        "Running v4.21.0",
      ),
    ],
  }),
  () => ({
    content: "It runs. Pushing the fix to a branch.",
    toolCalls: [
      {
        name: "git_push",
        arguments: {
          branch: "fix/benchmark-range",
          commit_message: "Start the full benchmark range at v4.21.0",
        },
      },
    ],
  }),
  () => ({
    content:
      "CI fails in the scheduled Benchmark (Full) job, not in the tests. It benchmarks every release from v3.2.0 on Python 3.14, and releases before 4.21.0 crash on Python 3.12 and newer. I started the range at v4.21.0 in check.yml. The unit tests pass, 4.21.0 runs on 3.14, and the fix is on fix/benchmark-range in the local demo remote.",
  }),
];

/** The beets-filetote playbook: one entry per model call. */
const beets = [
  () => ({
    content: "I'll clone the repo, install it and run the tests.",
    toolCalls: [{ name: "clone_repo", arguments: { repo_ref: BEETS } }],
  }),
  () => ({ toolCalls: [{ name: "ci_status", arguments: {} }] }),
  () => ({
    content:
      "The scheduled job that tests against the latest beets is failing. Installing to reproduce it.",
    toolCalls: [
      { name: "install_dependencies", arguments: { command: BEETS_INSTALL } },
    ],
  }),
  () => ({ toolCalls: [{ name: "run_tests", arguments: {} }] }),
  (ws) => ({
    content:
      "8 tests fail, all with a TypeError raised inside the test fixture when it calls beets. Checking how it calls the move, modify and update commands.",
    toolCalls: [
      {
        name: "grep_search",
        arguments: {
          SearchPath: `${ws}/tests/pytest_beets_plugin`,
          Query: "_items(",
          MatchPerLine: true,
          ...meta("Code search", "Searching code"),
        },
      },
    ],
  }),
  (ws) => ({
    toolCalls: [
      {
        name: "grep_search",
        arguments: {
          SearchPath: `${ws}/.venv/lib`,
          Query: "def (move|modify|update)_(items|albums)\\(",
          IsRegex: true,
          MatchPerLine: true,
          Includes: ["*.py"],
          ...meta("Dependency API search", "Checking beets API"),
        },
      },
    ],
  }),
  (ws) => ({
    content:
      "beets 2.14.1 got installed. It split the item and album commands: move_items now takes an options object, and modify_items and update_items no longer accept album or query. The fixture still uses the old signatures.",
    toolCalls: [
      {
        name: "view_file",
        arguments: {
          AbsolutePath: `${ws}/${FIX.file}`,
          StartLine: 420,
          EndLine: 525,
          ...meta("Fixture review", "Reading test fixture"),
        },
      },
    ],
  }),
  (ws) => ({
    content:
      "I'll detect the new API at import time and keep the old path for beets 2.13 and below.",
    toolCalls: [edit(ws, FIX.edits[0])],
  }),
  (ws) => ({ toolCalls: [edit(ws, FIX.edits[1])] }),
  () => ({
    toolCalls: [
      {
        name: "show_diff",
        arguments: {
          summary:
            "The test fixture now calls the split item and album commands on beets 2.14, and keeps the old calls for 2.13 and below.",
        },
      },
    ],
  }),
  () => ({ toolCalls: [{ name: "run_tests", arguments: {} }] }),
  () => ({
    content: "All 182 tests pass. Pushing the fix to a branch.",
    toolCalls: [
      {
        name: "git_push",
        arguments: {
          branch: "fix/beets-2-14-commands",
          commit_message:
            "Support the beets 2.14 command API in the test fixture",
        },
      },
    ],
  }),
  () => ({
    content:
      "CI fails because the scheduled job installs the latest beets, and beets 2.14 changed the signatures of move_items, modify_items and update_items. The plugin itself was fine; its test fixture called the old API. I updated the fixture to use the new commands when they exist and the old ones otherwise. All 182 tests pass, and the fix is on fix/beets-2-14-commands in the local demo remote.",
  }),
];

// Generic playbooks: the same steps for any repository, nothing about its code.
// The install command must be the one clone_repo detects for that repository
// (the tool refuses any other), and aimock does not pass tool results back to
// the model, so it is listed per repository here.
const DETECTED_INSTALL = {
  // A JS package without a lockfile: npm install, then its `npm test` script.
  "sindresorhus/is-plain-obj": "npm install",
};

// google-gemini/genai-processors, the first card. CI ("Python package") installs
// `pip install .[contrib]` and `.[dev]`, then runs pytest. Collection fails on
// missing greenlet (SQLAlchemy asyncio) and pkg_resources (webrtcvad), and mcp
// 2.x renamed `isError`. The fix pins all three in pyproject.toml.
const GENAI = "google-gemini/genai-processors";
const GENAI_INSTALL =
  "uv venv .venv --quiet --allow-existing --python 3.13 && uv pip install --python .venv --quiet -e .[contrib,dev] pytest pytest-asyncio pytest-xdist";
const GENAI_CHECK = `.venv/bin/python -c "import greenlet, pkg_resources, importlib.metadata as m; v = m.version('mcp'); assert v.startswith('1.'), 'mcp ' + v; print('imports ok, mcp', v)"`;
const genaiCheck = () => ({
  name: "run_check",
  arguments: {
    command: GENAI_CHECK,
    label: "Import what test collection needs",
  },
});

const genai = [
  () => ({
    content: "I'll clone the repo and check its latest CI runs.",
    toolCalls: [{ name: "clone_repo", arguments: { repo_ref: GENAI } }],
  }),
  () => ({ toolCalls: [{ name: "ci_status", arguments: {} }] }),
  () => ({
    content:
      "CI's install step runs `pip install .[contrib]` and `.[dev]`, so I'll install the same extras.",
    toolCalls: [
      { name: "install_dependencies", arguments: { command: GENAI_INSTALL } },
    ],
  }),
  () => ({ toolCalls: [{ name: "run_tests", arguments: {} }] }),
  (ws) => ({
    // Blocked by the guard; the error comes back and the turn goes on.
    content: "Adding greenlet directly to see if it helps.",
    toolCalls: [
      command(
        ws,
        ".venv/bin/pip install greenlet",
        "Package install",
        "Installing package",
      ),
    ],
  }),
  (ws) => ({
    content:
      "Installs go through install_dependencies, so I'll read the dependency list instead.",
    toolCalls: [
      {
        name: "view_file",
        arguments: {
          AbsolutePath: `${ws}/pyproject.toml`,
          StartLine: 25,
          EndLine: 50,
          ...meta("Dependencies", "Reading dependencies"),
        },
      },
    ],
  }),
  () => ({
    content:
      "Reproducing the collection failure: the imports test collection needs, and the mcp major version.",
    toolCalls: [genaiCheck()],
  }),
  (ws) => ({
    content:
      "SQLAlchemy's asyncio extra brings greenlet, webrtcvad needs setuptools below 81 for pkg_resources, and mcp 2 renamed isError. Pinning all three.",
    toolCalls: [
      {
        name: "replace_file_content",
        arguments: {
          TargetFile: `${ws}/pyproject.toml`,
          Instruction: "Pin the three dependencies that break test collection",
          Description: "Pin sqlalchemy[asyncio], setuptools<81 and mcp<2",
          AllowMultiple: false,
          TargetContent:
            '    "mcp>=1.26.0",\n    "sqlalchemy>=2.0.0",\n    "webrtcvad>=2.0.10",',
          ReplacementContent:
            '    "mcp>=1.26.0,<2.0.0",\n    "sqlalchemy[asyncio]>=2.0.0",\n    "setuptools<81",\n    "webrtcvad>=2.0.10",',
          StartLine: 45,
          EndLine: 47,
          ...meta("File edit", "Editing file"),
        },
      },
    ],
  }),
  () => ({
    toolCalls: [
      {
        name: "show_diff",
        arguments: {
          summary:
            "Pins sqlalchemy[asyncio], setuptools<81 and mcp<2 so the tests collect and pass.",
        },
      },
    ],
  }),
  () => ({
    content: "Reinstalling with the new pins.",
    toolCalls: [
      { name: "install_dependencies", arguments: { command: GENAI_INSTALL } },
    ],
  }),
  () => ({
    content: "Running the same check again.",
    toolCalls: [genaiCheck()],
  }),
  () => ({ toolCalls: [{ name: "run_tests", arguments: {} }] }),
  () => ({
    toolCalls: [
      {
        name: "git_push",
        arguments: {
          branch: "fix/pin-test-deps",
          commit_message: "Pin sqlalchemy[asyncio], setuptools<81 and mcp<2",
        },
      },
    ],
  }),
  () => ({
    content:
      "CI failed at test collection: `greenlet` and `pkg_resources` were missing and mcp 2 renamed `isError`. I pinned `sqlalchemy[asyncio]`, `setuptools<81` and `mcp<2` in `pyproject.toml`. The import check exited 1 before the fix and 0 after, and the tests pass.",
  }),
];

/** "Check CI on owner/name": read CI and stop, as the agent does when CI is green. */
const checkOnly = (slug) => [
  () => ({
    content: "I'll clone the repo and read its latest CI results.",
    toolCalls: [{ name: "clone_repo", arguments: { repo_ref: slug } }],
  }),
  () => ({ toolCalls: [{ name: "ci_status", arguments: {} }] }),
  () => ({
    content:
      "The latest CI result of each workflow is in the card above. Tell me if you want me to install the project and run its tests here.",
  }),
];

/** Clone, CI, install, test, summarize: no fix, any ecosystem. */
const installAndTest = (slug) => [
  () => ({
    content:
      "I'll clone the repo, read its CI results, then install it and run its tests.",
    toolCalls: [{ name: "clone_repo", arguments: { repo_ref: slug } }],
  }),
  () => ({ toolCalls: [{ name: "ci_status", arguments: {} }] }),
  () => ({
    toolCalls: [
      {
        name: "install_dependencies",
        arguments: { command: DETECTED_INSTALL[slug] },
      },
    ],
  }),
  () => ({ toolCalls: [{ name: "run_tests", arguments: {} }] }),
  () => ({
    content:
      "The CI results and the local test run are in the cards above. Tell me which failure you want me to dig into.",
  }),
];

/** A short scenario for the shell command path: one approved built-in command. */
const shellCommand = [
  (ws) => ({
    content: "I'll check the Python version.",
    toolCalls: [
      {
        name: "run_command",
        arguments: {
          CommandLine: "python3 --version",
          Cwd: ws,
          WaitMsBeforeAsync: 5000,
          ...meta("Python version", "Checking Python version"),
        },
      },
    ],
  }),
  () => ({
    content:
      "That is what the command returned. Tell me how you want to continue.",
  }),
];

function respond(req) {
  const ws = workspaceOf(req);
  const step = callsThisTurn(req).length;
  const text = lastUserText(req);
  const slug = /([\w.-]+\/[\w.-]+?)\??$/.exec(text.trim())?.[1];
  const known = Object.keys(DETECTED_INSTALL).find(
    (s) => s.toLowerCase() === slug,
  );
  const playbook = text.includes("python version")
    ? shellCommand
    : text.startsWith("check ci on ") && slug
      ? checkOnly(slug)
      : known
        ? installAndTest(known)
        : text.includes("beets-filetote")
          ? beets
          : text.includes("genai-processors")
            ? genai
            : tqdm;
  const next = playbook[Math.min(step, playbook.length - 1)];
  return next(ws);
}

/** aimock's factory responses take tool arguments as JSON strings. */
function toWire(response) {
  const toolCalls = response.toolCalls?.map((call) => ({
    name: call.name,
    arguments: JSON.stringify(call.arguments),
  }));
  return toolCalls ? { ...response, toolCalls } : response;
}

const mock = new LLMock({ port: PORT, logLevel: "warn" });
mock.on({ predicate: () => true }, (req) => toWire(respond(req)));

await mock.start();
console.log(
  `mock model on ${mock.url} (scripted Gemini for ${TQDM} and ${BEETS})`,
);
