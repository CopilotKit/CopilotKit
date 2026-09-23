import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { verifyLocalNugetArtifacts } from "./nuget.mjs";
test("source NuGet packages must match locally built artifacts rather than same-version registry copies", () => {
  const artifacts = mkdtempSync(join(tmpdir(), "nuget-identity-"));
  const bytes = Buffer.from("local source artifact");
  const libraries = {};
  for (const name of [
    "CopilotKit.Intelligence",
    "CopilotKit.Intelligence.AgentFramework",
  ]) {
    writeFileSync(join(artifacts, `${name}.0.1.0-rc.1.nupkg`), bytes);
    libraries[`${name}/0.1.0-rc.1`] = {
      sha512: createHash("sha512").update(bytes).digest("base64"),
    };
  }
  assert.doesNotThrow(() =>
    verifyLocalNugetArtifacts(artifacts, { libraries }),
  );
  libraries["CopilotKit.Intelligence/0.1.0-rc.1"].sha512 = "registry package";
  assert.throws(
    () => verifyLocalNugetArtifacts(artifacts, { libraries }),
    /source artifact/,
  );
});
