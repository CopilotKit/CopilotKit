import { Code, Root } from "mdast";
import convert from "npm-to-yarn";
import { Plugin } from "unified";
import { visit } from "unist-util-visit";
import {
  cleanMetadataParam,
  META_PLACEHOLDER,
  PACKAGE_MANAGERS,
  PackageManager,
} from "./constants";

function getTabAST(
  node: Code,
  packageManager: PackageManager,
  newMetadata: string
) {
  return {
    type: "mdxJsxFlowElement",
    name: "Tab",
    attributes: [
      {
        type: "mdxJsxAttribute",
        name: "value",
        value: packageManager,
      },
    ],
    children: [
      {
        type: node.type,
        lang: node.lang,
        meta: newMetadata,
        value: convert(node.value, packageManager),
      },
    ],
  };
}

export const remarkNpm2Yarn: Plugin<
  [{ storageKey: string }],
  Root
> = (opts) => {

  // const IMPORT_AST = {
  //   type: "mdxjsEsm",
  //   value: "import dynamic from 'next/dynamic'\n\nconst { Tabs, Tab } = dynamic(() => import('fumadocs-ui/components/tabs').then(mod => mod.Tabs))",
  // };

  const TABS_AST = {
    type: "mdxJsxFlowElement",
    name: "Tabs",
    attributes: [
      {
        type: "mdxJsxAttribute",
        name: "items",
        value: {
          type: "mdxJsxAttributeValueExpression",
          data: {
            estree: {
              body: [
                {
                  type: "ExpressionStatement",
                  expression: {
                    type: "ArrayExpression",
                    elements: PACKAGE_MANAGERS.map((value) => ({
                      type: "Literal",
                      value,
                    })),
                  },
                },
              ],
            },
          },
        },
      },
      {
        type: "mdxJsxAttribute",
        name: "groupId",
        value: "npm2yarn",
      },
      {
        type: "mdxJsxAttribute",
        name: "persist",
        value: true,
      },
    ],
  };

  return (ast, _file, done) => {
    let isImported = false;

    visit(ast, "code", (node: Code, index, parent) => {
      const newMetadata = node.meta
        ? cleanMetadataParam(node.meta, META_PLACEHOLDER)
        : "";

      if (!node.meta || node.meta === newMetadata) return;

      if (!node.value.startsWith("npm")) {
        throw new Error(
          `\`npm-to-yarn\` package can convert only npm commands to all package managers. Found: ${node.value}`
        );
      }

      // Replace current node with Tabs/Tab components
      parent!.children[index!] = {
        ...TABS_AST,
        children: PACKAGE_MANAGERS.map((value) =>
          getTabAST(node, value, newMetadata)
        ),
      } as any;

      if (isImported) return;

      // Add import statement at top of file
      // ast.children.unshift(IMPORT_AST as any);

      isImported = true;
    });

    done();
  };
};