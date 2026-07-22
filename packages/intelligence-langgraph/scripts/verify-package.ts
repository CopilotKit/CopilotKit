import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  NATIVE_HOOK_SIGNATURE,
  assertResolvedCompatibility,
  extractNativeRegistrationSnippet,
  formatCompatibilityEvidence,
} from "./verify-package-lib.js";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const artifacts = join(packageRoot, "artifacts");

interface PackedResult {
  readonly filename: string;
  readonly files: ReadonlyArray<{ readonly path: string }>;
}

function requestedModes(): readonly ("minimum" | "latest")[] {
  const modeIndex = process.argv.indexOf("--mode");
  if (modeIndex < 0) return ["minimum", "latest"];
  const mode = process.argv[modeIndex + 1];
  if (mode !== "minimum" && mode !== "latest") {
    throw new Error("--mode must be minimum or latest");
  }
  return [mode];
}

async function pack(): Promise<{
  readonly path: string;
  readonly result: PackedResult;
}> {
  await rm(artifacts, { recursive: true, force: true });
  await mkdir(artifacts, { recursive: true });
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--json", "--silent", "--pack-destination", artifacts],
    { cwd: packageRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("npm pack must produce exactly one artifact");
  }
  const result = parsed[0];
  if (
    typeof result !== "object" ||
    result === null ||
    !("filename" in result) ||
    typeof result.filename !== "string" ||
    !("files" in result) ||
    !Array.isArray(result.files)
  ) {
    throw new Error("npm pack returned an unexpected manifest");
  }
  const files = result.files.map((file: unknown) => {
    if (
      typeof file !== "object" ||
      file === null ||
      !("path" in file) ||
      typeof file.path !== "string"
    ) {
      throw new Error("npm pack returned an invalid file entry");
    }
    return { path: file.path };
  });
  return {
    path: join(artifacts, result.filename),
    result: { filename: result.filename, files },
  };
}

async function verifyContents(result: PackedResult): Promise<void> {
  const paths = result.files.map((file) => file.path).sort();
  const allowed = paths.every(
    (path) =>
      path === "LICENSE" ||
      path === "README.md" ||
      path === "package.json" ||
      path.startsWith("dist/"),
  );
  if (!allowed) throw new Error(`Unexpected packed files: ${paths.join(", ")}`);
  for (const required of [
    "LICENSE",
    "README.md",
    "package.json",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    if (!paths.includes(required))
      throw new Error(`Packed artifact is missing ${required}`);
  }
  if (
    paths.some(
      (path) => path.includes("conformance") || path.includes("examples"),
    )
  ) {
    throw new Error("Test corpus and examples must not be published");
  }
}

async function verifyConsumer(
  tarball: string,
  mode: "minimum" | "latest",
): Promise<void> {
  const temporary = await mkdtemp(
    join(tmpdir(), `intelligence-langgraph-${mode}-`),
  );
  try {
    const packageJson = {
      private: true,
      type: "module",
      dependencies: {
        "@copilotkit/intelligence": `file:${join(repositoryRoot, "packages/intelligence")}`,
        "@copilotkit/intelligence-langgraph": `file:${tarball}`,
        "@langchain/core": mode === "minimum" ? "1.1.48" : "^1.1.48",
        "@langchain/langgraph": mode === "minimum" ? "1.3.0" : ">=1.3.0 <2.0.0",
        "@types/node": "^20.0.0",
        langchain: mode === "minimum" ? "1.4.4" : ">=1.4.4 <2.0.0",
        typescript: "^5.6.3",
      },
    };
    await writeFile(
      join(temporary, "package.json"),
      JSON.stringify(packageJson, null, 2),
    );
    await writeFile(
      join(temporary, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          skipLibCheck: true,
          noEmit: true,
          types: ["node"],
        },
        include: ["index.ts", "native-signature.ts"],
      }),
    );
    const installedPackageRoot = join(
      temporary,
      "node_modules",
      "@copilotkit",
      "intelligence-langgraph",
    );
    await execFileAsync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: temporary, maxBuffer: 20 * 1024 * 1024 },
    );
    const installedReadme = await readFile(
      join(installedPackageRoot, "README.md"),
      "utf8",
    );
    const registrationSnippet =
      extractNativeRegistrationSnippet(installedReadme);
    await writeFile(join(temporary, "index.ts"), `${registrationSnippet}\n`);
    await writeFile(
      join(temporary, "native-signature.ts"),
      `import { createMiddleware } from "langchain";

const probe = createMiddleware({
  name: "NativeHookSignatureProbe",
  wrapModelCall: (request, handler) => handler({ ...request }),
});
const nativeHook = probe.wrapModelCall;
if (nativeHook === undefined) throw new Error("wrapModelCall is unavailable");
void nativeHook;
const signature = ${JSON.stringify(NATIVE_HOOK_SIGNATURE)};
void signature;
`,
    );
    const tsc = join(temporary, "node_modules", ".bin", "tsc");
    await execFileAsync(tsc, ["--project", "tsconfig.json"], {
      cwd: temporary,
      maxBuffer: 20 * 1024 * 1024,
    });
    const resolvedLanggraph = JSON.parse(
      await readFile(
        join(temporary, "node_modules/@langchain/langgraph/package.json"),
        "utf8",
      ),
    );
    const resolvedLangchain = JSON.parse(
      await readFile(
        join(temporary, "node_modules/langchain/package.json"),
        "utf8",
      ),
    );
    const versions = {
      langgraph: String(resolvedLanggraph.version),
      langchain: String(resolvedLangchain.version),
    };
    assertResolvedCompatibility(mode, versions);
    process.stdout.write(`${formatCompatibilityEvidence(mode, versions)}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const packed = await pack();
await verifyContents(packed.result);
for (const mode of requestedModes()) await verifyConsumer(packed.path, mode);
process.stdout.write(`${basename(packed.path)} contents PASS\n`);
