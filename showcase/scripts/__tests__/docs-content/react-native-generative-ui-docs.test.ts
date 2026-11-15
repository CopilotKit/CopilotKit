// Keeps the React Native generative UI examples in step with each other and
// with the code they describe.
//
// The same helpers and screens are copied into several pages: `runTurn`,
// `isChatSurface` and `ChatScreen` into the React Native guide and the
// components overview, and the self-contained `Home` example into the
// package README and USAGE. A fix that lands in one copy and not the others
// used to come back as a new review finding in the next round. (a) asserts
// that the copies are identical, with the differences listed below. (b) pins
// the claims that the examples rest on to facts of the source: the error
// codes `runTurn` counts as a failed run, the zod version the install lines
// pull, and the prop names of the reference pages.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const CONTENT = "showcase/shell-docs/src/content";
const GUIDE = `${CONTENT}/docs/frontends/react-native/index.mdx`;
const COMPONENTS_INDEX = `${CONTENT}/docs/generative-ui/components/index.mdx`;
const SURFACES = `${CONTENT}/docs/generative-ui/components/surfaces.mdx`;
const REFERENCE = `${CONTENT}/reference/react-native`;
const README = "packages/react-native/README.md";
const USAGE = "packages/react-native/USAGE.md";

function read(file: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

interface Fence {
  meta: string;
  code: string;
}

/** The fenced code blocks of a markdown or MDX file, dedented. */
function fences(file: string): Fence[] {
  const lines = read(file).split("\n");
  const result: Fence[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^(\s*)```(\w+)(.*)$/.exec(lines[i]);
    if (!open) continue;
    const indent = open[1].length;
    let end = i + 1;
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end += 1;
    const body = lines
      .slice(i + 1, end)
      .map((line) => (line.trim() === "" ? "" : line.slice(indent)));
    result.push({ meta: open[3], code: body.join("\n") });
    i = end;
  }
  return result;
}

/** The one fenced block with this title (if given) whose code has `marker`. */
function block(file: string, title: string | null, marker: string): string {
  const hits = fences(file).filter(
    (fence) =>
      (title === null || fence.meta.includes(`title="${title}"`)) &&
      fence.code.includes(marker),
  );
  expect(
    hits.length,
    `${file}: blocks titled ${title} containing ${marker}`,
  ).toBe(1);
  return hits[0].code;
}

/** Drops the docs-only highlight annotations, which are not code. */
function normalize(code: string): string {
  return code
    .replace(/[ \t]*\/\/ \[!code [^\]]*\]/g, "")
    .replace(/[ \t]*\{\/\* \[!code [^\]]*\] \*\/\}/g, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/** A top-level declaration, with the JSDoc right above it. */
function declaration(code: string, start: RegExp, name: string): string {
  const lines = code.split("\n");
  const first = lines.findIndex((line) => start.test(line));
  expect(first, `declaration of ${name}`).toBeGreaterThanOrEqual(0);
  let from = first;
  if (lines[first - 1]?.trim() === "*/") {
    while (from > 0 && !lines[from - 1].startsWith("/**")) from -= 1;
    from -= 1;
  }
  let to = first;
  while (to < lines.length && !/^(\}|\]\);)/.test(lines[to])) to += 1;
  return lines
    .slice(from, to + 1)
    .join("\n")
    .replace(/^export /m, "");
}

const runFailuresOf = (code: string) =>
  declaration(code, /^const RUN_FAILURES\b/, "RUN_FAILURES");
const isChatSurfaceOf = (code: string) =>
  declaration(code, /^(export )?function isChatSurface\(/, "isChatSurface");
const runTurnOf = (code: string) =>
  declaration(code, /^(export )?async function runTurn\(/, "runTurn");
const takeBackOf = (code: string) =>
  declaration(code, /^(export )?function takeBack\(/, "takeBack");

/**
 * Drops the line breaks and trailing commas that the formatter adds or
 * removes when a line gets shorter or longer, such as a signature without
 * `export`.
 */
function layoutFree(code: string): string {
  return code
    .replace(/,(\s*[)\]}])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/([([{]) /g, "$1")
    .replace(/ ([)\]}])/g, "$1");
}

const guideTurns = () => block(GUIDE, "src/agentTurns.ts", "runTurn");
const readmeHome = () => block(README, null, "GenerativeUIProvider");

describe("(a) duplicated React Native snippets stay identical", () => {
  test("takeBack leaves a thread that the agent moved to alone", () => {
    expect(guideTurns()).toContain("if (agent.threadId !== threadId) return;");
    expect(guideTurns()).toContain(
      "if (failure) takeBack(agent, before, threadId);",
    );
  });

  test("agentTurns.ts: the guide and the components overview", () => {
    expect(
      normalize(block(COMPONENTS_INDEX, "src/agentTurns.ts", "runTurn")),
    ).toBe(normalize(guideTurns()));
  });

  test("ChatScreen.tsx: the guide and the components overview", () => {
    // The only marked difference: the guide highlights the
    // GenerativeUIActivity line, which normalize() drops.
    expect(
      normalize(block(COMPONENTS_INDEX, "src/ChatScreen.tsx", "runTurn")),
    ).toBe(normalize(block(GUIDE, "src/ChatScreen.tsx", "runTurn")));
  });

  test("the generative UI Home example: README and USAGE", () => {
    expect(normalize(block(USAGE, null, "GenerativeUIProvider"))).toBe(
      normalize(readmeHome()),
    );
  });

  test("README's RUN_FAILURES, runTurn, takeBack and isChatSurface are the guide's", () => {
    // Marked difference: the guide exports the helpers from its module,
    // README keeps them local. declaration() drops the `export`, and
    // layoutFree() the line breaks that a shorter signature loses.
    expect(runFailuresOf(readmeHome())).toBe(runFailuresOf(guideTurns()));
    expect(isChatSurfaceOf(readmeHome())).toBe(isChatSurfaceOf(guideTurns()));
    expect(layoutFree(runTurnOf(readmeHome()))).toBe(
      layoutFree(runTurnOf(guideTurns())),
    );
    expect(takeBackOf(readmeHome())).toBe(takeBackOf(guideTurns()));
  });

  test("the screens with no chat filter with isChatSurface", () => {
    // A bare isGenerativeUIActivity filter keeps named-target and deleted
    // surfaces, which render nothing, so the screen goes blank.
    const fragments = [
      block(GUIDE, "src/HomeScreen.tsx", "runTurn"),
      readmeHome(),
      block(SURFACES, "src/HomeSurfaces.tsx", "GenerativeUIActivity"),
      block(
        `${REFERENCE}/components/GenerativeUIActivity.mdx`,
        null,
        "HomeSkeleton",
      ),
    ];
    for (const code of fragments) {
      expect(code).toContain(".filter(isChatSurface)");
      expect(code).not.toContain(".filter(isGenerativeUIActivity)");
    }
  });
});

const CORE = "packages/core/src/core/core.ts";

function enumMembers(source: string, name: string): Set<string> {
  const start = source.indexOf(`export enum ${name} {`);
  expect(start, `enum ${name}`).toBeGreaterThanOrEqual(0);
  const body = source.slice(start, source.indexOf("\n}", start));
  return new Set(
    [...body.matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*=/gm)].map((match) => match[1]),
  );
}

function referencedCodes(code: string): string[] {
  return [...code.matchAll(/CopilotKitCoreErrorCode\.([A-Z0-9_]+)/g)].map(
    (match) => match[1],
  );
}

/** `[major, minor]` of the lower bound of `^X.Y`, `^X.Y.Z` or `>=X.Y(.Z)`. */
function lowerBound(range: string): [number, number] {
  const match = /^(\^|>=)(\d+)\.(\d+)(?:\.\d+)?$/.exec(range.trim());
  if (!match) throw new Error(`Unsupported range: ${range}`);
  return [Number(match[2]), Number(match[3])];
}

function manifest(file: string): Record<string, Record<string, string>> {
  return JSON.parse(read(file)) as Record<string, Record<string, string>>;
}

/** Names of the top-level and nested `<PropertyReference name>` tags. */
function documentedProps(file: string): {
  top: string[];
  nested: Map<string, string[]>;
} {
  const top: string[] = [];
  const nested = new Map<string, string[]>();
  const stack: string[] = [];
  const tag = /<PropertyReference\s+name="([^"]+)"|<\/PropertyReference>/g;
  for (const match of read(file).matchAll(tag)) {
    if (match[1] === undefined) {
      stack.pop();
      continue;
    }
    const parent = stack.at(-1);
    if (parent === undefined) top.push(match[1]);
    else nested.set(parent, [...(nested.get(parent) ?? []), match[1]]);
    stack.push(match[1]);
  }
  return { top, nested };
}

/**
 * The property names declared in a type or interface of a source file, from
 * its declaration to the next top-level `export`. Comments are dropped first.
 */
function declaredProps(file: string, declarationStart: string): Set<string> {
  const source = read(file);
  const start = source.indexOf(declarationStart);
  expect(start, `${file}: ${declarationStart}`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nexport ", start + declarationStart.length);
  const text = source
    .slice(start, next === -1 ? undefined : next)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return new Set(
    [...text.matchAll(/^\s+(?:readonly\s+)?([A-Za-z_]\w*)\??:/gm)].map(
      (match) => match[1],
    ),
  );
}

const RN_GENUI = "packages/react-native/src/generative-ui";

describe("(b) claims pinned to the code", () => {
  test("runTurn counts only codes of core's enum that end a run", () => {
    const members = enumMembers(read(CORE), "CopilotKitCoreErrorCode");
    for (const code of [guideTurns(), readmeHome()]) {
      const counted = referencedCodes(runFailuresOf(code));
      expect(counted.length).toBeGreaterThan(0);
      for (const name of counted) expect(members).toContain(name);
      // All four codes that the run handler reports for a run that ends:
      // runAgent's own catch (AGENT_RUN_FAILED), a RUN_ERROR event, a failed
      // run event and a locked thread. Dropping one lets that failure pass
      // as a run that rendered nothing.
      expect(new Set(counted)).toEqual(
        new Set([
          "AGENT_RUN_FAILED",
          "AGENT_RUN_FAILED_EVENT",
          "AGENT_RUN_ERROR_EVENT",
          "AGENT_THREAD_LOCKED",
        ]),
      );
      // These are reported while the run goes on: never a failed run.
      for (const name of counted) {
        expect(name).not.toMatch(/^TOOL_|^SUBSCRIBER_CALLBACK_FAILED$/);
      }
      expect(code).toMatch(
        /context\.agentId === agent\.agentId && RUN_FAILURES\.has\(code\)/,
      );
    }
    const runHandler = read("packages/core/src/core/run-handler.ts");
    expect(runHandler).toContain(
      "code: CopilotKitCoreErrorCode.AGENT_RUN_FAILED,",
    );
    for (const name of [
      "AGENT_RUN_FAILED_EVENT",
      "AGENT_RUN_ERROR_EVENT",
      "AGENT_THREAD_LOCKED",
    ]) {
      expect(runHandler).toContain(`CopilotKitCoreErrorCode.${name}`);
    }
  });

  test("runTurn never rejects, and takes back messages but not surfaces", () => {
    const turn = runTurnOf(guideTurns());
    // Every step that can throw is inside a try, so runTurn resolves.
    const caught = turn.indexOf("} catch (error) {");
    expect(caught).toBeGreaterThan(turn.indexOf("await copilotkit.runAgent"));
    expect(turn.lastIndexOf("} catch (error) {")).toBeGreaterThan(
      turn.indexOf("takeBack(agent, before)"),
    );
    // Date.now() alone repeats within a millisecond.
    expect(turn).toContain("id: `user-${Date.now()}-${sent}`");
    // The provider keeps every surface and the model still sees it, so
    // removing its activity message would only hide it.
    expect(takeBackOf(guideTurns())).toContain(
      "kept.has(message.id) || isGenerativeUIActivity(message)",
    );
  });

  test("the screens ignore a second tap before the next render", () => {
    for (const file of [GUIDE, COMPONENTS_INDEX]) {
      expect(block(file, "src/ChatScreen.tsx", "runTurn")).toMatch(
        /if \(!content \|\| !canSend \|\| sending\.current\) return;\n\s+sending\.current = true;/,
      );
    }
    for (const code of [
      block(GUIDE, "src/HomeScreen.tsx", "runTurn"),
      readmeHome(),
    ]) {
      expect(code).toMatch(
        /if \(composing\.current \|\| !isReady\) return;\n\s+composing\.current = true;/,
      );
      expect(code).toMatch(/finally \{\n\s+composing\.current = false;/);
    }
  });

  test("the home screens check their own run and do not run again on remount", () => {
    for (const code of [
      block(GUIDE, "src/HomeScreen.tsx", "runTurn"),
      readmeHome(),
    ]) {
      // A run that rendered or updated a chat surface; one of an earlier run
      // that this run left alone does not count, nor does a call that only
      // changed the rejected list, nor a surface whose createSurface the app
      // rejected.
      expect(code).toContain("shownBefore.get(id) !== content");
      expect(code).toContain(
        "built.set(message.id, JSON.stringify(operations));",
      );
      expect(code).toContain(
        "!!runtime?.manager.getFailedSurface(agent.threadId, surfaceId),",
      );
      expect(code).toContain(
        "if (chatSurfaces(agent.messages, failed).size === 0) {",
      );
      // Checked once per thread, and only once the agent is not running and
      // no compose is under way, so a thread that the agent moves to during
      // a run or a compose is composed too; `busy` reruns the check.
      expect(code).toMatch(
        /if \(\s*!isReady \|\|\s*busy \|\|\s*composing\.current \|\|\s*agent\.isRunning \|\|\s*checkedThread\.current === agent\.threadId\s*\) \{\s*return;\s*\}\s*checkedThread\.current = agent\.threadId;/,
      );
      expect(code).toMatch(
        /\[\s*isReady,\s*busy,\s*agent,\s*agent\.threadId,\s*agent\.isRunning,\s*compose,\s*failed,?\s*\]/,
      );
      // A failed or empty turn is taken back only on the thread it ran on,
      // and the spinner shows until the registered agent is ready.
      expect(code).toContain("takeBack(agent, before, threadId);");
      expect(code).toContain(
        "const waiting = !isReady || !checked || busy || agent.isRunning;",
      );
      // Never a blank screen: a spinner, the unreachable runtime, or a retry.
      expect(code).toContain("<ActivityIndicator />");
      expect(code).toContain("CopilotKitCoreRuntimeConnectionStatus.Error");
      expect(code).toContain("onPress={() => void compose()}");
    }
  });

  test("the React Native install lines pull a zod that every package accepts", () => {
    const [peerMajor, peerMinor] = lowerBound(
      manifest("packages/react-core/package.json").peerDependencies.zod,
    );
    // child() and childList() are built with shared's own zod, so a catalog
    // that holds them must use the same major.
    const [sharedMajor] = lowerBound(
      manifest("packages/shared/package.json").dependencies.zod,
    );
    const files = [
      GUIDE,
      COMPONENTS_INDEX,
      `${REFERENCE}/index.mdx`,
      README,
      USAGE,
    ];
    const install =
      /\b(npm (install|i)|pnpm (add|install|i)|yarn add|bun (add|install|i)|npx expo install)\b[^`]*\bzod\b/;
    let installs = 0;
    for (const file of files) {
      for (const line of read(file).split("\n")) {
        if (!install.test(line)) continue;
        installs += 1;
        // An unquoted spec ends at a space, a quote or the backtick that
        // closes inline code.
        const spec = /"zod@([^"]+)"|'zod@([^']+)'|\bzod@([^\s"'`]+)/.exec(line);
        expect(spec, `${file}: unpinned zod in: ${line.trim()}`).not.toBeNull();
        const range = spec?.[1] ?? spec?.[2] ?? spec?.[3] ?? "";
        expect(range.startsWith("^"), `${file}: ${range}`).toBe(true);
        const [major, minor] = lowerBound(range);
        expect(major).toBe(sharedMajor);
        expect(
          major === peerMajor ? minor >= peerMinor : major > peerMajor,
        ).toBe(true);
      }
    }
    expect(installs).toBeGreaterThanOrEqual(9);
  });

  test("GenerativeUISurface reference documents exactly its props", () => {
    const documented = documentedProps(
      `${REFERENCE}/components/GenerativeUISurface.mdx`,
    ).top;
    const declared = declaredProps(
      `${RN_GENUI}/GenerativeUISurface.tsx`,
      "export type GenerativeUISurfaceProps",
    );
    expect(new Set(documented)).toEqual(declared);
  });

  test("GenerativeUIActivity reference documents exactly its props and Wrapper props", () => {
    const { top, nested } = documentedProps(
      `${REFERENCE}/components/GenerativeUIActivity.mdx`,
    );
    const file = `${RN_GENUI}/GenerativeUIActivity.tsx`;
    expect(new Set(top)).toEqual(
      declaredProps(file, "export interface GenerativeUIActivityProps"),
    );
    expect(new Set(nested.get("Wrapper"))).toEqual(
      declaredProps(file, "export interface GenerativeUIActivityWrapperProps"),
    );
  });

  test("GenerativeUIProvider reference names only props of its type", () => {
    const declared = new Set([
      ...declaredProps(
        `${RN_GENUI}/GenerativeUIProvider.tsx`,
        "export type GenerativeUIProviderProps",
      ),
      ...declaredProps(
        "packages/react-core/src/v2/generative-ui/runtime-context.ts",
        "interface GenerativeUIBaseConfig",
      ),
      ...declaredProps(
        "packages/react-core/src/v2/generative-ui/runtime-context.ts",
        "export interface GenerativeUIToolConfig",
      ),
    ]);
    const { top, nested } = documentedProps(
      `${REFERENCE}/components/GenerativeUIProvider.mdx`,
    );
    for (const name of top) expect(declared).toContain(name);
    const boundary = declaredProps(
      "packages/react-core/src/v2/generative-ui/runtime-context.ts",
      "export interface GenerativeUIErrorBoundaryConfig",
    );
    for (const name of nested.get("errorBoundary") ?? []) {
      expect(boundary).toContain(name);
    }
  });

  test("CopilotKitProvider reference and the guide's table name only its props", () => {
    const declared = declaredProps(
      "packages/react-native/src/CopilotKitProvider.tsx",
      "export interface CopilotKitNativeProviderProps",
    );
    const { top } = documentedProps(
      `${REFERENCE}/components/CopilotKitProvider.mdx`,
    );
    for (const name of top) expect(declared).toContain(name);

    const guide = read(GUIDE);
    const section = guide.slice(
      guide.indexOf("## Provider options"),
      guide.indexOf("```", guide.indexOf("## Provider options")),
    );
    const rows = [...section.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
    expect(rows).toContain("messageFilter");
    for (const name of rows) expect(declared).toContain(name);
  });
});
