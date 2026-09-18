// Apply only the reviewed patch to the exact locked runtime artifact.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const manifest = require("./manifest.json");
const root = path.resolve(
  process.argv[2] || "node_modules/@copilotkit/runtime",
);
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
if (pkg.name !== manifest.package || pkg.version !== manifest.version)
  throw new Error(
    "Unexpected runtime package/version; review this patch before upgrading",
  );
const helper = fs.readFileSync(path.join(__dirname, "mcp-proxy.cjs"));
if (hash(helper) !== manifest.helperSha256)
  throw new Error("Unreviewed MCP helper bytes");
const outputs = manifest.modules.map((entry) => {
  const target = path.join(root, entry.path);
  const bytes = fs.readFileSync(target);
  const currentHash = hash(bytes);
  if (currentHash === entry.outputSha256)
    return { target, bytes, patched: true };
  if (currentHash !== entry.inputSha256)
    throw new Error(`Runtime source drift: ${entry.path}`);
  const source = bytes.toString("utf8");
  if (source.split(entry.anchor).length !== 2)
    throw new Error(`Ambiguous patch boundary: ${entry.path}`);
  const output = Buffer.from(
    entry.import + source.replace(entry.anchor, entry.anchor + entry.branch),
  );
  if (hash(output) !== entry.outputSha256)
    throw new Error(`Unexpected patch output: ${entry.path}`);
  return { target, bytes: output, patched: false };
});
const helperPath = path.join(root, manifest.helperPath);
if (outputs.some((entry) => entry.patched)) {
  if (
    !outputs.every((entry) => entry.patched) ||
    !fs.existsSync(helperPath) ||
    hash(fs.readFileSync(helperPath)) !== manifest.helperSha256
  )
    throw new Error("Partial or altered runtime patch");
} else {
  if (fs.existsSync(helperPath))
    throw new Error("Unexpected existing MCP helper");
  // All version and content guards passed before the first mutation.
  fs.writeFileSync(helperPath, helper);
  for (const entry of outputs) fs.writeFileSync(entry.target, entry.bytes);
}
console.log(`Applied Agno MCP proxy isolation to ${pkg.name}@${pkg.version}`);
