import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
export function verifyLocalNugetArtifacts(artifacts, assets) {
  for (const name of [
    "CopilotKit.Intelligence",
    "CopilotKit.Intelligence.AgentFramework",
  ]) {
    const key = Object.keys(assets.libraries).find((key) =>
      key.startsWith(name + "/"),
    );
    assert.ok(key, `Missing source artifact ${name}`);
    const archive = readFileSync(
      join(artifacts, key.replace("/", ".") + ".nupkg"),
    );
    assert.equal(
      assets.libraries[key].sha512,
      createHash("sha512").update(archive).digest("base64"),
      `Installed ${name} differs from source artifact`,
    );
  }
}
export function sourceNugetConfig(artifacts) {
  const escaped = artifacts
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
  return `<?xml version="1.0" encoding="utf-8"?><configuration><packageSources><clear/><add key="local" value="${escaped}"/><add key="nuget" value="https://api.nuget.org/v3/index.json"/></packageSources><packageSourceMapping><packageSource key="local"><package pattern="CopilotKit.Intelligence"/><package pattern="CopilotKit.Intelligence.AgentFramework"/></packageSource><packageSource key="nuget"><package pattern="*"/></packageSource></packageSourceMapping></configuration>`;
}
