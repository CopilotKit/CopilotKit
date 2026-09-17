import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

import {
  parsePyprojectDeps,
  parseUvSources,
  splitRequirement,
  validateStarterDeps,
} from "../validate-starter-deps.mjs";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const tmpRoots = [];

after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

/** Build a throwaway `examples/integrations`-shaped tree and validate it. */
function check(starters) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "starter-deps-"));
  tmpRoots.push(root);
  const integrations = path.join(root, "examples", "integrations");
  for (const [starter, files] of Object.entries(starters)) {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(integrations, starter, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }
  return validateStarterDeps(integrations, root);
}

const of = (violations, rule) => violations.filter((v) => v.rule === rule);

// ---------------------------------------------------------------------------
// PE-129 — a2a-middleware's agents could not install.
//
// `a2a-sdk[http-server]` carried no version constraint. a2a-sdk published 1.x,
// which drops `a2a.server.apps`, and two of the three agents died on import
// with no commit of ours involved. Fixed in 011538a21f.
//
// The `requirements.txt` fragments below are verbatim from that commit's two
// sides (`git show 183bacb853:.../agents/requirements.txt` and the fix).
// ---------------------------------------------------------------------------

const PE129_PRE = `ag-ui-adk>=0.0.1
a2a>=0.1.0
a2a-sdk[http-server]
google-adk>=0.1.0
litellm>=1.0.0
langgraph>=0.2.0
fastapi>=0.115.0
uvicorn>=0.30.0
python-dotenv>=1.0.0
openai>=1.0.0
`;

const PE129_POST = `ag-ui-adk>=0.0.1
# The upper bound is load-bearing: a2a-sdk 1.x drops \`a2a.server.apps\`.
a2a-sdk[http-server]>=0.3,<1.0
google-adk>=0.1.0
litellm>=1.0.0
langgraph>=0.2.0
fastapi>=0.115.0
uvicorn>=0.30.0
python-dotenv>=1.0.0
openai>=1.0.0
`;

describe("PE-129: unconstrained Python dependency", () => {
  it("flags the pre-fix a2a-middleware requirements.txt", () => {
    const violations = check({
      "a2a-middleware": { "agents/requirements.txt": PE129_PRE },
    });
    const unconstrained = of(violations, "python-unconstrained");
    const subjects = unconstrained.map((v) => v.subject).sort();
    assert.deepEqual(subjects, ["a2a-sdk"]);

    const [v] = unconstrained;
    // The failure has to name the starter and the manifest, so triage does not
    // start from a stack trace.
    assert.equal(v.starter, "a2a-middleware");
    assert.equal(
      v.manifest,
      path.join(
        "examples",
        "integrations",
        "a2a-middleware",
        "agents",
        "requirements.txt",
      ),
    );
    assert.match(v.detail, /no version constraint/);
  });

  it("passes on the fixed requirements.txt", () => {
    const violations = check({
      "a2a-middleware": { "agents/requirements.txt": PE129_POST },
    });
    assert.deepEqual(of(violations, "python-unconstrained"), []);
  });

  it("documents the rule's limit: a lower bound alone satisfies it", () => {
    // `a2a-sdk>=0.3` would have floated into 1.x just the same, and this rule
    // accepts it. Requiring an upper bound everywhere was measured at 40+ hits
    // across the fleet, which would bury the signal. Catching THIS case is the
    // dynamic clean-install job's half of the work, not the static half's.
    const violations = check({
      "a2a-middleware": {
        "agents/requirements.txt": "a2a-sdk[http-server]>=0.3\n",
      },
    });
    assert.deepEqual(of(violations, "python-unconstrained"), []);
  });
});

// ---------------------------------------------------------------------------
// PE-38 — the claude-sdk-python starter's first build failed.
//
// Its chart components use `recharts`, which declares `react-is` as a peer
// dependency, but the starter never declared `react-is`. npm papered over it
// by auto-installing the unmet peer and recording it in package-lock.json as
// `"peer": true`. Fixed in 1bc63c3e6b; the lock diff in that commit is exactly
// the `"peer": true` flag disappearing from node_modules/react-is.
// ---------------------------------------------------------------------------

const PE38_DEPS = {
  next: "16.1.6",
  react: "^19.2.4",
  "react-dom": "^19.2.4",
  recharts: "^3.7.0",
};

function pe38Lock({ reactIsIsPeer }) {
  return JSON.stringify({
    name: "claude-sdk-python-starter",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: PE38_DEPS },
      "node_modules/recharts": {
        version: "3.7.0",
        peerDependencies: {
          "react-is": "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0",
        },
      },
      "node_modules/react-is": {
        version: "19.3.0",
        ...(reactIsIsPeer ? { peer: true } : {}),
      },
      // Type-only peers are exempt: nothing resolves them at runtime and tsc
      // finds them through its own @types root lookup.
      "node_modules/@types/express": { version: "5.0.6", peer: true },
      "node_modules/@types/serve-static": { version: "2.2.0", peer: true },
    },
  });
}

describe("PE-38: undeclared peer dependency", () => {
  it("flags the pre-fix claude-sdk-python package.json", () => {
    const violations = check({
      "claude-sdk-python": {
        "package.json": JSON.stringify({ dependencies: PE38_DEPS }),
        "package-lock.json": pe38Lock({ reactIsIsPeer: true }),
      },
    });
    const peers = of(violations, "undeclared-peer");
    assert.deepEqual(
      peers.map((v) => v.subject),
      ["react-is"],
    );

    const [v] = peers;
    assert.equal(v.starter, "claude-sdk-python");
    assert.equal(
      v.manifest,
      path.join(
        "examples",
        "integrations",
        "claude-sdk-python",
        "package.json",
      ),
    );
    // Name the package that needs it, so the fix is obvious from the log.
    assert.match(v.detail, /recharts/);
    assert.match(v.fix, /Add "react-is" to dependencies/);
  });

  it("passes once react-is is declared", () => {
    const violations = check({
      "claude-sdk-python": {
        "package.json": JSON.stringify({
          dependencies: { ...PE38_DEPS, "react-is": "^19.2.4" },
        }),
        "package-lock.json": pe38Lock({ reactIsIsPeer: false }),
      },
    });
    assert.deepEqual(of(violations, "undeclared-peer"), []);
  });

  it("exempts @types/* peers", () => {
    const violations = check({
      "claude-sdk-python": {
        "package.json": JSON.stringify({
          dependencies: { ...PE38_DEPS, "react-is": "^19.2.4" },
        }),
        "package-lock.json": pe38Lock({ reactIsIsPeer: false }),
      },
    });
    assert.deepEqual(
      violations.filter((v) => v.subject.startsWith("@types/")),
      [],
    );
  });

  it("ignores a peer nested under another package", () => {
    // `x/node_modules/y` is physically present for its requirer under every
    // resolver, so it is not at risk and must not be reported.
    const violations = check({
      nested: {
        "package.json": JSON.stringify({
          dependencies: { "@angular/core": "22.0.0" },
        }),
        "package-lock.json": JSON.stringify({
          packages: {
            "": {},
            "node_modules/@angular/forms/node_modules/zod": {
              version: "4.5.4",
              peer: true,
            },
          },
        }),
      },
    });
    assert.deepEqual(of(violations, "undeclared-peer"), []);
  });
});

// ---------------------------------------------------------------------------
// PE-139 — a floating npm tag in a starter.
// ---------------------------------------------------------------------------

describe("npm floating tags", () => {
  it("flags `latest`, `next`, `*` and an unpinned git URL", () => {
    const violations = check({
      demo: {
        "package.json": JSON.stringify({
          dependencies: {
            "@a2a-js/sdk": "latest",
            alpha: "next",
            beta: "*",
            gamma: "github:acme/gamma",
            fine: "^1.2.3",
            "also-fine": "github:acme/delta#v1.0.0",
          },
        }),
      },
    });
    assert.deepEqual(
      of(violations, "npm-floating-tag")
        .map((v) => v.subject)
        .sort(),
      ["@a2a-js/sdk", "alpha", "beta", "gamma"],
    );
  });
});

// ---------------------------------------------------------------------------
// Parser behaviour that the rules depend on.
// ---------------------------------------------------------------------------

describe("pyproject parsing", () => {
  it("does not stop at a dependency that carries extras", () => {
    // Regression: testing the raw line for `]` ended the array at
    // `uvicorn[standard]` and silently skipped every dependency after it,
    // which hid four unconstrained deps per ADK starter.
    const deps = parsePyprojectDeps(`[project]
dependencies = [
  "fastapi",
  "uvicorn[standard]",
  "python-dotenv",
  "google-adk",
]
`);
    assert.deepEqual(deps, [
      "fastapi",
      "uvicorn[standard]",
      "python-dotenv",
      "google-adk",
    ]);
  });

  it("ignores dependencies outside [project]", () => {
    const deps = parsePyprojectDeps(`[build-system]
requires = ["hatchling"]

[tool.poetry]
dependencies = ["should-not-appear"]

[project]
dependencies = ["real-dep>=1.0"]
`);
    assert.deepEqual(deps, ["real-dep>=1.0"]);
  });

  it("reads uv workspace sources so local members are not treated as PyPI deps", () => {
    const text = `[project]
dependencies = ["uvicorn", "ag-ui-agent-spec[langgraph, wayflow]"]

[tool.uv.sources]
ag-ui-agent-spec = { path = "../../ag-ui", editable = true }
`;
    assert.deepEqual([...parseUvSources(text)], ["ag-ui-agent-spec"]);

    const violations = check({
      "agent-spec": { "agent/pyproject.toml": text },
    });
    assert.deepEqual(
      of(violations, "python-unconstrained").map((v) => v.subject),
      ["uvicorn"],
    );
  });

  it("splits extras and environment markers off a requirement", () => {
    assert.deepEqual(splitRequirement("a2a-sdk[http-server]>=0.3,<1.0"), {
      name: "a2a-sdk",
      constraint: ">=0.3,<1.0",
    });
    assert.deepEqual(splitRequirement("a2a-sdk[http-server]"), {
      name: "a2a-sdk",
      constraint: "",
    });
    assert.deepEqual(
      splitRequirement("typing-extensions>=4.6; python_version < '3.11'"),
      {
        name: "typing-extensions",
        constraint: ">=4.6",
      },
    );
  });
});
