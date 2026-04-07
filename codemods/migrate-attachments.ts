/**
 * Codemod: migrate-attachments
 *
 * Migrates from the deprecated image-upload API to the new attachments API.
 *
 * Transformations:
 *   1. JSX props on CopilotChat / CopilotSidebar / CopilotPopup:
 *      - imageUploadsEnabled={true}  → attachments={{ enabled: true }}
 *      - inputFileAccept="..."       → merged into attachments={{ accept: "..." }}
 *      - Both props present          → attachments={{ enabled: true, accept: "..." }}
 *
 *   2. Named imports from "@copilotkit/react-ui":
 *      - ImageUploadQueue → AttachmentQueue
 *      - ImageUpload (type) → Attachment (type)
 *
 * Usage:
 *   npx jscodeshift -t ./codemods/migrate-attachments.ts --extensions=tsx,ts ./src
 */

import type {
  API,
  FileInfo,
  JSXElement,
  JSXAttribute,
  JSXExpressionContainer,
  ImportSpecifier,
} from "jscodeshift";

const COPILOTKIT_PACKAGE = "@copilotkit/react-ui";
const TARGET_COMPONENTS = new Set([
  "CopilotChat",
  "CopilotSidebar",
  "CopilotPopup",
]);

const IMPORT_RENAMES: Record<string, string> = {
  ImageUploadQueue: "AttachmentQueue",
  ImageUpload: "Attachment",
};

export default function transform(file: FileInfo, api: API) {
  const j = api.jscodeshift;
  const root = j(file.source);
  let changed = false;

  // -----------------------------------------------------------------------
  // 1. Rename imports from @copilotkit/react-ui
  // -----------------------------------------------------------------------
  root
    .find(j.ImportDeclaration, { source: { value: COPILOTKIT_PACKAGE } })
    .forEach((path) => {
      const specifiers = path.node.specifiers;
      if (!specifiers) return;

      for (const spec of specifiers) {
        if (spec.type !== "ImportSpecifier") continue;
        const imported = (spec as ImportSpecifier).imported;
        if (imported.type !== "Identifier") continue;

        const newName = IMPORT_RENAMES[imported.name];
        if (!newName) continue;

        const localName = spec.local?.name ?? imported.name;
        const isAliased = localName !== imported.name;

        // Rename the imported identifier
        imported.name = newName;

        // If the local name matched the old imported name (not aliased),
        // update references in the file to use the new name.
        //
        // To avoid corrupting unrelated code, we check if any local
        // declaration (variable, function, class) shadows the imported
        // name. If so, we only rename type-position references (which
        // unambiguously refer to the type import) and leave value-position
        // references alone since they may refer to the local binding.
        if (!isAliased) {
          const hasShadow =
            root.find(j.VariableDeclarator, {
              id: { type: "Identifier", name: localName },
            }).length > 0 ||
            root.find(j.FunctionDeclaration, {
              id: { type: "Identifier", name: localName },
            }).length > 0 ||
            root.find(j.ClassDeclaration, {
              id: { type: "Identifier", name: localName },
            }).length > 0;

          root.find(j.Identifier, { name: localName }).forEach((idPath) => {
            // Skip the import specifier itself — already renamed above
            if (idPath.parent.node === spec) return;

            const parent = idPath.parent.node;

            // Skip declaration positions — these define new bindings
            if (
              parent.type === "VariableDeclarator" &&
              parent.id === idPath.node
            )
              return;
            if (
              parent.type === "FunctionDeclaration" &&
              parent.id === idPath.node
            )
              return;
            if (parent.type === "ClassDeclaration" && parent.id === idPath.node)
              return;
            if (
              parent.type === "TSTypeAliasDeclaration" &&
              parent.id === idPath.node
            )
              return;
            if (
              parent.type === "TSInterfaceDeclaration" &&
              parent.id === idPath.node
            )
              return;

            // Skip non-computed object property keys and member expression properties
            if (
              (parent.type === "Property" ||
                parent.type === "ObjectProperty") &&
              parent.key === idPath.node &&
              !parent.computed
            )
              return;
            if (
              parent.type === "MemberExpression" &&
              parent.property === idPath.node &&
              !parent.computed
            )
              return;

            // Skip import specifiers from other packages
            if (
              parent.type === "ImportSpecifier" &&
              idPath.parent.parent?.node !== path.node
            )
              return;

            // If a local declaration shadows this name, only rename
            // unambiguous type-position references (e.g. type annotations)
            if (hasShadow) {
              const isTypePosition =
                parent.type === "TSTypeReference" ||
                parent.type === "TSTypeAnnotation" ||
                parent.type === "TSTypeQuery";
              if (!isTypePosition) return;
            }

            idPath.node.name = newName;
          });

          // Only rename JSX identifiers if there's no shadow
          if (!hasShadow) {
            root
              .find(j.JSXIdentifier, { name: localName })
              .forEach((idPath) => {
                idPath.node.name = newName;
              });
          }

          if (spec.local) {
            spec.local.name = newName;
          }
        }

        changed = true;
      }
    });

  // -----------------------------------------------------------------------
  // 2. Transform JSX props on CopilotChat / CopilotSidebar / CopilotPopup
  // -----------------------------------------------------------------------
  root.find(j.JSXOpeningElement).forEach((path) => {
    const nameNode = path.node.name;
    if (nameNode.type !== "JSXIdentifier") return;
    if (!TARGET_COMPONENTS.has(nameNode.name)) return;

    const attrs = path.node.attributes;
    if (!attrs) return;

    // Find the deprecated props
    let imageUploadsAttr: JSXAttribute | null = null;
    let inputFileAcceptAttr: JSXAttribute | null = null;
    let existingAttachmentsAttr: JSXAttribute | null = null;

    for (const attr of attrs) {
      if (
        attr.type !== "JSXAttribute" ||
        !attr.name ||
        attr.name.type !== "JSXIdentifier"
      )
        continue;
      if (attr.name.name === "imageUploadsEnabled") imageUploadsAttr = attr;
      if (attr.name.name === "inputFileAccept") inputFileAcceptAttr = attr;
      if (attr.name.name === "attachments") existingAttachmentsAttr = attr;
    }

    // Skip if neither deprecated prop is present
    if (!imageUploadsAttr && !inputFileAcceptAttr) return;
    // Skip if attachments prop already exists (already migrated or manual)
    if (existingAttachmentsAttr) return;

    // Build the attachments object properties
    const properties = [];

    if (imageUploadsAttr) {
      let enabledExpr;
      const val = imageUploadsAttr.value;
      if (!val) {
        // Shorthand: <CopilotChat imageUploadsEnabled /> means true
        enabledExpr = j.booleanLiteral(true);
      } else if (
        val.type === "JSXExpressionContainer" &&
        val.expression.type === "BooleanLiteral"
      ) {
        enabledExpr = j.booleanLiteral(val.expression.value);
      } else if (val.type === "JSXExpressionContainer") {
        // Dynamic expression — preserve as-is
        enabledExpr = val.expression;
      } else {
        enabledExpr = j.booleanLiteral(true);
      }
      properties.push(j.objectProperty(j.identifier("enabled"), enabledExpr));
    }

    if (inputFileAcceptAttr) {
      const val = inputFileAcceptAttr.value;
      if (val) {
        if (val.type === "StringLiteral") {
          properties.push(
            j.objectProperty(
              j.identifier("accept"),
              j.stringLiteral(val.value),
            ),
          );
        } else if (
          val.type === "JSXExpressionContainer" &&
          val.expression.type === "StringLiteral"
        ) {
          properties.push(
            j.objectProperty(
              j.identifier("accept"),
              j.stringLiteral(val.expression.value),
            ),
          );
        } else if (val.type === "JSXExpressionContainer") {
          // Dynamic expression — preserve as-is
          properties.push(
            j.objectProperty(j.identifier("accept"), val.expression),
          );
        }
      }
    }

    if (properties.length === 0) return;

    // Create: attachments={{ enabled: true, accept: "..." }}
    const attachmentsAttr = j.jsxAttribute(
      j.jsxIdentifier("attachments"),
      j.jsxExpressionContainer(j.objectExpression(properties)),
    );

    // Remove old props, add new one
    path.node.attributes = attrs.filter(
      (attr) => attr !== imageUploadsAttr && attr !== inputFileAcceptAttr,
    );
    path.node.attributes.push(attachmentsAttr);

    changed = true;
  });

  return changed ? root.toSource() : undefined;
}
