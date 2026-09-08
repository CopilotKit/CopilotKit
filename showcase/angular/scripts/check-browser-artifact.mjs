import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(scriptDirectory, "..");
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".ts"]);
const FORBIDDEN_LITERALS = [
  "SHOWCASE_BACKEND_HOST_PATTERN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
];

/** Return exact React runtime inputs while avoiding similarly named packages. */
export function findForbiddenInputs(inputNames) {
  return inputNames
    .filter((name) =>
      /(?:^|\/)(?:node_modules\/)?(?:\.pnpm\/)?react(?:-dom)?(?:@|\/)/.test(
        name,
      ),
    )
    .sort();
}

/** Return Angular core versions when the browser graph contains duplicates. */
export function findDuplicateAngularCoreInputs(inputNames) {
  const versions = [
    ...new Set(
      inputNames.flatMap((name) => {
        const match = name.match(/@angular\+core@([^/_]+)(?:_|\/)/);
        return match?.[1] ? [match[1]] : [];
      }),
    ),
  ].sort();
  return versions.length > 1 ? versions : [];
}

/** Return server-authority or provider-credential markers found in browser text. */
export function findForbiddenText(_name, contents) {
  const found = FORBIDDEN_LITERALS.filter((literal) =>
    contents.includes(literal),
  );
  if (
    /\b(?:sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,})\b/.test(
      contents,
    )
  ) {
    found.push("OpenAI credential-shaped value");
  }
  if (/\bsk-ant-[A-Za-z0-9_-]{20,}\b/.test(contents)) {
    found.push("Anthropic credential-shaped value");
  }
  if (/\bAIza[A-Za-z0-9_-]{30,}\b/.test(contents)) {
    found.push("Google credential-shaped value");
  }
  return found;
}

function textFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (TEXT_EXTENSIONS.has(extname(entry.name))) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

function run() {
  const stats = JSON.parse(
    readFileSync(
      join(projectDirectory, "dist/showcase-angular/stats.json"),
      "utf8",
    ),
  );
  const inputNames = Object.keys(stats.inputs ?? {});
  const reactInputs = findForbiddenInputs(inputNames);
  const duplicateAngularCoreVersions =
    findDuplicateAngularCoreInputs(inputNames);
  const findings = [];
  for (const root of [
    join(projectDirectory, "src"),
    join(projectDirectory, "dist/showcase-angular/browser"),
  ]) {
    for (const file of textFiles(root)) {
      for (const marker of findForbiddenText(
        file,
        readFileSync(file, "utf8"),
      )) {
        findings.push({ file: relative(projectDirectory, file), marker });
      }
    }
  }

  const passes =
    reactInputs.length === 0 &&
    duplicateAngularCoreVersions.length === 0 &&
    findings.length === 0;
  console.log(
    JSON.stringify({
      event: "angular_showcase_browser_artifact_audit",
      reactInputs,
      duplicateAngularCoreVersions,
      forbiddenText: findings,
      passes,
    }),
  );
  if (!passes) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
