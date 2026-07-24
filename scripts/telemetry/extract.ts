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
//     `extractCallees` collects the string-literal name + inline object keys,
//     same best-effort static rules as the shared registry extractor.
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

export function extractCallees(
  files: Array<{ path: string; content: string }>,
  config: { calleeNames: string[]; callSites?: "file" | "line" },
): FragmentEvent[] {
  const callSites = config.callSites ?? "file";
  const wanted = new Set(config.calleeNames);
  const byEvent = new Map<string, { props: Set<string>; sites: string[] }>();

  for (const file of files) {
    const sf = parse(file.path, file.content);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const names = calleeNames(node);
        const first = node.arguments[0];
        if (
          names.some((n) => wanted.has(n)) &&
          first &&
          ts.isStringLiteralLike(first)
        ) {
          const event = first.text;
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
