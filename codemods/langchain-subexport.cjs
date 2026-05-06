/**
 * jscodeshift codemod: migrate imports of LangChain-coupled symbols from
 * `@copilotkit/runtime` to the new `@copilotkit/runtime/langchain` subexport
 * introduced in 1.58.0.
 *
 * Symbols moved:
 *   - LangChainAdapter, BedrockAdapter, GoogleGenerativeAIAdapter, RemoteChain
 *   - RemoteChainParameters, LangChainReturnType (types)
 *
 * Usage:
 *   npx jscodeshift \
 *     -t https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/codemods/langchain-subexport.cjs \
 *     --parser=tsx \
 *     --extensions=ts,tsx,js,jsx,mts,cts,mjs,cjs \
 *     src/
 *
 * Cases handled:
 *   1. `import { LangChainAdapter } from "@copilotkit/runtime"` → path rewrite
 *   2. Mixed import (root + langchain symbols) → split into two statements
 *   3. Type-only import (`import type { LangChainReturnType }`) → path rewrite
 *   4. Mixed value/type import → split (values stay, types move)
 *   5. Aliased import (`{ LangChainAdapter as LCA }`) → alias preserved
 *   6. CommonJS `require` destructure → split
 *   7. Dynamic `await import()` destructure → split
 *   8. Plain re-export (`export { ... } from "@copilotkit/runtime"`) → rewrite
 *   9. Mixed re-export → split
 *  10. Idempotent merge into existing `/langchain` import
 *
 * Wildcard imports (`import * as rt from "@copilotkit/runtime"`) are skipped
 * with a per-file warning. Re-runs are idempotent.
 */
"use strict";

const ROOT_PKG = "@copilotkit/runtime";
const SUBEXPORT_PKG = "@copilotkit/runtime/langchain";
const MOVED_SYMBOLS = new Set([
  "LangChainAdapter",
  "BedrockAdapter",
  "GoogleGenerativeAIAdapter",
  "RemoteChain",
  "RemoteChainParameters",
  "LangChainReturnType",
]);

function isMoved(spec) {
  // ImportSpecifier: { imported: Identifier, local: Identifier, importKind? }
  // ImportDefaultSpecifier and ImportNamespaceSpecifier are not handled here
  if (spec.type !== "ImportSpecifier") return false;
  const name = spec.imported && spec.imported.name;
  return name ? MOVED_SYMBOLS.has(name) : false;
}

function isMovedExportSpec(spec) {
  // ExportSpecifier: { exported: Identifier, local: Identifier }
  if (spec.type !== "ExportSpecifier") return false;
  const name = spec.local && spec.local.name;
  return name ? MOVED_SYMBOLS.has(name) : false;
}

function isMovedProperty(prop) {
  if (prop.type !== "Property" && prop.type !== "ObjectProperty") return false;
  const name = prop.key && (prop.key.name || prop.key.value);
  return name ? MOVED_SYMBOLS.has(name) : false;
}

module.exports = function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);
  let didChange = false;

  // Find existing /langchain import to merge into (case 10)
  function findExistingSubexportImport() {
    const matches = root.find(j.ImportDeclaration, {
      source: { value: SUBEXPORT_PKG },
    });
    return matches.size() > 0 ? matches.nodes()[0] : null;
  }

  function mergeIntoExistingSubexport(specifiers) {
    const existing = findExistingSubexportImport();
    if (!existing) return false;
    const existingNames = new Set(
      (existing.specifiers || [])
        .filter((s) => s.type === "ImportSpecifier")
        .map((s) => s.imported.name),
    );
    for (const spec of specifiers) {
      const name = spec.imported.name;
      if (!existingNames.has(name)) {
        existing.specifiers.push(spec);
        existingNames.add(name);
      }
    }
    return true;
  }

  // -------------------------------------------------------------------
  // ImportDeclaration: cases 1-5
  // -------------------------------------------------------------------
  root
    .find(j.ImportDeclaration, { source: { value: ROOT_PKG } })
    .forEach((p) => {
      const node = p.node;
      const specifiers = node.specifiers || [];

      // Wildcard import — can't safely rewrite; warn and skip
      const hasNamespace = specifiers.some(
        (s) => s.type === "ImportNamespaceSpecifier",
      );
      if (hasNamespace) {
        const symbolList = [...MOVED_SYMBOLS].join(", ");
        console.warn(
          `[codemod] Skipped ${file.path}: wildcard import requires manual ` +
            `migration of moved symbols (${symbolList}).`,
        );
        return;
      }

      // Side-effect-only import — leave alone
      if (specifiers.length === 0) return;

      const moved = specifiers.filter(isMoved);
      const kept = specifiers.filter((s) => !isMoved(s));
      if (moved.length === 0) return;

      didChange = true;

      // Inherit the declaration-level importKind ("type" | "value" | undefined)
      const declKind = node.importKind;
      const newStmts = [];

      if (kept.length > 0) {
        const keepDecl = j.importDeclaration(
          kept,
          j.literal(ROOT_PKG),
          declKind,
        );
        newStmts.push(keepDecl);
      }

      // Try merging into an existing /langchain import first
      const merged = mergeIntoExistingSubexport(moved);
      if (!merged) {
        const newDecl = j.importDeclaration(
          moved,
          j.literal(SUBEXPORT_PKG),
          declKind,
        );
        newStmts.push(newDecl);
      }

      if (newStmts.length === 0) {
        j(p).remove();
      } else {
        j(p).replaceWith(newStmts);
      }
    });

  // -------------------------------------------------------------------
  // ExportNamedDeclaration: cases 8-9
  // -------------------------------------------------------------------
  root
    .find(j.ExportNamedDeclaration, { source: { value: ROOT_PKG } })
    .forEach((p) => {
      const node = p.node;
      const specifiers = node.specifiers || [];
      if (specifiers.length === 0) return;

      const moved = specifiers.filter(isMovedExportSpec);
      const kept = specifiers.filter((s) => !isMovedExportSpec(s));
      if (moved.length === 0) return;

      didChange = true;

      const newStmts = [];
      if (kept.length > 0) {
        newStmts.push(
          j.exportNamedDeclaration(null, kept, j.literal(ROOT_PKG)),
        );
      }
      newStmts.push(
        j.exportNamedDeclaration(null, moved, j.literal(SUBEXPORT_PKG)),
      );

      j(p).replaceWith(newStmts);
    });

  // -------------------------------------------------------------------
  // CJS require destructure: case 6
  //   const { LangChainAdapter } = require("@copilotkit/runtime")
  // -------------------------------------------------------------------
  // Match by VariableDeclaration so we can replace the whole statement.
  root.find(j.VariableDeclaration).forEach((p) => {
    const decl = p.node;
    if (decl.declarations.length !== 1) return;
    const declarator = decl.declarations[0];
    if (
      !declarator.id ||
      declarator.id.type !== "ObjectPattern" ||
      !declarator.init ||
      declarator.init.type !== "CallExpression" ||
      !declarator.init.callee ||
      declarator.init.callee.name !== "require"
    ) {
      return;
    }
    const args = declarator.init.arguments;
    if (!args || args.length !== 1 || !args[0] || args[0].value !== ROOT_PKG) {
      return;
    }
    const handled = rewriteDestructure(j, p, decl, declarator, "require");
    if (handled) didChange = true;
  });

  // -------------------------------------------------------------------
  // Dynamic import destructure: case 7
  //   const { LangChainAdapter } = await import("@copilotkit/runtime")
  // -------------------------------------------------------------------
  root.find(j.VariableDeclaration).forEach((p) => {
    const decl = p.node;
    if (decl.declarations.length !== 1) return;
    const declarator = decl.declarations[0];
    if (
      !declarator.id ||
      declarator.id.type !== "ObjectPattern" ||
      !declarator.init ||
      declarator.init.type !== "AwaitExpression" ||
      !declarator.init.argument ||
      declarator.init.argument.type !== "CallExpression" ||
      !declarator.init.argument.callee ||
      declarator.init.argument.callee.type !== "Import"
    ) {
      return;
    }
    const args = declarator.init.argument.arguments;
    if (!args || args.length !== 1 || !args[0] || args[0].value !== ROOT_PKG) {
      return;
    }
    const handled = rewriteDestructure(j, p, decl, declarator, "dynamicImport");
    if (handled) didChange = true;
  });

  return didChange ? root.toSource({ quote: "double" }) : null;
};

function rewriteDestructure(j, declarationPath, decl, declarator, mode) {
  const properties = declarator.id.properties || [];
  const moved = properties.filter(isMovedProperty);
  const kept = properties.filter((p) => !isMovedProperty(p));
  if (moved.length === 0) return false;

  // Fast path: all destructured names are moved. Mutate the literal arg
  // in place so the original destructure formatting is preserved.
  if (kept.length === 0) {
    const literalNode =
      mode === "require"
        ? declarator.init.arguments[0]
        : declarator.init.argument.arguments[0];
    literalNode.value = SUBEXPORT_PKG;
    if (typeof literalNode.raw === "string") {
      literalNode.raw = JSON.stringify(SUBEXPORT_PKG);
    }
    return true;
  }

  // Mixed case: rebuild with two declarations (kept at root path, moved at
  // subexport path). Destructure formatting may be expanded by the printer.
  const kind = decl.kind;
  const buildInit = (target) => {
    if (mode === "require") {
      return j.callExpression(j.identifier("require"), [j.literal(target)]);
    }
    const freshImportCall = j.callExpression.from({
      callee: declarator.init.argument.callee,
      arguments: [j.literal(target)],
    });
    return j.awaitExpression(freshImportCall);
  };

  const newDecls = [
    j.variableDeclaration(kind, [
      j.variableDeclarator(j.objectPattern(kept), buildInit(ROOT_PKG)),
    ]),
    j.variableDeclaration(kind, [
      j.variableDeclarator(j.objectPattern(moved), buildInit(SUBEXPORT_PKG)),
    ]),
  ];

  j(declarationPath).replaceWith(newDecls);
  return true;
}
