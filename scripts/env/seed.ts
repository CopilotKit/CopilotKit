#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const toPosix = (path: string) => path.split("\\").join("/");

const TEMPLATE_NAME_PATTERN =
  /(^|\/)(\.env(?:\.[^/]*)?\.example|env\.example)$/;

const DEFAULT_DOTENV_SOURCE = "op://Engineering/CopilotKit/notesPlain";

export interface EnvTemplate {
  path: string;
  relativePath: string;
}

export interface EnvEntry {
  key: string;
  value: string;
}

export type EnvLine =
  | {
      type: "entry";
      raw: string;
      key: string;
      value: string;
      exportPrefix: string;
      suffix: string;
    }
  | { type: "other"; raw: string };

export interface ParsedEnv {
  lines: EnvLine[];
  entries: EnvEntry[];
}

export interface ResolveTemplateOptions {
  template: string;
  existing?: string;
  source?: string;
  dotenvValues?: Map<string, string>;
  force?: boolean;
  readSecret: (ref: string) => Promise<string>;
}

export interface ResolveTemplateResult {
  content: string;
  updatedKeys: string[];
  skippedKeys: string[];
  failedKeys: string[];
  missingDotenvKeys: string[];
}

export interface SeedFileResult {
  templatePath: string;
  targetPath: string;
  updatedKeys: string[];
  skippedKeys: string[];
  failedKeys: string[];
  skipped?: boolean;
  reason?: "not_gitignored" | "read_failed" | "write_failed";
}

export interface SeedEnvOptions {
  cwd: string;
  source?: string;
  dotenvSource?: string;
  force?: boolean;
  strict?: boolean;
  readSecret?: (ref: string) => Promise<string>;
  isIgnored?: (path: string) => Promise<boolean>;
  log?: (message: string) => void;
}

export interface SeedEnvResult {
  exitCode: 0 | 1;
  files: SeedFileResult[];
}

interface ParsedDotenvPayload {
  values: Map<string, string>;
  malformedLines: number[];
}

export async function discoverEnvTemplates(
  cwd: string,
): Promise<EnvTemplate[]> {
  const { stdout } = await execFile("git", ["ls-files", "-z"], { cwd });
  const matches = stdout
    .split("\0")
    .filter(Boolean)
    .map(toPosix)
    .filter((path) => TEMPLATE_NAME_PATTERN.test(path));

  return [...new Set(matches.map(toPosix))]
    .sort()
    .map((relativePath) => ({ path: join(cwd, relativePath), relativePath }));
}

export function deriveEnvTarget(templatePath: string): string {
  const posixPath = toPosix(templatePath);
  if (posixPath.endsWith("/env.example")) {
    return `${posixPath.slice(0, -"env.example".length)}.env`;
  }
  if (posixPath === "env.example") return ".env";
  if (posixPath.endsWith(".example"))
    return posixPath.slice(0, -".example".length);
  return posixPath;
}

export function parseEnvTemplate(content: string): ParsedEnv {
  const lines = content.split(/\r?\n/);
  const parsedLines: EnvLine[] = [];
  const entries: EnvEntry[] = [];

  for (const raw of lines) {
    if (raw === "") {
      parsedLines.push({ type: "other", raw });
      continue;
    }

    const match = raw.match(
      /^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/,
    );
    if (!match) {
      parsedLines.push({ type: "other", raw });
      continue;
    }

    const exportPrefix = match[1] ?? "";
    const key = match[2];
    const { value, suffix } = parseValue(match[3]);
    parsedLines.push({ type: "entry", raw, key, value, exportPrefix, suffix });
    entries.push({ key, value });
  }

  return { lines: parsedLines, entries };
}

export async function resolveTemplate(
  opts: ResolveTemplateOptions,
): Promise<ResolveTemplateResult> {
  const source = opts.source?.replace(/\/+$/, "");
  const template = parseEnvTemplate(opts.template);
  const existing = parseEnvTemplate(opts.existing ?? "");
  const templateKeys = new Set(template.entries.map((entry) => entry.key));
  const existingValues = new Map(
    existing.entries.map((entry) => [entry.key, entry.value]),
  );
  const existingLines = new Map(
    existing.lines
      .filter((line) => line.type === "entry")
      .map((line) => [line.key, line]),
  );
  const resolvedValues = new Map<string, string>();
  const rawWinningExistingKeys = new Set<string>();
  const updatedKeys: string[] = [];
  const skippedKeys: string[] = [];
  const failedKeys: string[] = [];
  const missingDotenvKeys: string[] = [];

  for (const entry of template.entries) {
    const currentValue = existingValues.get(entry.key);
    if (!opts.force && currentValue && currentValue.trim() !== "") {
      resolvedValues.set(entry.key, currentValue);
      rawWinningExistingKeys.add(entry.key);
      continue;
    }

    if (!entry.value.startsWith("op://") && opts.dotenvValues?.has(entry.key)) {
      const dotenvValue = opts.dotenvValues.get(entry.key) ?? "";
      if (dotenvValue.includes("\n") || dotenvValue.includes("\r")) {
        failedKeys.push(entry.key);
        resolvedValues.set(entry.key, currentValue ?? entry.value);
        continue;
      }
      resolvedValues.set(entry.key, dotenvValue);
      updatedKeys.push(entry.key);
      continue;
    }

    if (
      !entry.value.startsWith("op://") &&
      opts.dotenvValues &&
      !opts.dotenvValues.has(entry.key)
    ) {
      missingDotenvKeys.push(entry.key);
    }

    const ref = entry.value.startsWith("op://")
      ? entry.value
      : source
        ? `${source}/${entry.key}`
        : "";

    if (!ref) {
      skippedKeys.push(entry.key);
      resolvedValues.set(entry.key, currentValue ?? entry.value);
      continue;
    }

    try {
      const secret = await opts.readSecret(ref);
      if (secret.includes("\n") || secret.includes("\r")) {
        failedKeys.push(entry.key);
        resolvedValues.set(entry.key, currentValue ?? entry.value);
        continue;
      }
      resolvedValues.set(entry.key, secret);
      updatedKeys.push(entry.key);
    } catch {
      failedKeys.push(entry.key);
      resolvedValues.set(entry.key, currentValue ?? entry.value);
    }
  }

  const outputLines = template.lines.map((line) => {
    if (line.type !== "entry") return line.raw;
    const existingLine = existingLines.get(line.key);
    if (rawWinningExistingKeys.has(line.key) && existingLine) {
      return existingLine.raw;
    }
    const value = resolvedValues.get(line.key) ?? line.value;
    return `${line.exportPrefix}${line.key}=${serializeDotenvValue(value)}${line.suffix}`;
  });
  const extraExistingLines = existing.lines
    .filter((line) => line.type === "entry" && !templateKeys.has(line.key))
    .map((line) => line.raw);

  if (extraExistingLines.length > 0) {
    if (outputLines.at(-1) !== "") outputLines.push("");
    outputLines.push(...extraExistingLines);
  }

  return {
    content: outputLines.join("\n"),
    updatedKeys,
    skippedKeys,
    failedKeys,
    missingDotenvKeys,
  };
}

export async function seedEnvFiles(
  opts: SeedEnvOptions,
): Promise<SeedEnvResult> {
  const source = opts.source ?? process.env.OP_ENV_SOURCE;
  const dotenvSource =
    opts.dotenvSource ?? process.env.OP_DOTENV_SOURCE ?? DEFAULT_DOTENV_SOURCE;
  const readSecret = opts.readSecret ?? readOpSecret;
  const isIgnored = opts.isIgnored ?? ((path) => isGitIgnored(opts.cwd, path));
  const log = opts.log ?? console.log;
  const files: SeedFileResult[] = [];
  let dotenvValues: Map<string, string> | undefined;
  let dotenvSourceFailed = false;
  let dotenvSourceMalformed = false;

  const templates = await discoverEnvTemplates(opts.cwd);
  log(`env:seed found ${templates.length} template(s)`);

  if (dotenvSource) {
    try {
      const payload = await readSecret(dotenvSource);
      const parsed = parseDotenvPayload(payload);
      dotenvValues = parsed.values;
      if (parsed.malformedLines.length > 0) {
        dotenvSourceMalformed = true;
        log(
          `env:seed warn dotenv source ${dotenvSource}: malformed line(s): ${parsed.malformedLines.join(", ")}`,
        );
      }
    } catch {
      dotenvSourceFailed = true;
      log(`env:seed warn dotenv source ${dotenvSource}: unable to read`);
    }
  }

  for (const template of templates) {
    const targetPath = deriveEnvTarget(template.relativePath);
    if (!(await isIgnored(targetPath))) {
      log(`env:seed skip ${targetPath}: target is not gitignored`);
      files.push({
        templatePath: template.relativePath,
        targetPath,
        updatedKeys: [],
        skippedKeys: [],
        failedKeys: [],
        skipped: true,
        reason: "not_gitignored",
      });
      continue;
    }

    let templateContent: string;
    let existingContent = "";
    try {
      templateContent = await readFile(
        join(opts.cwd, template.relativePath),
        "utf8",
      );
      const absoluteTarget = join(opts.cwd, targetPath);
      if (existsSync(absoluteTarget))
        existingContent = await readFile(absoluteTarget, "utf8");
    } catch {
      log(`env:seed skip ${targetPath}: unable to read template or target`);
      files.push({
        templatePath: template.relativePath,
        targetPath,
        updatedKeys: [],
        skippedKeys: [],
        failedKeys: [],
        skipped: true,
        reason: "read_failed",
      });
      continue;
    }

    const resolved = await resolveTemplate({
      template: templateContent,
      existing: existingContent,
      source,
      dotenvValues,
      force: opts.force,
      readSecret,
    });

    try {
      const absoluteTarget = join(opts.cwd, targetPath);
      await mkdir(dirname(absoluteTarget), { recursive: true });
      await writeFile(absoluteTarget, resolved.content);
      log(
        `env:seed wrote ${targetPath}: ${resolved.updatedKeys.length} updated, ${resolved.skippedKeys.length} skipped, ${resolved.failedKeys.length} failed`,
      );
    } catch {
      log(`env:seed skip ${targetPath}: unable to write target`);
      files.push({
        templatePath: template.relativePath,
        targetPath,
        ...resolved,
        skipped: true,
        reason: "write_failed",
      });
      continue;
    }

    for (const key of resolved.skippedKeys) {
      log(
        `env:seed skip ${targetPath}:${key}: no op reference or source configured`,
      );
    }
    for (const key of resolved.missingDotenvKeys) {
      log(`env:seed warn ${targetPath}:${key}: not found in dotenv source`);
    }
    for (const key of resolved.failedKeys) {
      log(
        `env:seed warn ${targetPath}:${key}: op read failed or returned unsupported value`,
      );
    }

    files.push({
      templatePath: template.relativePath,
      targetPath,
      ...resolved,
    });
  }

  const hasFailures = files.some(
    (file) =>
      file.skipped || file.failedKeys.length > 0 || file.skippedKeys.length > 0,
  );
  return {
    exitCode:
      opts.strict &&
      (hasFailures || dotenvSourceFailed || dotenvSourceMalformed)
        ? 1
        : 0,
    files,
  };
}

function parseDotenvPayload(content: string): ParsedDotenvPayload {
  const values = new Map<string, string>();
  const malformedLines: number[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const match = raw.match(/^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=(.*)$/);
    if (!match || hasUnclosedQuotedValue(match[2])) {
      malformedLines.push(index + 1);
      continue;
    }

    const parsed = parseEnvTemplate(raw);
    const entryLines = parsed.lines.filter((line) => line.type === "entry");
    if (entryLines.length !== 1 || parsed.lines[0]?.type !== "entry") {
      malformedLines.push(index + 1);
      continue;
    }

    const line = parsed.lines[0];
    if (line.type === "entry") values.set(line.key, line.value);
  }

  return { values, malformedLines };
}

function hasUnclosedQuotedValue(value: string): boolean {
  const leadingWhitespace = value.match(/^\s*/)?.[0] ?? "";
  const trimmedStart = value.slice(leadingWhitespace.length);
  if (!trimmedStart.startsWith('"') && !trimmedStart.startsWith("'")) {
    return false;
  }

  const quote = trimmedStart[0];
  let escaped = false;
  for (let index = 1; index < trimmedStart.length; index++) {
    const char = trimmedStart[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === quote) return false;
  }
  return true;
}

function parseValue(value: string): { value: string; suffix: string } {
  const trimmed = value.trim();
  const leadingWhitespace = value.match(/^\s*/)?.[0] ?? "";
  const trimmedStart = value.slice(leadingWhitespace.length);
  if (trimmedStart.startsWith('"') || trimmedStart.startsWith("'")) {
    const quote = trimmedStart[0];
    let escaped = false;
    let content = "";
    for (let index = 1; index < trimmedStart.length; index++) {
      const char = trimmedStart[index];
      if (escaped) {
        content += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        return {
          value: content,
          suffix: trimmedStart.slice(index + 1),
        };
      }
      content += char;
    }
  }

  const commentMatch = value.match(/^(.*?)(\s+#.*)$/);
  if (!commentMatch) return { value: trimmed, suffix: "" };
  return { value: commentMatch[1].trim(), suffix: commentMatch[2] };
}

export function serializeDotenvValue(value: string): string {
  if (!needsQuotes(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function needsQuotes(value: string): boolean {
  return value !== "" && /[\s#"'\\`$]/.test(value);
}

async function readOpSecret(ref: string): Promise<string> {
  const { stdout } = await execFile("op", ["read", ref]);
  return stdout.replace(/\r?\n$/, "");
}

async function isGitIgnored(cwd: string, path: string): Promise<boolean> {
  const result = await execFile(
    "git",
    ["check-ignore", "--quiet", "--", path],
    {
      cwd,
      reject: false,
    },
  );
  return result.exitCode === 0;
}

function execFile(
  command: string,
  args: string[],
  opts: { cwd?: string; reject?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (command === "git") {
      for (const key of Object.keys(env)) {
        if (key.startsWith("GIT_")) delete env[key];
      }
    }
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (opts.reject === false)
        resolve({ stdout, stderr: String(error), exitCode: 1 });
      else reject(error);
    });
    child.on("close", (exitCode) => {
      if (exitCode === 0 || opts.reject === false)
        resolve({ stdout, stderr, exitCode });
      else reject(new Error(`${command} exited with ${exitCode}`));
    });
  });
}

export function parseArgs(argv: string[]) {
  const out: {
    source?: string;
    dotenvSource?: string;
    force: boolean;
    strict: boolean;
  } = {
    force: false,
    strict: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--force") out.force = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--source") out.source = argv[++index];
    else if (arg.startsWith("--source="))
      out.source = arg.slice("--source=".length);
    else if (arg === "--dotenv-source") out.dotenvSource = argv[++index];
    else if (arg.startsWith("--dotenv-source="))
      out.dotenvSource = arg.slice("--dotenv-source=".length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await seedEnvFiles({ cwd: process.cwd(), ...args });
  process.exit(result.exitCode);
}

if (
  process.argv[1] &&
  toPosix(process.argv[1]).endsWith("scripts/env/seed.ts")
) {
  void main();
}
