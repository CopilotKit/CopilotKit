import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const workflow = readFileSync(
  new URL("../../../.github/workflows/test_unit.yml", import.meta.url),
  "utf8",
);

/** The body of one step of the unit-test job, by its name. */
function step(name: string) {
  const match = workflow.match(
    new RegExp(`      - name: ${name}\\n([\\s\\S]*?)(?=\\n      - name:|$)`),
  );
  expect(match, `missing workflow step: ${name}`).not.toBeNull();
  return match?.[1] ?? "";
}

test("selects the codemod projects next to the packages for unit tests", () => {
  const commands =
    step("Select test projects").match(/npx nx show projects [^\n]*/g) ?? [];

  // One command for a full run and one for an affected run.
  expect(commands).toHaveLength(2);
  for (const command of commands) {
    expect(command).toContain("--projects='packages/**,codemods/**'");
  }
});
