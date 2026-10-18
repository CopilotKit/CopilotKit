import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const grader = fileURLToPath(new URL("./check.ts", import.meta.url));

/** Run the real grader on an isolated project with a failing compile gate. */
function gradeProvider(provider: string, subpath = "/v2") {
  const workspace = mkdtempSync(path.join(tmpdir(), "skill-grader-"));
  try {
    mkdirSync(path.join(workspace, "node_modules"));
    writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({
        scripts: { typecheck: "node -e 'process.exit(1)'" },
        dependencies: {
          "@copilotkit/react-core": "latest",
          "@copilotkit/runtime": "latest",
        },
      }),
    );
    writeFileSync(
      path.join(workspace, "App.tsx"),
      `import { ${provider} } from "@copilotkit/react-core${subpath}";\nexport const App = () => <${provider} />;`,
    );
    return JSON.parse(
      execFileSync(process.execPath, ["--import", "tsx", grader], {
        env: { ...process.env, WORKSPACE: workspace },
        encoding: "utf8",
      }),
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

for (const provider of ["CopilotKitProvider", "CopilotKit"]) {
  test(`accepts the supported v2 provider ${provider} without bypassing compilation`, () => {
    const result = gradeProvider(provider);
    assert.equal(
      result.checks.find((check: { name: string }) =>
        check.name.startsWith("provider "),
      ).passed,
      true,
    );
    assert.ok(
      result.score < 0.8,
      "a failed compile must stay below the passing threshold",
    );
  });
}

test("rejects a provider imported from the deprecated root", () => {
  const result = gradeProvider("CopilotKitProvider", "");
  assert.equal(
    result.checks.find((check: { name: string }) =>
      check.name.startsWith("provider "),
    ).passed,
    false,
  );
});
