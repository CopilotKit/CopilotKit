/**
 * Draft Gen UI 2.0 (A2UI 1.0) catalog definitions from an existing React component folder.
 *
 *   pnpm dlx tsx scripts/scan-components.ts <componentsDir> [--tsconfig ./tsconfig.json] [--out a2ui-definitions.draft.ts] [--shared ./shared]
 *
 * Uses the TypeScript compiler API to find exported, capitalized React
 * components in .tsx files, resolve the props type of their first parameter,
 * and map it to Zod:
 *
 *   string / number / boolean      -> z.string() / z.number() / z.boolean()
 *   "a" | "b" literal unions       -> z.enum(["a", "b"])
 *   T[]                            -> z.array(...)
 *   object literal types           -> z.object({...}) (depth-limited)
 *   children                       -> childList() (ids or a { componentId, path } template)
 *   other ReactNode props          -> child() (one component id)
 *   on* callbacks                  -> events (the model binds { event } or { functionCall }), flagged for review
 *   value + onChange/onValueChange -> writable: ["value"] (the renderer gets setValue)
 *   className / style / ref / key  -> skipped
 *
 * Schemas describe literal values only: A2UI 1.0 resolves `{ "@path" }` and
 * `{ "@call" }` at any depth before props are validated. The draft imports
 * `child`, `childList` and `def` from the shared helpers (templates/definitions-shared.ts,
 * pass its import path with --shared). Everything is a DRAFT: review names,
 * tighten descriptions, set categories, and delete components the agent
 * should never pick or that `standardUI` already has (a name may not be in both).
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const tsconfig = args.includes("--tsconfig") ? args[args.indexOf("--tsconfig") + 1] : "tsconfig.json";
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "a2ui-definitions.draft.ts";
const shared = args.includes("--shared") ? args[args.indexOf("--shared") + 1] : "./shared";
if (!dir) {
  console.error("usage: scan-components.ts <componentsDir> [--tsconfig tsconfig.json] [--out file.ts] [--shared ./shared]");
  process.exit(1);
}

const SKIP = new Set(["className", "style", "ref", "key", "asChild", "dangerouslySetInnerHTML", "id"]);
/** Callbacks that report a new `value`: the component gets `setValue` instead of an event. */
const VALUE_CALLBACKS = new Set(["onChange", "onValueChange", "onCheckedChange", "onSelect"]);

function listFiles(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : listFiles(p);
    return /\.tsx$/.test(e.name) && !/\.(test|stories)\.tsx$/.test(e.name) ? [p] : [];
  });
}

const cfgPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, tsconfig);
const cfg = cfgPath ? ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, path.dirname(cfgPath)) : { options: { jsx: ts.JsxEmit.ReactJSX, strict: true }, fileNames: [] };
const files = listFiles(path.resolve(dir));
const program = ts.createProgram(files, { ...cfg.options, noEmit: true });
const checker = program.getTypeChecker();

function isReactNodeLike(t: ts.Type) {
  const s = checker.typeToString(t);
  return /ReactNode|ReactElement|JSX\.Element/.test(s);
}

function zodFor(t: ts.Type, depth = 0): string {
  if (t.flags & ts.TypeFlags.String) return "z.string()";
  if (t.flags & ts.TypeFlags.Number) return "z.number()";
  if (t.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return "z.boolean()";
  if (t.isUnion()) {
    const parts = t.types.filter((x) => !(x.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
    if (parts.length && parts.every((x) => x.isStringLiteral())) return `z.enum([${parts.map((x) => JSON.stringify((x as ts.StringLiteralType).value)).join(", ")}])`;
    if (parts.every((x) => x.flags & ts.TypeFlags.BooleanLiteral)) return "z.boolean()";
    if (parts.length === 1) return zodFor(parts[0], depth);
    return `z.union([${parts.slice(0, 4).map((x) => zodFor(x, depth + 1)).join(", ")}])`;
  }
  if (t.isStringLiteral()) return `z.literal(${JSON.stringify(t.value)})`;
  if (checker.isArrayType(t)) {
    const el = (t as ts.TypeReference).typeArguments?.[0];
    return `z.array(${el ? zodFor(el, depth + 1) : "z.any()"})`;
  }
  if (t.getCallSignatures().length) return depth === 0 ? "action" : "z.any()";
  if (t.flags & ts.TypeFlags.Object && depth < 3) {
    const props = checker.getPropertiesOfType(t).filter((p) => !SKIP.has(p.name));
    if (!props.length || props.length > 25) return "z.record(z.any())";
    return `z.object({ ${props
      .map((p) => {
        const pt = checker.getTypeOfSymbol(p);
        const opt = (p.flags & ts.SymbolFlags.Optional) !== 0;
        return `${JSON.stringify(p.name)}: ${zodFor(pt, depth + 1)}${opt ? ".optional()" : ""}`;
      })
      .join(", ")} })`;
  }
  return "z.any()";
}

type Prop = { name: string; zod: string; optional: boolean; doc: string; note?: string };
type Found = { name: string; file: string; doc: string; props: Prop[]; events: Array<{ name: string; doc: string }>; writable: boolean };
const found: Found[] = [];

for (const sf of program.getSourceFiles()) {
  if (!files.includes(path.resolve(sf.fileName))) continue;
  const mod = checker.getSymbolAtLocation(sf);
  if (!mod) continue;
  for (const exp of checker.getExportsOfModule(mod)) {
    if (!/^[A-Z]/.test(exp.name)) continue;
    const sym = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (!decl) continue;
    const type = checker.getTypeOfSymbolAtLocation(sym, decl);
    const sig = type.getCallSignatures()[0];
    if (!sig) continue;
    const ret = checker.typeToString(sig.getReturnType());
    if (!/Element|ReactNode|null/.test(ret)) continue;
    const param = sig.getParameters()[0];
    const propsType = param ? checker.getTypeOfSymbolAtLocation(param, decl) : undefined;
    const props: Prop[] = [];
    const events: Found["events"] = [];
    const symbols = (propsType ? checker.getPropertiesOfType(propsType) : [])
      .filter((p) => !SKIP.has(p.name) && !p.name.startsWith("aria-") && !p.name.startsWith("data-"))
      // Skip the hundreds of inherited DOM props; keep what the component declared itself.
      .filter((p) => p.name === "children" || p.name === "onClick" || !(p.declarations ?? []).every((d) => d.getSourceFile().fileName.includes("node_modules")));
    const names = new Set(symbols.map((p) => p.name));
    const writable = names.has("value") && [...VALUE_CALLBACKS].some((n) => names.has(n));
    for (const p of symbols) {
      const pt = checker.getTypeOfSymbol(p);
      const optional = (p.flags & ts.SymbolFlags.Optional) !== 0;
      const doc = ts.displayPartsToString(p.getDocumentationComment(checker)).replace(/\s+/g, " ").trim();
      if (p.name === "children") {
        props.push({ name: "children", zod: "childList()", optional: true, doc, note: "child component ids, rendered for you" });
        continue;
      }
      if (isReactNodeLike(pt)) {
        props.push({ name: p.name, zod: "child()", optional: true, doc, note: "one child component id, rendered for you" });
        continue;
      }
      const zod = zodFor(pt);
      if (zod === "action") {
        if (writable && VALUE_CALLBACKS.has(p.name)) continue; // replaced by setValue
        events.push({ name: p.name, doc });
        continue;
      }
      props.push({ name: p.name, zod, optional, doc });
    }
    found.push({ name: exp.name, file: path.relative(process.cwd(), sf.fileName), doc: ts.displayPartsToString(sym.getDocumentationComment(checker)).replace(/\s+/g, " ").trim(), props, events, writable });
  }
}

const extra = (f: Found) => {
  const parts: string[] = [];
  if (f.events.length)
    parts.push(
      `events: { ${f.events.map((e) => `${e.name}: { description: ${JSON.stringify(e.doc || `TODO: when ${f.name} fires ${e.name}`)}, parameters: z.object({}).passthrough() }`).join(", ")} }`,
    );
  if (f.writable) parts.push(`writable: ["value"]`);
  return parts.length ? `{ ${parts.join(", ")} }` : "";
};

const lines = [
  "/* DRAFT generated by scan-components.ts: review every description and prop before use. */",
  'import { z } from "zod";',
  `import { child, childList, def } from ${JSON.stringify(shared)};`,
  "",
  "export const definitions = {",
  ...found.flatMap((f) => [
    `  // ${f.file}${f.events.length ? ` (events: ${f.events.map((e) => e.name).join(", ")}; the renderer calls the event prop)` : ""}`,
    `  ${f.name}: def(`,
    `    "Domain", // TODO: category`,
    `    ${JSON.stringify(f.doc || `TODO: when should the agent pick ${f.name}? One sentence.`)},`,
    "    z.object({",
    ...f.props.map((p) => `      ${JSON.stringify(p.name)}: ${p.zod}${p.optional && !p.zod.endsWith(".optional()") ? ".optional()" : ""},${p.doc || p.note ? ` // ${[p.doc, p.note].filter(Boolean).join("; ")}` : ""}`),
    `    })${extra(f) ? "," : ""}`,
    ...(extra(f) ? [`    ${extra(f)},`] : []),
    "  ),",
  ]),
  "};",
  "",
];
fs.writeFileSync(out, lines.join("\n"));
console.log(`scanned ${files.length} files, found ${found.length} components -> ${out}`);
