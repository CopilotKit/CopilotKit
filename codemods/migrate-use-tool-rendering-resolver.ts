/**
 * Codemod: migrate-use-tool-rendering-resolver
 *
 * Migrates the deprecated v2 `useRenderToolCall` resolver hook to
 * `useToolRenderingResolver`.
 *
 * Transformations:
 *   - import { useRenderToolCall } from "@copilotkit/react-core/v2"
 *     -> import { useToolRenderingResolver } from "@copilotkit/react-core/v2"
 *   - useRenderToolCall() -> useToolRenderingResolver()
 *   - the common `renderToolCall` returned callback local is renamed to
 *     `resolveToolRendering`
 *   - aliased imports keep their local alias
 *   - v2 re-exports are renamed
 *
 * Usage:
 *   npx jscodeshift -t ./codemods/migrate-use-tool-rendering-resolver.ts --extensions=tsx,ts ./src
 */

import type {
  API,
  ExportSpecifier,
  FileInfo,
  ImportSpecifier,
  JSCodeshift,
  NodePath,
} from "jscodeshift";

const V2_ENTRYPOINT = "@copilotkit/react-core/v2";
const DEPRECATED_HOOK = "useRenderToolCall";
const REPLACEMENT_HOOK = "useToolRenderingResolver";
const DEFAULT_RESOLVER_LOCAL = "resolveToolRendering";
const DEPRECATED_RESOLVER_LOCAL = "renderToolCall";

function renameLocalReferences({
  j,
  root,
  localName,
  nextName,
  bindingScope,
}: {
  j: JSCodeshift;
  root: ReturnType<JSCodeshift>;
  localName: string;
  nextName: string;
  bindingScope: NodePath["scope"];
}) {
  root.find(j.Identifier, { name: localName }).forEach((idPath) => {
    const parent = idPath.parent.node;

    if (
      parent.type === "ImportSpecifier" ||
      parent.type === "ExportSpecifier"
    ) {
      return;
    }

    if (parent.type === "VariableDeclarator" && parent.id === idPath.node) {
      return;
    }
    if (parent.type === "FunctionDeclaration" && parent.id === idPath.node) {
      return;
    }
    if (parent.type === "ClassDeclaration" && parent.id === idPath.node) {
      return;
    }
    if (parent.type === "TSTypeAliasDeclaration" && parent.id === idPath.node) {
      return;
    }
    if (parent.type === "TSInterfaceDeclaration" && parent.id === idPath.node) {
      return;
    }

    if (
      (parent.type === "Property" || parent.type === "ObjectProperty") &&
      parent.key === idPath.node &&
      !parent.computed
    ) {
      return;
    }
    if (
      parent.type === "MemberExpression" &&
      parent.property === idPath.node &&
      !parent.computed
    ) {
      return;
    }

    const referenceScope = idPath.scope?.lookup?.(localName);
    if (referenceScope && referenceScope !== bindingScope) {
      return;
    }

    idPath.node.name = nextName;
  });
}

function renameDefaultResolverBinding({
  j,
  root,
}: {
  j: JSCodeshift;
  root: ReturnType<JSCodeshift>;
}) {
  let changed = false;

  root.find(j.VariableDeclarator).forEach((path) => {
    const { id, init } = path.node;

    if (id.type !== "Identifier" || id.name !== DEPRECATED_RESOLVER_LOCAL) {
      return;
    }

    if (
      !init ||
      init.type !== "CallExpression" ||
      init.callee.type !== "Identifier" ||
      init.callee.name !== REPLACEMENT_HOOK
    ) {
      return;
    }

    const existingResolverScope = path.scope?.lookup?.(DEFAULT_RESOLVER_LOCAL);
    if (existingResolverScope === path.scope) {
      return;
    }

    renameLocalReferences({
      j,
      root,
      localName: DEPRECATED_RESOLVER_LOCAL,
      nextName: DEFAULT_RESOLVER_LOCAL,
      bindingScope: path.scope,
    });

    id.name = DEFAULT_RESOLVER_LOCAL;
    changed = true;
  });

  return changed;
}

export default function transform(file: FileInfo, api: API) {
  const j = api.jscodeshift;
  const root = j(file.source);
  let changed = false;

  root
    .find(j.ImportDeclaration, { source: { value: V2_ENTRYPOINT } })
    .forEach((path) => {
      const specifiers = path.node.specifiers;
      if (!specifiers) return;

      for (const specifier of specifiers) {
        if (specifier.type !== "ImportSpecifier") continue;

        const spec = specifier as ImportSpecifier;
        if (spec.imported.type !== "Identifier") continue;
        if (spec.imported.name !== DEPRECATED_HOOK) continue;

        const localName = spec.local?.name ?? spec.imported.name;
        const isAliased = localName !== spec.imported.name;

        spec.imported.name = REPLACEMENT_HOOK;

        if (!isAliased) {
          renameLocalReferences({
            j,
            root,
            localName,
            nextName: REPLACEMENT_HOOK,
            bindingScope: path.scope,
          });

          if (spec.local) {
            spec.local.name = REPLACEMENT_HOOK;
          }
        }

        changed = true;
      }
    });

  root
    .find(j.ExportNamedDeclaration, { source: { value: V2_ENTRYPOINT } })
    .forEach((path) => {
      const specifiers = path.node.specifiers;
      if (!specifiers) return;

      for (const specifier of specifiers) {
        if (specifier.type !== "ExportSpecifier") continue;

        const spec = specifier as ExportSpecifier;
        if (spec.local.type !== "Identifier") continue;
        if (spec.local.name !== DEPRECATED_HOOK) continue;

        const exportedName =
          spec.exported.type === "Identifier" ? spec.exported.name : undefined;

        spec.local.name = REPLACEMENT_HOOK;

        if (!exportedName || exportedName === DEPRECATED_HOOK) {
          spec.exported = j.identifier(REPLACEMENT_HOOK);
        }

        changed = true;
      }
    });

  changed =
    renameDefaultResolverBinding({
      j,
      root,
    }) || changed;

  return changed ? root.toSource({ quote: "double" }) : file.source;
}
