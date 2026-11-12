// Pure extraction for CopilotKit telemetry-registry fragments.
//
// Two surfaces, two mechanisms (see docs/telemetry-registry-publish-roadmap.md
// in oss-path-to-production):
//   - runtime → typed catalog. Event names + property names live in the
//     `AnalyticsEvents` type map (packages/shared/.../events.ts, duplicated in
//     the v2 runtime). `readRuntimeCatalog` reads that type; call sites come
//     from a name-based scan (the emit sites pass non-literal props, so their
//     inline keys are NOT authoritative — the catalog is).
//   - docs (showcase/shell-docs) → its emit calls: `posthog.capture(...)` and
//     the app's `trackEvent(...)` wrapper (see `DOCS_CALLEE_NAMES`).
//     `extractCallees` collects the event name + the payload's object keys,
//     same best-effort static rules as the shared registry extractor, plus
//     the few indirections the docs app uses (see `findEmitCalls`).
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
// Matches `foo` and `obj.method`. arg[0] is the event name, arg[1] the
// payload. Deliberately static and shallow; see `findEmitCalls` for exactly
// what is followed.
// ---------------------------------------------------------------------------

/**
 * The docs site's emit calls: posthog-js / posthog-node `capture`, and
 * `trackEvent`, the wrapper every client control in showcase/shell-docs calls
 * (`src/lib/telemetry/analytics.ts`).
 */
export const DOCS_CALLEE_NAMES = ["posthog.capture", "capture", "trackEvent"];

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

interface ParsedFile {
  path: string;
  sf: ts.SourceFile;
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
  files: ParsedFile[],
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

  for (const { sf } of files) {
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

// ---------------------------------------------------------------------------
// Following a name or a payload back to where it is written.
//
// The docs app rarely writes an event at its emit call. `trackEvent` takes a
// constant (`INTELLIGENCE_ONBOARDING_EVENTS.promptCopied`), a local
// (`{ ...properties, action }`), or a prop of the component around it
// (`<TrackedLink event="docs.journey_continued" properties={{ ... }}>`,
// `copiedEvent = INTELLIGENCE_ONBOARDING_EVENTS.promptCopied`). These rules
// follow exactly those, and nothing else:
//
//   - a string literal, or a `const` from `collectEventConstants`;
//   - an identifier, to the nearest enclosing `const`/`let`/`var` statement or
//     function parameter that declares it (no imports, no type checker);
//   - a destructured prop of a named function component, to its default and
//     to the value every `<Component prop=...>` in the file set passes;
//   - in a payload, object-literal keys, `...spreads` of anything above, and
//     both branches of a `cond ? { ... } : { ... }`.
//
// A template-literal name (`docs.homepage_${action}`), a function's return
// value and a plain (non-destructured) parameter are not followed. Properties
// that reach a component through a prop are the union over its usages.
// ---------------------------------------------------------------------------

type Binding =
  | ts.VariableDeclaration
  | ts.ParameterDeclaration
  | ts.BindingElement;

/** JSX attributes by element name, across the files being extracted. */
type JsxUsages = ReadonlyMap<
  string,
  Array<{ file: ParsedFile; attributes: ts.JsxAttributes }>
>;

interface Resolver {
  constants: ReadonlyMap<string, string>;
  jsx: JsxUsages;
}

/** A resolved event name and the node that spells it. */
interface NamedEvent {
  event: string;
  file: ParsedFile;
  node: ts.Node;
}

function indexJsxUsages(files: ParsedFile[]): JsxUsages {
  const usages = new Map<
    string,
    Array<{ file: ParsedFile; attributes: ts.JsxAttributes }>
  >();
  for (const file of files) {
    const visit = (node: ts.Node): void => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        ts.isIdentifier(node.tagName)
      ) {
        const list = usages.get(node.tagName.text) ?? [];
        list.push({ file, attributes: node.attributes });
        usages.set(node.tagName.text, list);
      }
      ts.forEachChild(node, visit);
    };
    visit(file.sf);
  }
  return usages;
}

function unwrap(node: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return unwrap(node.expression);
  }
  return node;
}

function bindingIn(
  owner: ts.VariableDeclaration | ts.ParameterDeclaration,
  name: ts.BindingName,
  text: string,
): Binding | undefined {
  if (ts.isIdentifier(name)) return name.text === text ? owner : undefined;
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    if (ts.isIdentifier(element.name)) {
      if (element.name.text === text) return element;
    } else {
      const nested = bindingIn(owner, element.name, text);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** The innermost declaration of `id` in an enclosing block or function. */
function lookup(id: ts.Identifier): Binding | undefined {
  for (let scope = id.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      for (const param of scope.parameters) {
        const found = bindingIn(param, param.name, id.text);
        if (found) return found;
      }
    }
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          const found = bindingIn(declaration, declaration.name, id.text);
          if (found) return found;
        }
      }
    }
  }
  return undefined;
}

function functionName(fn: ts.SignatureDeclaration): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name)
    return fn.name.text;
  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    ts.isVariableDeclaration(fn.parent) &&
    ts.isIdentifier(fn.parent.name)
  ) {
    return fn.parent.name.text;
  }
  return undefined;
}

/** `{ prop }` in a named function's first parameter: `<Component prop=...>`. */
function componentProp(
  binding: ts.BindingElement,
): { component: string; prop: string } | undefined {
  const pattern = binding.parent;
  const param = pattern.parent;
  if (!ts.isObjectBindingPattern(pattern) || !ts.isParameter(param)) return;
  const fn = param.parent;
  if (!ts.isFunctionLike(fn) || fn.parameters[0] !== param) return;
  const component = functionName(fn);
  const key = binding.propertyName ?? binding.name;
  const prop =
    ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : undefined;
  return component && prop ? { component, prop } : undefined;
}

/** What every `<component prop=...>` in the file set passes. */
function propValues(
  r: Resolver,
  component: string,
  prop: string,
): Array<{ file: ParsedFile; value: ts.Expression }> {
  const values: Array<{ file: ParsedFile; value: ts.Expression }> = [];
  for (const { file, attributes } of r.jsx.get(component) ?? []) {
    for (const attr of attributes.properties) {
      if (
        !ts.isJsxAttribute(attr) ||
        !ts.isIdentifier(attr.name) ||
        attr.name.text !== prop ||
        !attr.initializer
      ) {
        continue;
      }
      if (ts.isStringLiteral(attr.initializer)) {
        values.push({ file, value: attr.initializer });
      } else if (
        ts.isJsxExpression(attr.initializer) &&
        attr.initializer.expression
      ) {
        values.push({ file, value: attr.initializer.expression });
      }
    }
  }
  return values;
}

type Reader<T> = (
  node: ts.Expression,
  file: ParsedFile,
  r: Resolver,
  seen: Set<ts.Node>,
) => T[];

/** Reads every value a declaration can hold: its initializer or default, and a component prop's passed values. */
function bindingValues<T>(
  binding: Binding,
  file: ParsedFile,
  r: Resolver,
  seen: Set<ts.Node>,
  read: Reader<T>,
): T[] {
  if (seen.has(binding)) return [];
  seen.add(binding);
  // A plain parameter's value is its caller's argument, which isn't followed.
  if (ts.isParameter(binding)) return [];
  const values = binding.initializer
    ? read(binding.initializer, file, r, seen)
    : [];
  const target = ts.isBindingElement(binding)
    ? componentProp(binding)
    : undefined;
  if (target) {
    for (const passed of propValues(r, target.component, target.prop)) {
      values.push(...read(passed.value, passed.file, r, seen));
    }
  }
  return values;
}

/** The event names `node` can evaluate to. */
const eventNames: Reader<NamedEvent> = (node, file, r, seen) => {
  const expr = unwrap(node);
  const named = (event: string | undefined): NamedEvent[] =>
    event === undefined ? [] : [{ event, file, node: expr }];
  if (ts.isStringLiteralLike(expr)) return named(expr.text);
  if (ts.isIdentifier(expr)) {
    const binding = lookup(expr);
    return binding
      ? bindingValues(binding, file, r, seen, eventNames)
      : named(r.constants.get(expr.text));
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return named(r.constants.get(`${expr.expression.text}.${expr.name.text}`));
  }
  return [];
};

/** The property keys a payload expression can carry. */
const propertyKeys: Reader<string> = (node, file, r, seen) => {
  const expr = unwrap(node);
  if (ts.isObjectLiteralExpression(expr)) {
    const keys: string[] = [];
    for (const prop of expr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        keys.push(...propertyKeys(prop.expression, file, r, seen));
      } else if (
        (ts.isPropertyAssignment(prop) ||
          ts.isShorthandPropertyAssignment(prop)) &&
        (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name))
      ) {
        keys.push(prop.name.text);
      }
    }
    return keys;
  }
  if (ts.isConditionalExpression(expr)) {
    return [
      ...propertyKeys(expr.whenTrue, file, r, seen),
      ...propertyKeys(expr.whenFalse, file, r, seen),
    ];
  }
  if (ts.isIdentifier(expr)) {
    const binding = lookup(expr);
    return binding ? bindingValues(binding, file, r, seen, propertyKeys) : [];
  }
  return [];
};

/** One emit call: every event name it can send, and the keys it passes. */
export interface EmitCall {
  path: string;
  line: number;
  /** Each name, with where it is spelled (often another file). */
  events: Array<{ event: string; path: string; line: number }>;
  properties: string[];
}

function lineOf(file: ParsedFile, node: ts.Node): number {
  return file.sf.getLineAndCharacterOfPosition(node.getStart(file.sf)).line + 1;
}

/**
 * Finds every call to one of `calleeNames` whose event name resolves, with
 * its payload's keys. See the rules above `Binding` for what is followed.
 */
export function findEmitCalls(
  files: Array<{ path: string; content: string }>,
  names: string[],
): EmitCall[] {
  const wanted = new Set(names);
  const parsed = files.map((f) => ({
    path: f.path,
    sf: parse(f.path, f.content),
  }));
  const r: Resolver = {
    constants: collectEventConstants(parsed),
    jsx: indexJsxUsages(parsed),
  };
  const calls: EmitCall[] = [];
  for (const file of parsed) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.arguments[0] &&
        calleeNames(node).some((n) => wanted.has(n))
      ) {
        const events = eventNames(node.arguments[0], file, r, new Set());
        if (events.length > 0) {
          const payload = node.arguments[1];
          calls.push({
            path: file.path,
            line: lineOf(file, node),
            events: events.map((e) => ({
              event: e.event,
              path: e.file.path,
              line: lineOf(e.file, e.node),
            })),
            properties: payload
              ? [...new Set(propertyKeys(payload, file, r, new Set()))].sort()
              : [],
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file.sf);
  }
  return calls;
}

export function extractCallees(
  files: Array<{ path: string; content: string }>,
  config: { calleeNames: string[]; callSites?: "file" | "line" },
): FragmentEvent[] {
  const site = (path: string, line: number) =>
    config.callSites === "line" ? `${path}:${line}` : path;
  const byEvent = new Map<string, { props: Set<string>; sites: string[] }>();

  for (const call of findEmitCalls(files, config.calleeNames)) {
    for (const named of call.events) {
      const entry = byEvent.get(named.event) ?? {
        props: new Set<string>(),
        sites: [],
      };
      for (const k of call.properties) entry.props.add(k);
      entry.sites.push(site(call.path, call.line));
      // A name passed in from another file (a prop, a default) is emitted
      // from there too, as far as a reader looking for it is concerned.
      if (named.path !== call.path)
        entry.sites.push(site(named.path, named.line));
      byEvent.set(named.event, entry);
    }
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
