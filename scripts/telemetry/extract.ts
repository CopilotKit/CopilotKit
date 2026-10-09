// Pure extraction for CopilotKit telemetry-registry fragments.
//
// Two surfaces, two mechanisms (see docs/telemetry-registry-publish-roadmap.md
// in oss-path-to-production):
//   - runtime → typed catalog. Event names + property names live in the
//     `AnalyticsEvents` type map (packages/shared/.../events.ts, duplicated in
//     the v2 runtime). `readRuntimeCatalog` reads that type; call sites come
//     from a name-based scan (the emit sites pass non-literal props, so their
//     inline keys are NOT authoritative — the catalog is).
//   - docs (showcase/shell-docs) → inline `posthog.capture("name", { ... })`.
//     `extractCallees` collects the event name + inline object keys, same
//     best-effort static rules as the shared registry extractor. The name may
//     be a string literal or a `const` in the same file set (see
//     `collectEventConstants`).
//
// Both outputs are deterministic (sorted, deduped) so the fragment is byte
// stable and the CI content-gate can compare event sets reliably.
import ts from "typescript";

export interface FragmentEvent {
  event: string;
  call_sites: string[];
  properties_seen: string[];
}

// ---------------------------------------------------------------------------
// Callee-mode extraction (docs) — ported from the registry's extract.ts.
// Deliberate limits: string-literal names only; inline object-literal keys of
// arg[1] only (no spreads/computed/variables); matches `foo` and `obj.method`.
// ---------------------------------------------------------------------------

function calleeNames(expr: ts.CallExpression): string[] {
  const c = expr.expression;
  if (ts.isIdentifier(c)) return [c.text];
  if (ts.isPropertyAccessExpression(c)) {
    const method = c.name.text;
    if (ts.isIdentifier(c.expression))
      return [`${c.expression.text}.${method}`, method];
    return [method];
  }
  return [];
}

function objectKeys(node: ts.Node | undefined): string[] {
  if (!node || !ts.isObjectLiteralExpression(node)) return [];
  const keys: string[] = [];
  for (const prop of node.properties) {
    if (
      (ts.isPropertyAssignment(prop) ||
        ts.isShorthandPropertyAssignment(prop)) &&
      prop.name
    ) {
      if (ts.isIdentifier(prop.name)) keys.push(prop.name.text);
      else if (ts.isStringLiteralLike(prop.name)) keys.push(prop.name.text);
    }
  }
  return keys;
}

function parse(path: string, content: string): ts.SourceFile {
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  // createSourceFile is error-recovering: a syntax error yields a partial AST
  // and silently fewer events. Fail loud.
  const diagnostics = (sf as { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) {
    const first = ts.flattenDiagnosticMessageText(
      diagnostics[0].messageText,
      "\n",
    );
    throw new Error(`Parse error in ${path}: ${first}`);
  }
  return sf;
}

// ---------------------------------------------------------------------------
// Event-name constants.
//
// Emit sites do not always pass a string. The docs setup wizard calls
// `capture(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied, { ... })`, and a
// string-literal-only reader skipped it entirely: the call site was missing
// from the published fragment, and from the pin meant to guard it (PE-218).
//
// Resolution is deliberately shallow. It reads `const` declarations in the
// files it was handed -- the docs emitter walks all of `showcase/shell-docs/src`,
// so the declaring module is already in the set -- and only where the value is
// a string literal. No imports are followed and no expressions are evaluated.
// ---------------------------------------------------------------------------

/** Unwraps `{ ... } as const` to the expression it asserts. */
function withoutAssertion(node: ts.Expression): ts.Expression {
  return ts.isAsExpression(node) ? withoutAssertion(node.expression) : node;
}

/**
 * Maps `NAME` and `NAME.key` to the string literal each one names.
 *
 * A name two files define differently is dropped rather than guessed at: the
 * point of this reader is to say what the code emits, and a wrong event name is
 * worse in a published registry than a missing one.
 *
 * @param files - The same files the caller is extracting from.
 * @returns Every unambiguous constant, by reference text.
 */
function collectEventConstants(
  files: Array<{ path: string; content: string }>,
): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  const ambiguous = new Set<string>();

  const record = (key: string, value: string): void => {
    const existing = found.get(key);
    if (existing !== undefined && existing !== value) {
      ambiguous.add(key);
      return;
    }
    found.set(key, value);
  };

  for (const file of files) {
    const sf = parse(file.path, file.content);
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const name = node.name.text;
        const initializer = withoutAssertion(node.initializer);
        if (ts.isStringLiteralLike(initializer)) {
          record(name, initializer.text);
        } else if (ts.isObjectLiteralExpression(initializer)) {
          for (const prop of initializer.properties) {
            if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
            const key = ts.isIdentifier(prop.name)
              ? prop.name.text
              : ts.isStringLiteralLike(prop.name)
                ? prop.name.text
                : undefined;
            const value = withoutAssertion(prop.initializer);
            if (key !== undefined && ts.isStringLiteralLike(value)) {
              record(`${name}.${key}`, value.text);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  for (const key of ambiguous) found.delete(key);
  return found;
}

/** Reads the event name from `arg[0]`, resolving a constant reference. */
function eventNameOf(
  node: ts.Expression | undefined,
  constants: ReadonlyMap<string, string>,
): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isIdentifier(node)) return constants.get(node.text);
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    return constants.get(`${node.expression.text}.${node.name.text}`);
  }
  return undefined;
}

export function extractCallees(
  files: Array<{ path: string; content: string }>,
  config: { calleeNames: string[]; callSites?: "file" | "line" },
): FragmentEvent[] {
  const callSites = config.callSites ?? "file";
  const wanted = new Set(config.calleeNames);
  const constants = collectEventConstants(files);
  const byEvent = new Map<string, { props: Set<string>; sites: string[] }>();

  for (const file of files) {
    const sf = parse(file.path, file.content);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const names = calleeNames(node);
        const event = names.some((n) => wanted.has(n))
          ? eventNameOf(node.arguments[0], constants)
          : undefined;
        if (event !== undefined) {
          const entry = byEvent.get(event) ?? {
            props: new Set<string>(),
            sites: [],
          };
          for (const k of objectKeys(node.arguments[1])) entry.props.add(k);
          if (callSites === "file") entry.sites.push(file.path);
          else
            entry.sites.push(
              `${file.path}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`,
            );
          byEvent.set(event, entry);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return finalize(byEvent);
}

function finalize(
  byEvent: Map<string, { props: Set<string>; sites: string[] }>,
): FragmentEvent[] {
  return [...byEvent.entries()]
    .map(([event, { props, sites }]) => ({
      event,
      call_sites: [...new Set(sites)].sort(),
      properties_seen: [...props].sort(),
    }))
    .sort((a, b) => a.event.localeCompare(b.event));
}

// ---------------------------------------------------------------------------
// Catalog-mode extraction (runtime) — read the `AnalyticsEvents` type map.
// ---------------------------------------------------------------------------

// Collect property-signature names (Identifier or string-literal keys, incl.
// optional) from a type-literal or an interface body.
function propNames(members: ts.NodeArray<ts.TypeElement>): string[] {
  const out: string[] = [];
  for (const m of members) {
    if (ts.isPropertySignature(m) && m.name) {
      if (ts.isIdentifier(m.name)) out.push(m.name.text);
      else if (ts.isStringLiteralLike(m.name)) out.push(m.name.text);
    }
  }
  return out;
}

// Parse one events.ts into { eventName -> sorted property names }. Resolves an
// event's value type whether it is an inline type-literal or a reference to a
// local interface (RuntimeInstanceCreatedInfo / AgentExecutionResponseInfo).
export function readCatalogFile(
  path: string,
  content: string,
): Map<string, string[]> {
  const sf = parse(path, content);
  const interfaces = new Map<string, string[]>();
  let analytics: ts.TypeLiteralNode | undefined;

  const collect = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node))
      interfaces.set(node.name.text, propNames(node.members));
    if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text === "AnalyticsEvents" &&
      ts.isTypeLiteralNode(node.type)
    ) {
      analytics = node.type;
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  if (!analytics)
    throw new Error(`AnalyticsEvents type map not found in ${path}`);

  const out = new Map<string, string[]>();
  for (const m of analytics.members) {
    if (!ts.isPropertySignature(m) || !m.name || !m.type) continue;
    if (!ts.isStringLiteralLike(m.name)) {
      throw new Error(
        `Non-string-literal event key in AnalyticsEvents (${path}): ${m.name.getText(sf)}`,
      );
    }
    const event = m.name.text;
    let props: string[];
    if (ts.isTypeLiteralNode(m.type)) {
      props = propNames(m.type.members);
    } else if (
      ts.isTypeReferenceNode(m.type) &&
      ts.isIdentifier(m.type.typeName)
    ) {
      const ref = interfaces.get(m.type.typeName.text);
      if (!ref)
        throw new Error(
          `Event ${event} references unknown type ${m.type.typeName.text} in ${path}`,
        );
      props = ref;
    } else {
      throw new Error(
        `Event ${event} has an unsupported value type in ${path}: ${m.type.getText(sf)}`,
      );
    }
    out.set(event, [...new Set(props)].sort());
  }
  return out;
}

// Read both the v1 and v2 catalogs and fail loud if they diverge — the two are
// duplicated byte-for-byte today, and silent drift between them is exactly the
// risk this emitter exists to catch.
function serializeCatalog(m: Map<string, string[]>): string {
  return JSON.stringify(
    [...m.entries()].sort((x, y) => x[0].localeCompare(y[0])),
  );
}

export function readRuntimeCatalog(
  v1: { path: string; content: string },
  v2: { path: string; content: string },
): Map<string, string[]> {
  const a = readCatalogFile(v1.path, v1.content);
  const b = readCatalogFile(v2.path, v2.content);
  if (serializeCatalog(a) !== serializeCatalog(b)) {
    throw new Error(
      `Runtime v1 and v2 telemetry catalogs diverge.\n  v1 (${v1.path}): ${serializeCatalog(a)}\n  v2 (${v2.path}): ${serializeCatalog(b)}`,
    );
  }
  return a;
}

// Combine catalog properties (authoritative) with call sites discovered by a
// name-based scan of the emit sites. Only events present in the catalog are
// emitted; call sites are matched by event name.
export function buildRuntimeEvents(
  catalog: Map<string, string[]>,
  callSiteFiles: Array<{ path: string; content: string }>,
): FragmentEvent[] {
  const scanned = extractCallees(callSiteFiles, {
    calleeNames: ["capture"],
    callSites: "file",
  });
  const sitesByEvent = new Map(scanned.map((e) => [e.event, e.call_sites]));
  const events: FragmentEvent[] = [];
  for (const [event, properties_seen] of catalog) {
    events.push({
      event,
      call_sites: sitesByEvent.get(event) ?? [],
      properties_seen,
    });
  }
  return events.sort((a, b) => a.event.localeCompare(b.event));
}
