import type { Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";

type Node = SgNode<TS | TSX>;
type Adapter = { node: boolean; single: boolean };
const adapters: Record<string, Adapter> = {
  createCopilotExpressHandler: { node: true, single: false },
  createCopilotEndpointExpress: { node: true, single: false },
  createCopilotEndpointSingleRouteExpress: { node: true, single: true },
  createCopilotHonoHandler: { node: false, single: false },
  createCopilotEndpoint: { node: false, single: false },
  createCopilotEndpointSingleRoute: { node: false, single: true },
};
const sources = new Set([
  "@copilotkit/runtime",
  "@copilotkit/runtime/v2",
  "@copilotkit/runtime/express",
  "@copilotkit/runtime/v2/express",
  "@copilotkit/runtime/hono",
  "@copilotkit/runtime/v2/hono",
]);
const same = (a: Node | null | undefined, b: Node) => a?.id() === b.id();
const named = (n: Node) =>
  n.children().filter((c) => c.isNamed() && c.kind() !== "comment");
const args = (n: Node) => {
  const a = n.field("arguments");
  return a ? named(a) : [];
};
const unquote = (n: Node) => n.text().slice(1, -1);
const refs = (root: Node, name: string) =>
  root
    .findAll({
      rule: {
        any: [
          { kind: "identifier" },
          { kind: "shorthand_property_identifier" },
          { kind: "shorthand_property_identifier_pattern" },
          { kind: "type_identifier" },
        ],
      },
    })
    .filter((n) => n.text() === name);
const inImport = (n: Node) =>
  n.ancestors().some((a) => a.kind() === "import_statement");
const span = (start: number, end: number, text: string): Edit => ({
  startPos: start,
  endPos: end,
  insertedText: text,
});

/** Keep original text/comments inside an options object while applying local edits. */
function patch(node: Node, edits: Edit[]): string {
  let text = node.text();
  const offset = node.range().start.index;
  for (const e of [...edits].sort((a, b) => b.startPos - a.startPos)) {
    text =
      text.slice(0, e.startPos - offset) +
      e.insertedText +
      text.slice(e.endPos - offset);
  }
  return text;
}

/** No spreads/computed keys: defaults and Express CORS translation must be provable. */
function options(
  node: Node,
  adapter: Adapter,
): { text: string; basePath: string } | null {
  if (node.kind() !== "object") return null;
  const properties = named(node);
  const edits: Edit[] = [];
  let hasCors = false,
    hasMode = false,
    basePath: string | undefined;
  const keys = new Set<string>();
  for (const prop of properties) {
    if (prop.kind() === "shorthand_property_identifier") {
      if (["cors", "mode", "basePath"].includes(prop.text())) return null;
      continue;
    }
    if (prop.kind() !== "pair") return null;
    const key = prop.field("key"),
      value = prop.field("value");
    if (
      !key ||
      !value ||
      key.kind() !== "property_identifier" ||
      keys.has(key.text())
    )
      return null;
    keys.add(key.text());
    if (key.text() === "basePath") {
      if (value.kind() !== "string" || /\\/.test(value.text())) return null;
      basePath = unquote(value);
      if (
        !/^\/[A-Za-z0-9_./~-]*$/.test(basePath) ||
        (basePath !== "/" && basePath.endsWith("/"))
      )
        return null;
    }
    if (key.text() === "mode") {
      hasMode = true;
      if (adapter.single && unquote(value) !== "single-route") return null;
    }
    if (key.text() !== "cors") continue;
    hasCors = true;
    if (value.text() === "true" || (adapter.node && value.text() === "false"))
      continue;
    if (value.kind() !== "object") return null;
    const corsPairs = named(value);
    const corsKeys = corsPairs.map((p) => p.field("key")?.text());
    if (new Set(corsKeys).size !== corsKeys.length) return null;
    const corsValue = (name: string) =>
      corsPairs.find((p) => p.field("key")?.text() === name)?.field("value");
    if (adapter.node) {
      // Express cors(options) reflects request headers if allowedHeaders is
      // omitted; Fetch's default wildcard cannot preserve that behavior.
      if (!corsValue("allowedHeaders")) return null;
      const origin = corsValue("origin");
      if (
        corsValue("credentials")?.text() === "true" &&
        (!origin || origin.text().includes("*"))
      )
        return null;
      if (!corsValue("methods"))
        edits.push(
          span(
            value.range().start.index + 1,
            value.range().start.index + 1,
            ' allowMethods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],',
          ),
        );
    }
    for (const item of corsPairs) {
      if (item.kind() !== "pair") return null;
      const ck = item.field("key"),
        cv = item.field("value");
      if (!ck || !cv || ck.kind() !== "property_identifier") return null;
      const rename: Record<string, string> = adapter.node
        ? {
            origin: "origin",
            credentials: "credentials",
            methods: "allowMethods",
            allowedHeaders: "allowHeaders",
            exposedHeaders: "exposeHeaders",
            maxAge: "maxAge",
          }
        : { origin: "origin", credentials: "credentials" };
      if (!Object.hasOwn(rename, ck.text())) return null;
      // In particular, origin callbacks, regexes, and `origin: true` differ across frameworks.
      if (
        ck.text() === "origin" &&
        cv.kind() !== "string" &&
        cv.kind() !== "array"
      )
        return null;
      // Inspect literal values only. Escaped source text is not a decoded
      // origin/header list (for example an escaped wildcard with credentials).
      if (cv.kind() === "string" && /\\/.test(cv.text())) return null;
      if (
        cv.kind() === "array" &&
        named(cv).some((v) => v.kind() !== "string" || /\\/.test(v.text()))
      )
        return null;
      if (!["string", "array", "true", "false", "number"].includes(cv.kind()))
        return null;
      if (rename[ck.text()] !== ck.text())
        edits.push(ck.replace(rename[ck.text()]!));
      // Express accepts comma-separated lists; the Fetch config takes arrays.
      if (
        ["methods", "allowedHeaders", "exposedHeaders"].includes(ck.text()) &&
        cv.kind() === "string"
      ) {
        edits.push(
          cv.replace(
            JSON.stringify(
              unquote(cv)
                .split(",")
                .map((s) => s.trim()),
            ),
          ),
        );
      }
    }
  }
  if (basePath === undefined) return null;
  const defaults = [
    !hasCors ? "cors: true" : "",
    adapter.single && !hasMode ? 'mode: "single-route"' : "",
  ].filter(Boolean);
  if (defaults.length)
    edits.push(
      span(
        node.range().start.index + 1,
        node.range().start.index + 1,
        ` ${defaults.join(", ")},`,
      ),
    );
  return { text: patch(node, edits), basePath };
}

/** Resolve a host created in this file, rejecting ambiguous/shadowed names. */
function isHost(
  root: Node,
  object: Node | null | undefined,
  framework: "express" | "hono",
): string | null {
  if (!object || object.kind() !== "identifier") return null;
  const declarations = root
    .findAll({ rule: { kind: "variable_declarator" } })
    .filter((n) => n.field("name")?.text() === object.text());
  if (
    declarations.length !== 1 ||
    !declarations[0]!.parent()?.text().startsWith("const ")
  )
    return null;
  if (
    refs(root, object.text()).some((n) =>
      n
        .ancestors()
        .some((a) =>
          [
            "formal_parameters",
            "catch_clause",
            "object_pattern",
            "array_pattern",
          ].includes(a.kind()),
        ),
    )
  )
    return null;
  const value = declarations[0]!.field("value");
  if (
    !value ||
    (framework === "express"
      ? value.kind() !== "call_expression"
      : value.kind() !== "new_expression")
  )
    return null;
  const factory = value.field(
    framework === "express" ? "function" : "constructor",
  );
  if (!factory || factory.kind() !== "identifier") return null;
  if (
    refs(root, factory.text()).some(
      (n) =>
        same(n.parent()?.field("name"), n) &&
        [
          "variable_declarator",
          "function_declaration",
          "class_declaration",
        ].includes(n.parent()?.kind() ?? ""),
    )
  )
    return null;
  if (
    refs(root, factory.text()).some((n) =>
      n
        .ancestors()
        .some((a) =>
          [
            "formal_parameters",
            "catch_clause",
            "object_pattern",
            "array_pattern",
          ].includes(a.kind()),
        ),
    )
  )
    return null;
  for (const imp of root.findAll({ rule: { kind: "import_statement" } })) {
    if (imp.field("source")?.text().slice(1, -1) !== framework) continue;
    if (framework === "express") {
      const clause = imp.find({ rule: { kind: "import_clause" } });
      if (
        clause &&
        named(clause).some(
          (n) => n.kind() === "identifier" && n.text() === factory.text(),
        )
      )
        return factory.text();
    } else {
      if (
        imp
          .findAll({ rule: { kind: "import_specifier" } })
          .some(
            (n) =>
              n.field("name")?.text() === "Hono" &&
              (n.field("alias")?.text() ?? "Hono") === factory.text(),
          )
      )
        return factory.text();
    }
  }
  return null;
}

/**
 * Migrate only closed, local uses. Every reference must be understood; a shadowed
 * name, exported router, callback, or router configuration keeps the entire
 * factory binding on the original API for the main pass to mark with a TODO.
 */
export function migrateRuntimeAdapters(root: Node): string | null {
  const edits: Edit[] = [];
  const imports = root.findAll({ rule: { kind: "import_statement" } });
  const wrappers = new Map<string, Node>();
  for (const imp of imports) {
    if (imp.field("source")?.text().slice(1, -1) !== "hono/vercel") continue;
    const wrapperClause = imp.find({ rule: { kind: "import_clause" } });
    if (
      !wrapperClause ||
      named(wrapperClause).some((n) => n.kind() !== "named_imports")
    )
      continue;
    for (const spec of imp.findAll({ rule: { kind: "import_specifier" } })) {
      if (spec.field("name")?.text() !== "handle") continue;
      const local = spec.field("alias")?.text() ?? "handle";
      // A definition/shadow/reference other than a direct call is unsafe.
      if (
        refs(root, local)
          .filter((n) => !inImport(n))
          .every(
            (n) =>
              n.parent()?.kind() === "call_expression" &&
              same(n.parent()?.field("function"), n),
          )
      )
        wrappers.set(local, spec);
    }
  }
  const removedWrapperCalls = new Set<number>();
  const reserved = new Set(
    root.findAll({ rule: { kind: "identifier" } }).map((n) => n.text()),
  );
  const fresh = (base: string) => {
    let name = base;
    while (reserved.has(name)) name += "_";
    reserved.add(name);
    return name;
  };
  for (const imp of imports) {
    const source = imp.field("source");
    if (
      !source ||
      !sources.has(unquote(source)) ||
      imp.text().startsWith("import type")
    )
      continue;
    const clause = imp.find({ rule: { kind: "import_clause" } });
    if (!clause || named(clause).some((n) => n.kind() !== "named_imports"))
      continue;
    const specs = imp.findAll({ rule: { kind: "import_specifier" } });
    const replacements = new Map<number, { text: string; source: string }>();
    for (const spec of specs) {
      const name = spec.field("name")?.text() ?? "";
      const adapter = Object.hasOwn(adapters, name)
        ? adapters[name]
        : undefined;
      if (!adapter || spec.text().startsWith("type ")) continue;
      const local = spec.field("alias")?.text() ?? name;
      const references = refs(root, local).filter((n) => !inImport(n));
      if (!references.length) continue;
      const target = adapter.node
        ? "createCopilotNodeListener"
        : "createCopilotRuntimeHandler";
      const newLocal =
        spec.field("alias") || reserved.has(target) ? local : target;
      const planned: Edit[] = [];
      const wrapperCalls: number[] = [];
      let safe = true;
      for (const ref of references) {
        const call = ref.parent();
        if (
          call?.kind() !== "call_expression" ||
          !same(call.field("function"), ref) ||
          args(call).length !== 1
        ) {
          safe = false;
          break;
        }
        const optionNode = args(call)[0]!;
        const mode = named(optionNode)
          .find((p) => p.field("key")?.text() === "mode")
          ?.field("value");
        if (
          mode &&
          (mode.kind() !== "string" ||
            !["single-route", "multi-route"].includes(unquote(mode)))
        ) {
          safe = false;
          break;
        }
        const callAdapter = {
          ...adapter,
          single:
            adapter.single ||
            (mode != null && unquote(mode) === "single-route"),
        };
        const config = options(optionNode, callAdapter);
        if (!config) {
          safe = false;
          break;
        }
        let uses: Node[];
        const declaration = call.parent();
        if (
          declaration?.kind() === "variable_declarator" &&
          same(declaration.field("value"), call)
        ) {
          const binding = declaration.field("name");
          if (
            !binding ||
            binding.kind() !== "identifier" ||
            declaration.field("type") ||
            !declaration.parent()?.text().startsWith("const ") ||
            declaration.ancestors().some((a) => a.kind() === "export_statement")
          ) {
            safe = false;
            break;
          }
          uses = refs(root, binding.text()).filter((n) => !same(n, binding));
          if (!uses.length) {
            safe = false;
            break;
          }
        } else uses = [call];
        let expressMount: string | undefined;
        let replacedCall = false;
        for (const use of uses) {
          const parent = use.parent();
          if (
            !adapter.node &&
            parent?.kind() === "member_expression" &&
            same(parent.field("object"), use)
          ) {
            const prop = parent.field("property")?.text();
            if (prop === "channels") continue;
            if (prop !== "fetch") {
              safe = false;
              break;
            }
            const invoke = parent.parent();
            const called =
              invoke?.kind() === "call_expression" &&
              same(invoke.field("function"), parent) &&
              args(invoke).length === 1;
            const fetchProperty =
              invoke?.kind() === "pair" &&
              invoke.field("key")?.text() === "fetch" &&
              same(invoke.field("value"), parent);
            if (!called && !fetchProperty) {
              safe = false;
              break;
            }
            planned.push(
              span(use.range().end.index, parent.range().end.index, ""),
            );
            continue;
          }
          if (
            adapter.node &&
            parent?.kind() === "member_expression" &&
            same(parent.field("object"), use) &&
            parent.field("property")?.text() === "channels"
          )
            continue;
          const invoke =
            parent?.kind() === "arguments" ? parent.parent() : null;
          if (invoke?.kind() !== "call_expression") {
            safe = false;
            break;
          }
          const fn = invoke.field("function"),
            arguments_ = args(invoke);
          if (
            !adapter.node &&
            fn?.kind() === "identifier" &&
            wrappers.has(fn.text()) &&
            arguments_.length === 1
          ) {
            planned.push(
              span(invoke.range().start.index, use.range().start.index, ""),
              span(use.range().end.index, invoke.range().end.index, ""),
            );
            wrapperCalls.push(fn.id());
            continue;
          }
          if (
            !adapter.node &&
            fn?.kind() === "member_expression" &&
            fn.field("property")?.text() === "route" &&
            isHost(root, fn.field("object"), "hono") &&
            arguments_.length === 2 &&
            same(arguments_[1], use) &&
            arguments_[0]?.kind() === "string" &&
            ["", "/"].includes(unquote(arguments_[0]))
          ) {
            const paths =
              config.basePath === "/"
                ? '"*"'
                : JSON.stringify(config.basePath + "/*");
            const host = fn.field("object")!.text();
            const context = fresh("copilotContext");
            let handler = use.text();
            if (same(use, call)) {
              const statement = invoke.parent();
              if (
                statement?.kind() !== "expression_statement" ||
                !["program", "statement_block"].includes(
                  statement.parent()?.kind() ?? "",
                )
              ) {
                safe = false;
                break;
              }
              handler = fresh("copilotHandler");
              planned.push(
                span(
                  statement.range().start.index,
                  statement.range().start.index,
                  `const ${handler} = ${newLocal}(${config.text});\n`,
                ),
              );
              replacedCall = true;
            }
            planned.push(
              invoke.replace(
                `${host}.all(${paths}, (${context}) => ${handler}(${context}.req.raw))`,
              ),
            );
            continue;
          }
          if (
            adapter.node &&
            fn?.kind() === "member_expression" &&
            fn.field("property")?.text() === "use" &&
            isHost(root, fn.field("object"), "express") &&
            same(arguments_.at(-1), use) &&
            arguments_.length <= 2
          ) {
            const prefix = arguments_.length === 2 ? arguments_[0] : undefined;
            if (
              prefix &&
              (prefix.kind() !== "string" ||
                !/^\/[A-Za-z0-9_./~-]*$/.test(unquote(prefix)))
            ) {
              safe = false;
              break;
            }
            const statement = invoke.parent();
            if (
              statement?.kind() !== "expression_statement" ||
              !["program", "statement_block"].includes(
                statement.parent()?.kind() ?? "",
              )
            ) {
              safe = false;
              break;
            }
            expressMount = config.basePath;
            // A user-owned router preserves Express's req.url, mount prefixes,
            // exact single-route matching and next() fallthrough. Moving the
            // prefix into app.use would change Request URLs seen by hooks/auth.
            let listener = use.text();
            let setup = "";
            if (same(use, call)) {
              listener = fresh("copilotListener");
              setup += `const ${listener} = ${newLocal}(${config.text});\n`;
              replacedCall = true;
            }
            const router = fresh("copilotRouter");
            const express = isHost(root, fn.field("object"), "express")!;
            setup += `const ${router} = ${express}.Router();\n`;
            if (callAdapter.single) {
              setup += `${router}.post(${JSON.stringify(config.basePath)}, ${listener});\n${router}.options(${JSON.stringify(config.basePath)}, ${listener});\n`;
            } else {
              const pattern =
                config.basePath === "/"
                  ? ".*"
                  : "^" +
                    config.basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                    "(/.*)?$";
              setup += `${router}.all(new RegExp(${JSON.stringify(pattern)}), ${listener});\n`;
            }
            planned.push(
              span(
                statement.range().start.index,
                statement.range().start.index,
                setup,
              ),
            );
            const prefixText = prefix ? prefix.text() + ", " : "";
            planned.push(
              invoke.replace(`${fn.text()}(${prefixText}${router})`),
            );
            continue;
          }
          safe = false;
          break;
        }
        if (!safe) break;
        if (adapter.node) {
          if (expressMount === undefined) {
            safe = false;
            break;
          }
        }
        if (!replacedCall) {
          planned.push(ref.replace(newLocal), optionNode.replace(config.text));
        }
      }
      if (!safe) continue;
      edits.push(...planned);
      reserved.add(newLocal);
      wrapperCalls.forEach((id) => removedWrapperCalls.add(id));
      replacements.set(spec.id(), {
        text: target === newLocal ? target : `${target} as ${newLocal}`,
        source: adapter.node
          ? "@copilotkit/runtime/node"
          : "@copilotkit/runtime",
      });
    }
    if (!replacements.size) continue;
    // Keep default/namespace imports untouched; they are not part of the supported pattern.
    const groups = new Map<string, string[]>();
    for (const spec of specs) {
      const moved = replacements.get(spec.id());
      const from = moved?.source ?? unquote(source);
      groups.set(from, [
        ...(groups.get(from) ?? []),
        moved?.text ?? spec.text(),
      ]);
    }
    edits.push(
      imp.replace(
        [...groups]
          .map(
            ([from, items]) =>
              `import { ${[...new Set(items)].join(", ")} } from ${JSON.stringify(from)};`,
          )
          .join("\n"),
      ),
    );
  }
  // Remove only wrapper specifiers whose references were all migrated. Other
  // Hono applications in the same file may still use handle().
  for (const imp of imports) {
    if (imp.field("source")?.text().slice(1, -1) !== "hono/vercel") continue;
    const wrapperClause = imp.find({ rule: { kind: "import_clause" } });
    if (
      !wrapperClause ||
      named(wrapperClause).some((n) => n.kind() !== "named_imports")
    )
      continue;
    const specs = imp.findAll({ rule: { kind: "import_specifier" } });
    const kept = specs.filter((spec) => {
      if (spec.field("name")?.text() !== "handle") return true;
      const local = spec.field("alias")?.text() ?? "handle";
      const uses = refs(root, local).filter((n) => !inImport(n));
      return (
        !uses.length || !uses.every((n) => removedWrapperCalls.has(n.id()))
      );
    });
    if (kept.length !== specs.length)
      edits.push(
        imp.replace(
          kept.length
            ? `import { ${kept.map((n) => n.text()).join(", ")} } from ${imp.field("source")!.text()};`
            : "",
        ),
      );
  }
  return edits.length ? root.commitEdits(edits) : null;
}
