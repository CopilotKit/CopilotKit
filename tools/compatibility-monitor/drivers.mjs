import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adapters, verifyResolved } from "./request.mjs";

export async function runAdapter(request, context) {
  const work = mkdtempSync(join(tmpdir(), "compatibility-consumer-"));
  const state = { resolvedDependencies: {}, cases: [] };
  const { output } = context;
  const runCase = (id, fn) => {
    try {
      fn();
      state.cases.push({ contractId: id, status: "passed" });
    } catch (e) {
      state.cases.push({
        contractId: id,
        status: "failed",
        message: e.message.slice(0, 4000),
      });
    }
  };
  try {
    if (request.adapterId.endsWith("-ts"))
      await typescript(request, { ...context, work, state, runCase });
    else if (request.adapterId.endsWith("-python"))
      runPython(request, { ...context, work, state, runCase });
    else dotnet(request, { ...context, work, state, runCase });
  } catch (e) {
    state.cases.push({
      contractId: "installation-or-harness",
      status: "blocked",
      message: e.message.slice(0, 4000),
    });
    state.failureStage = "installation-or-harness";
  } finally {
    // Preserve resolver evidence even when setup or execution fails.
    for (const file of [
      "package.json",
      "package-lock.json",
      "requirements.txt",
      "resolved.json",
      "pytest.xml",
      "Skills.Tests.csproj",
      "packages.lock.json",
      "obj/project.assets.json",
    ])
      if (existsSync(join(work, file)))
        cpSync(join(work, file), join(output, file.replaceAll("/", "-")));
  }
  return state;
}
function runPython(r, { source, output, work, command, state, runCase }) {
  const adapter = adapters[r.adapterId];
  const root = join(source, "packages", adapter.directory);
  const artifacts = join(work, "artifacts");
  mkdirSync(artifacts);
  command("uv", ["venv", "--python", "3.11", join(work, ".venv")], work);
  const python = join(work, ".venv/bin/python");
  let spec = `${adapter.name}==${r.adapterVersion}`;
  let extras = [];
  if (r.track === "source") {
    for (const directory of ["runtime-python", adapter.directory])
      command(
        "uv",
        [
          "build",
          "--wheel",
          "--out-dir",
          artifacts,
          join(source, "packages", directory),
        ],
        work,
      );
    const wheels = readdirSync(artifacts)
      .filter((f) => f.endsWith(".whl"))
      .map((f) => join(artifacts, f));
    spec = wheels.find((f) =>
      f.includes(adapter.name.replaceAll("-", "_") + "-"),
    );
    assert.ok(spec, "Adapter wheel missing");
    extras = wheels.filter((f) => f !== spec);
  }
  const dependencies = Object.entries(r.dependencies).map(
    ([n, v]) => `${n}==${v}`,
  );
  const base = ["pip", "install", "--python", python];
  const install = [
    ...base,
    spec,
    ...extras,
    "pytest==8.4.2",
    "pytest-asyncio==0.26.0",
    ...dependencies,
  ];
  try {
    command("uv", install, work);
  } catch (error) {
    if (!r.experimental) throw error;
    writeFileSync(
      join(output, "declared-install-rejected.txt"),
      "Normal dependency resolution rejected this combination; experimental overrides follow. See execution.log.",
    );
    writeFileSync(join(work, "overrides.txt"), dependencies.join("\n"));
    command(
      "uv",
      [...install, "--override", join(work, "overrides.txt")],
      work,
    );
  }
  const imports =
    r.adapterId === "langgraph-python"
      ? { langchain: "langchain", langgraph: "langgraph.graph" }
      : { "google-adk": "google.adk" };
  const adapterModule = adapter.name.replaceAll("-", "_");
  const probe = `import importlib,importlib.metadata,json,pathlib\nimport ${adapterModule} as adapter\nassert 'site-packages' in str(pathlib.Path(adapter.__file__).resolve())\npackages=${JSON.stringify(imports)}\nfor module in packages.values(): importlib.import_module(module)\nprint(json.dumps({name:importlib.metadata.version(name) for name in packages}))\n`;
  state.resolvedDependencies = JSON.parse(
    command(python, ["-I", "-c", probe], work),
  );
  verifyResolved(r, state.resolvedDependencies);
  state.resolvedGraph = JSON.parse(
    command(
      python,
      [
        "-I",
        "-c",
        'import importlib.metadata,json; print(json.dumps({d.metadata["Name"]:d.version for d in importlib.metadata.distributions()}))',
      ],
      work,
    ),
  );
  writeFileSync(
    join(work, "requirements.txt"),
    command("uv", ["pip", "freeze", "--python", python], work),
  );
  const tests = join(work, adapter.directory, "tests");
  cpSync(join(root, "tests"), tests, { recursive: true });
  cpSync(
    join(source, "packages/intelligence-delivery-python-core/conformance"),
    join(work, "intelligence-delivery-python-core/conformance"),
    { recursive: true },
  );
  runCase("native-lifecycle", () => {
    command(
      python,
      [
        "-I",
        "-m",
        "pytest",
        tests,
        "-q",
        "-o",
        "asyncio_mode=auto",
        "--junitxml=" + join(work, "pytest.xml"),
      ],
      work,
    );
    const xml = readFileSync(join(work, "pytest.xml"), "utf8");
    assert.match(xml, /<testcase /, "No native tests ran");
    assert.doesNotMatch(xml, /<skipped/, "Native contracts were skipped");
  });
}
async function typescript(
  r,
  { source, output, work, command, state, runCase },
) {
  const adapter = adapters[r.adapterId];
  const root = join(source, "packages", adapter.directory);
  if (r.track === "source")
    command(
      "pnpm",
      ["nx", "run", adapter.name + ":build", "--skip-nx-cache"],
      source,
    );
  rmSync(join(output, "consumer-evidence.json"), { force: true });
  const plan = join(work, "plan.json");
  writeFileSync(plan, JSON.stringify({ ...r, output }));
  // The native harness exports evidence before propagating a failed test.
  runCase("native-lifecycle-and-types", () =>
    command(
      process.execPath,
      [join(root, "test/compatibility.mjs"), "--monitor-plan", plan],
      source,
    ),
  );
  const evidence = join(output, "consumer-evidence.json");
  assert.ok(existsSync(evidence), "Consumer did not record loaded versions");
  Object.assign(state, JSON.parse(readFileSync(evidence, "utf8")));
  verifyResolved(r, state.resolvedDependencies);
  const reportPath = join(output, "native-results.json");
  if (existsSync(reportPath)) {
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    if (!report.numTotalTests || report.numPendingTests)
      state.cases.push({
        contractId: "native-coverage",
        status: "blocked",
        message: "Native tests were absent or skipped",
      });
  }
}
function dotnet(r, { source, output, work, command, state, runCase }) {
  const root = join(source, "packages/intelligence-agent-framework-dotnet");
  const artifacts = join(work, "artifacts");
  mkdirSync(artifacts);
  let version = r.adapterVersion;
  if (r.track === "source") {
    command(
      "dotnet",
      [
        "pack",
        join(
          source,
          "packages/runtime-dotnet/sdk/CopilotKit.Intelligence.csproj",
        ),
        "-o",
        artifacts,
      ],
      work,
    );
    command(
      "dotnet",
      [
        "pack",
        join(root, "src/CopilotKit.Intelligence.AgentFramework.csproj"),
        "-o",
        artifacts,
      ],
      work,
    );
    version = readFileSync(
      join(root, "src/CopilotKit.Intelligence.AgentFramework.csproj"),
      "utf8",
    ).match(/<Version>(.*?)<\/Version>/)[1];
  }
  cpSync(join(root, "tests"), work, { recursive: true });
  for (const name of ["snapshots", "lifecycle"])
    cpSync(
      join(
        source,
        `packages/intelligence-delivery-python-core/conformance/${name}.v1.json`,
      ),
      join(work, `${name}.v1.json`),
    );
  const framework = r.dependencies["Microsoft.Agents.AI"];
  writeFileSync(
    join(work, "Skills.Tests.csproj"),
    `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable><RestorePackagesWithLockFile>true</RestorePackagesWithLockFile></PropertyGroup><ItemGroup><PackageReference Include="CopilotKit.Intelligence.AgentFramework" Version="[${version}]"/><PackageReference Include="Microsoft.Agents.AI" Version="[${framework}]"/><PackageReference Include="Microsoft.Extensions.DependencyInjection" Version="10.0.4"/><None Include="*.v1.json" CopyToOutputDirectory="PreserveNewest"/></ItemGroup></Project>`,
  );
  const restore = [
    "restore",
    "--source",
    "https://api.nuget.org/v3/index.json",
  ];
  if (r.track === "source") restore.push("--source", artifacts);
  // NU1608 records a declared range violation even if NuGet otherwise allows it.
  try {
    command("dotnet", [...restore, "-warnaserror:NU1608,NU1605"], work);
  } catch (error) {
    if (!r.experimental) throw error;
    writeFileSync(
      join(output, "declared-install-rejected.txt"),
      "Normal NuGet restore rejected the combination. Experimental restore follows.",
    );
    command("dotnet", [...restore, "-p:NoWarn=NU1608%3BNU1605"], work);
  }
  const assets = JSON.parse(
    readFileSync(join(work, "obj/project.assets.json"), "utf8"),
  );
  state.resolvedGraph = Object.fromEntries(
    Object.keys(assets.libraries).map((key) => [
      key.slice(0, key.lastIndexOf("/")),
      key.slice(key.lastIndexOf("/") + 1),
    ]),
  );
  const key = Object.keys(assets.libraries).find((n) =>
    n.startsWith("Microsoft.Agents.AI/"),
  );
  assert.ok(key, "Framework was not resolved");
  // Assert the native test executable loads the resolved framework assembly.
  const program = join(work, "Program.cs");
  let text = readFileSync(program, "utf8");
  const marker = "using var fixtures";
  assert.ok(text.includes(marker));
  text = text.replace(
    marker,
    `Console.WriteLine("COMPAT_LOADED:" + typeof(Microsoft.Agents.AI.ChatClientAgent).Assembly.Location);\n${marker}`,
  );
  writeFileSync(program, text);
  runCase("native-lifecycle", () => {
    let stdout, failure;
    try {
      stdout = command("dotnet", ["run", "--no-restore"], work);
    } catch (error) {
      stdout = String(error.stdout ?? "");
      failure = error;
    }
    assert.match(
      stdout,
      /COMPAT_LOADED:.*Microsoft\.Agents\.AI\.dll/,
      "Native suite did not load framework",
    );
    assert.match(stdout, /PASS /, "No native assertions ran");
    state.resolvedDependencies = { "Microsoft.Agents.AI": key.split("/")[1] };
    verifyResolved(r, state.resolvedDependencies);
    if (failure) throw failure;
  });
  // When the executable fails, retain resolution metadata but do not claim a loaded version.
  if (!Object.keys(state.resolvedDependencies).length)
    state.cases.push({
      contractId: "loaded-version",
      status: "blocked",
      message: "Native execution did not establish loaded framework version",
    });
}
