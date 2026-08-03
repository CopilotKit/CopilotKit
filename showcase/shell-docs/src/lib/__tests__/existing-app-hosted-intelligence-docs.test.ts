import { expect, test, vi } from "vitest";
import fs from "fs";
import matter from "gray-matter";
import { serialize } from "next-mdx-remote/serialize";
import remarkGfm from "remark-gfm";
import ts from "typescript";

vi.mock("../registry", () => ({ getDocsMode: () => "generated" }));

import { inlineSnippets } from "../docs-render";
import { filterFrontendScopedBlocks } from "../toc";

const canonicalGuidePath = "/premium/existing-app-hosted-intelligence";
const canonicalGuideContentPath =
  "docs/premium/existing-app-hosted-intelligence.mdx";
const hostedRuntimeSnippetPath =
  "snippets/shared/premium/existing-app-hosted-intelligence-platform-runtime.mdx";
const hostedGuideVariants = [
  {
    name: "Angular",
    path: "docs/frontends/angular/premium/existing-app-hosted-intelligence.mdx",
    handoff: "/angular/guides/threads-memory-attachments-headless",
  },
  {
    name: "Vue",
    path: "docs/frontends/vue/premium/existing-app-hosted-intelligence.mdx",
    handoff: "/reference/vue/hooks/useThreads",
  },
  {
    name: "React Native",
    path: "docs/frontends/react-native/premium/existing-app-hosted-intelligence.mdx",
    handoff: "/reference/react-native/hooks/useThreads",
  },
] as const;
const hostedGuideWrappers = [
  { name: "React", path: canonicalGuideContentPath },
  ...hostedGuideVariants,
] as const;
const runtimeSetupLead =
  "Replace the single-method handler with the Intelligence and multi-method handler setup shown here.";
const runnerException =
  "One exception: if those options include an explicit `runner`, remove it before adding `intelligence`; the two select different Runtime modes.";
const drawerEntryPointPath =
  "snippets/shared/basics/copilot-threads-drawer.mdx";
const drawerWrapperSourceUrl = new URL(
  "../../../../../packages/react-core/src/v2/components/chat/CopilotThreadsDrawer.tsx",
  import.meta.url,
);
const drawerElementSourceUrl = new URL(
  "../../../../../packages/web-components/src/threads-drawer/copilotkit-threads-drawer.ts",
  import.meta.url,
);
const reactRouterRouteSourceUrl = new URL(
  "../../../../../examples/v2/react-router/app/routes/api.copilotkit.$.tsx",
  import.meta.url,
);
const useThreadsSourceUrl = new URL(
  "../../../../../packages/react-core/src/v2/hooks/use-threads.tsx",
  import.meta.url,
);
const angularThreadsSourceUrl = new URL(
  "../../../../../packages/angular/src/lib/threads.ts",
  import.meta.url,
);
const headlessEntryPointPath = "snippets/shared/threads/headless-threads.mdx";
const drawerReferencePath = "reference/components/CopilotThreadsDrawer.mdx";
const useThreadsReferencePath = "reference/hooks/useThreads.mdx";
const reactNativeUseThreadsReferencePath =
  "reference/react-native/hooks/useThreads.mdx";
const vueUseThreadsReferencePath = "reference/vue/hooks/useThreads.mdx";
const threadsExplainedPath = "docs/premium/threads-explained.mdx";
const angularThreadsGuidePath =
  "docs/frontends/angular/guides/threads-memory-attachments-headless.mdx";
const entryPointPaths = [
  "snippets/shared/cli/cli.mdx",
  "docs/premium/managed-intelligence-platform.mdx",
  "docs/integrations/built-in-agent/quickstart.mdx",
  drawerEntryPointPath,
  headlessEntryPointPath,
];

interface MdxCodeFence {
  language: string;
  title: string | undefined;
  content: string;
}

interface MdxAstNode {
  type?: string;
  name?: unknown;
  value?: unknown;
  url?: unknown;
  children?: MdxAstNode[];
  attributes?: MdxAstNode[];
}

type TypeScriptModel = ts.SourceFile;

/** Parse executable TypeScript or TSX into the suite's normalized syntax model. */
function parseTypeScriptModel(
  source: string,
  fileName = "example.tsx",
): TypeScriptModel {
  const model = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diagnostics = (
    model as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  const [diagnostic] = diagnostics ?? [];

  if (diagnostic) {
    const location =
      diagnostic.start === undefined
        ? ""
        : (() => {
            const { line, character } = model.getLineAndCharacterOfPosition(
              diagnostic.start,
            );
            return `:${line + 1}:${character + 1}`;
          })();
    throw new Error(
      `${fileName}${location}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
    );
  }

  return model;
}

/** Visit every syntax node in a normalized TypeScript model. */
function visitTypeScript(
  node: ts.Node,
  visitor: (node: ts.Node) => void,
): void {
  visitor(node);
  ts.forEachChild(node, (child) => visitTypeScript(child, visitor));
}

/** Return a static declaration, property, or JSX name. */
function getTypeScriptName(name: ts.PropertyName | ts.BindingName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return name.getText();
}

/** Return a property name only when its runtime key is statically known. */
function getStaticTypeScriptName(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  if (!ts.isComputedPropertyName(name)) return undefined;

  const expression = unwrapTypeScriptExpression(name.expression);
  return ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isNumericLiteral(expression)
    ? expression.text
    : undefined;
}

/** Remove syntax wrappers that do not change an expression's runtime value. */
function unwrapTypeScriptExpression(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

const managedReactSurfaceExports = new Set([
  "CopilotKitProvider",
  "CopilotChatConfigurationProvider",
  "CopilotThreadsDrawer",
  "CopilotChat",
]);

/** Return canonical and named-import aliases for managed React surfaces. */
function getManagedReactSurfaceNames(model: ts.SourceFile): Set<string> {
  const names = new Set(managedReactSurfaceExports);

  for (const statement of model.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@copilotkit/react-core/v2" ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }

    for (const element of statement.importClause.namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (managedReactSurfaceExports.has(importedName)) {
        names.add(element.name.text);
      }
    }
  }

  return names;
}

/** Return whether a declaration has an `export` modifier. */
function isExportedDeclaration(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}

/** Normalize one attached TSDoc block for text assertions. */
function normalizeTsdoc(tsdoc: string): string {
  return collapseWhitespace(
    tsdoc.replace(/^\s*\/\*\*|\*\/\s*$|^\s*\* ?/gm, "").replace(/`/g, ""),
  );
}

/** Return the TSDoc attached to one named exported declaration or member. */
function extractPublicTsdoc(
  model: TypeScriptModel,
  declarationName: string,
  memberName?: string,
): string {
  const declarations = model.statements.filter((statement) => {
    if (!isExportedDeclaration(statement)) return false;
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isClassDeclaration(statement)
    ) {
      return statement.name?.text === declarationName;
    }
    return false;
  });
  const [declaration] = declarations;

  if (!declaration || declarations.length !== 1) {
    throw new Error(`Expected one exported ${declarationName} declaration`);
  }

  let target: ts.Node = declaration;
  if (memberName !== undefined) {
    if (
      !ts.isInterfaceDeclaration(declaration) &&
      !ts.isClassDeclaration(declaration)
    ) {
      throw new Error(`Expected ${declarationName} to have members`);
    }
    const members = declaration.members.filter(
      (member) =>
        member.name !== undefined &&
        getTypeScriptName(member.name) === memberName,
    );
    const [member] = members;
    if (!member || members.length !== 1) {
      throw new Error(`Expected one ${declarationName}.${memberName} member`);
    }
    target = member;
  }

  const comments = ts
    .getJSDocCommentsAndTags(target)
    .filter(ts.isJSDoc)
    .map((comment) => comment.getFullText(model));
  if (comments.length !== 1) {
    throw new Error(`Expected one TSDoc block on ${declarationName}`);
  }

  return normalizeTsdoc(comments[0] ?? "");
}

function readContent(relativePath: string): string {
  return fs.readFileSync(
    new URL(`../../content/${relativePath}`, import.meta.url),
    "utf8",
  );
}

/** Render a hosted guide through the production snippet inliner. */
function readRenderedHostedGuide(relativePath: string): string {
  return inlineSnippets(readContent(relativePath), relativePath);
}

/** Read the rendered React wrapper used for the canonical guide contract. */
function readCanonicalGuide(): string {
  return readRenderedHostedGuide(canonicalGuideContentPath);
}

/** Collapse prose whitespace so line wrapping does not affect contract checks. */
function collapseWhitespace(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

/** Extract TSDoc comments without coupling documentation checks to implementation code. */
function extractTsdocComments(source: string): string {
  return Array.from(
    source.matchAll(/\/\*\*[\s\S]*?\*\//g),
    (match) => match[0],
  ).join("\n");
}

interface PublicTsdocContract {
  source: string;
  declarationName: string;
  memberName?: string;
  required: RegExp[];
}

/** Assert the public TSDoc claims in the cross-framework contract matrix. */
function expectPublicTsdocContractMatrix(
  contracts: PublicTsdocContract[],
): void {
  for (const contract of contracts) {
    const model = parseTypeScriptModel(contract.source);
    const tsdoc = extractPublicTsdoc(
      model,
      contract.declarationName,
      contract.memberName,
    );
    const surface = `${contract.declarationName}${contract.memberName ? `.${contract.memberName}` : ""}`;

    expect(tsdoc, `${surface}: TSDoc exists`).not.toHaveLength(0);
    for (const required of contract.required) {
      expect(tsdoc, `${surface}: ${required}`).toMatch(required);
    }
  }
}

/** Bind declaration/member TSDoc specifications to one source file. */
function createPublicTsdocRows(
  source: string,
  specs: Array<[string, RegExp[], string?]>,
): PublicTsdocContract[] {
  return specs.map(([declarationName, required, memberName]) => ({
    source,
    declarationName,
    memberName,
    required,
  }));
}

/** Build the declaration/member matrix for public thread and Drawer TSDoc. */
function createPublicTsdocContractMatrix(
  reactThreadsSource: string,
  drawerSource: string,
  angularThreadsSource: string,
): PublicTsdocContract[] {
  const recencyContract =
    /lastRunAt[^.]*when present[^.]*otherwise[^.]*updatedAt[^.]*otherwise[^.]*createdAt[^.]*(?:most recent|newest)[ -]first/i;
  const lifecycleContract =
    /archive[^.]*reversible visibility state[\s\S]*includeArchived: true[\s\S]*unarchive[^.]*restores[\s\S]*delete[^.]*irreversible to the app user[\s\S]*platform soft-deletes[^.]*retains[^.]*stored row/i;
  const optimisticContract =
    /rename[^.]*archive[^.]*unarchive[^.]*delete[^.]*optimistic/i;
  const omittedLimitContract =
    /cursor(?:-based)? pagination[^.]*active when (?:this|limit) is omitted/i;
  const limit = [/default is 50 threads per page/i, omittedLimitContract];
  const cursor = [/nextCursor/i, /when limit is omitted/i];
  const lifecycle = [lifecycleContract, optimisticContract, recencyContract];
  const reactHook = [
    /React hook[\s\S]*runtime-authenticated user[\s\S]*realtime subscription/i,
  ];
  const drawerEntitlement = [
    /cloud-hosted[\s\S]*managed entitlement[\s\S]*Runtime-connected Intelligence project[\s\S]*browser[^.]*no license token/i,
  ];
  const angularHook = [
    /Angular threads-list API[\s\S]*runtime-authenticated user[\s\S]*realtime subscription/i,
  ];
  return [
    ...createPublicTsdocRows(reactThreadsSource, [
      ["useThreads", reactHook],
      ["UseThreadsResult", lifecycle],
      ["UseThreadsResult", [recencyContract], "threads"],
      ["UseThreadsInput", limit, "limit"],
      ["UseThreadsResult", cursor, "hasMoreThreads"],
    ]),
    ...createPublicTsdocRows(drawerSource, [
      ["CopilotThreadsDrawer", drawerEntitlement],
      ["CopilotThreadsDrawerProps", limit, "limit"],
    ]),
    ...createPublicTsdocRows(angularThreadsSource, [
      ["injectThreads", angularHook],
      ["InjectThreadsResult", lifecycle],
      ["InjectThreadsInput", limit, "limit"],
      ["InjectThreadsResult", cursor, "hasMoreThreads"],
    ]),
  ];
}

/** Assert that the callback-free Drawer example shares chat configuration. */
function expectCallbackFreeDrawerExample(source: string): void {
  const tsdoc = extractTsdocComments(source);
  const example =
    tsdoc.match(/@example[\s\S]*?```tsx\r?\n([\s\S]*?)```/)?.[1] ?? "";
  const configuration = example.match(
    /<CopilotChatConfigurationProvider\b[^>]*>([\s\S]*?)<\/CopilotChatConfigurationProvider>/,
  );
  const sharedChildren = configuration?.[1] ?? "";

  expect(example).not.toHaveLength(0);
  expect(configuration).not.toBeNull();
  expect(sharedChildren).toMatch(/<CopilotThreadsDrawer\b[^>]*\/>/);
  expect(sharedChildren).toMatch(/<CopilotChat\b[^>]*\/>/);
}

/** Return TSDoc attached to one public interface member. */
function extractPublicMemberTsdoc(
  source: string,
  interfaceName: string,
  memberName: string,
): string {
  const declarations = Array.from(
    source.matchAll(
      new RegExp(`export\\s+interface\\s+${interfaceName}\\s*\\{`, "g"),
    ),
  );
  const [declaration] = declarations;

  if (declarations.length !== 1 || declaration?.index === undefined) {
    throw new Error(`Expected one exported ${interfaceName} interface`);
  }

  const bodyStart = declaration.index + declaration[0].length;
  const bodyEnd = source.indexOf("\n}", bodyStart);
  const body = source.slice(bodyStart, bodyEnd);
  const comments = Array.from(
    body.matchAll(
      new RegExp(`(\\/\\*\\*[\\s\\S]*?\\*\\/)\\s*${memberName}\\??\\s*:`, "g"),
    ),
    (match) => match[1] ?? "",
  );
  const [comment] = comments;

  if (bodyEnd < 0 || comments.length !== 1 || !comment) {
    throw new Error(`Expected one ${interfaceName}.${memberName} member`);
  }

  return comment;
}

/** Assert that a public React limit member documents default cursor pagination. */
function expectPublicReactPaginationTsdoc(
  source: string,
  interfaceName: string,
  cursorTarget: { interfaceName: string; memberName: string } = {
    interfaceName,
    memberName: "limit",
  },
): void {
  const limitTsdoc = collapseWhitespace(
    extractPublicMemberTsdoc(source, interfaceName, "limit"),
  );
  const cursorTsdoc = collapseWhitespace(
    extractPublicMemberTsdoc(
      source,
      cursorTarget.interfaceName,
      cursorTarget.memberName,
    ),
  );
  const paginationTsdoc = `${limitTsdoc} ${cursorTsdoc}`;

  expect(limitTsdoc).toMatch(/default[^.]*50 threads per page/i);
  expect(cursorTsdoc).toContain("`nextCursor`");
  expect(paginationTsdoc).not.toMatch(
    /(?:full list loads at once|Only meaningful when `limit` is set|When set, enables cursor-based pagination)/,
  );
}

function expectPageImmediatelyAfter(
  pages: unknown[],
  target: string,
  anchor: string,
): void {
  const anchorIndex = pages.indexOf(anchor);

  expect(anchorIndex).toBeGreaterThanOrEqual(0);
  expect(pages.filter((page) => page === target)).toHaveLength(1);
  expect(pages.indexOf(target)).toBe(anchorIndex + 1);
}

function findUnsafeManagedIdentifiers(
  canonicalGuide: string,
  entryPoints: string[],
): string[] {
  const environmentIdentifiers = [canonicalGuide, ...entryPoints].flatMap(
    (content) =>
      content.match(
        /(?<![A-Za-z0-9_])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?![A-Za-z0-9_])/g,
      ) ?? [],
  );

  return environmentIdentifiers.filter(
    (identifier) =>
      identifier !== "CPK_INTELLIGENCE_API_KEY" &&
      /(?:^|_)INTELLIGENCE_(?:API_KEY|API_URL|GATEWAY_WS_URL)(?:_|$)/.test(
        identifier,
      ),
  );
}

/** Extract destinations from Markdown link nodes in parsed MDX source. */
async function extractMarkdownLinkDestinations(
  content: string,
): Promise<string[]> {
  const destinations: string[] = [];
  const collectMarkdownLinks =
    () =>
    (tree: MdxAstNode): void => {
      const pending = [tree];

      while (pending.length > 0) {
        const node = pending.pop();
        if (!node) continue;

        if (node.type === "link" && typeof node.url === "string") {
          destinations.push(node.url);
        }
        if (node.children) {
          for (let index = node.children.length - 1; index >= 0; index -= 1) {
            const child = node.children[index];
            if (child) pending.push(child);
          }
        }
      }
    };

  await serialize(content, {
    parseFrontmatter: true,
    mdxOptions: { remarkPlugins: [remarkGfm, collectMarkdownLinks] },
  });

  return destinations;
}

/** Extract executable MDX ESM, expressions, and JSX outside code fences. */
async function extractExecutableMdx(content: string): Promise<string> {
  const pieces: string[] = [];
  const valueNodeTypes = new Set([
    "mdxjsEsm",
    "mdxFlowExpression",
    "mdxTextExpression",
    "mdxJsxAttributeValueExpression",
  ]);
  const jsxNodeTypes = new Set(["mdxJsxFlowElement", "mdxJsxTextElement"]);
  const collectExecutableMdx =
    () =>
    (tree: MdxAstNode): void => {
      const pending = [tree];

      while (pending.length > 0) {
        const node = pending.pop();
        if (!node) continue;

        if (
          valueNodeTypes.has(node.type ?? "") &&
          typeof node.value === "string"
        ) {
          pieces.push(node.value);
        }
        if (
          jsxNodeTypes.has(node.type ?? "") &&
          typeof node.name === "string"
        ) {
          pieces.push(`<${node.name} />`);
        }
        if (node.children) pending.push(...node.children);
        if (node.attributes) pending.push(...node.attributes);
        if (typeof node.value === "object" && node.value !== null) {
          pending.push(node.value as MdxAstNode);
        }
      }
    };

  await serialize(content, {
    parseFrontmatter: true,
    mdxOptions: { remarkPlugins: [remarkGfm, collectExecutableMdx] },
  });

  return pieces.join("\n");
}

/** Assert that contradictory archive and delete claims are absent. */
function expectNoThreadRemovalContradictions(content: string): void {
  expect(content).not.toMatch(
    /\b(?:archive(?:Thread)?|archived|archiving)\b[^.]*\bsoft[ -]?delet(?:e[sd]?|ing)\b/i,
  );
  const positiveClaims = content.replace(
    /\b(?:does\s+not|never)\s+(?:permanently|physically)\s+(?:remov(?:e[sd]?|ing)|delet(?:e[sd]?|ing))\b/gi,
    "retains",
  );

  expect(positiveClaims).not.toMatch(
    /\b(?:permanent(?:ly)?|physically)\s+(?:remov(?:e[sd]?|ing)|delet(?:e[sd]?|ing))\b|\b(?:delete(?:Thread)?|deleted|deleting|deletion)\b[^.]*\b(?:permanent(?:ly)?|physically)\b[^.]*\b(?:remov(?:e[sd]?|ing)|delet(?:e[sd]?|ing))\b|\b(?:row|record|history)\b[^.]*\b(?:removed?|deleted?)\b[^.]*\b(?:entirely|physically)\b/i,
  );
}

/** Assert that a frontend guide links onward without rendering React-only code. */
async function expectFrameworkNativeGuide(
  variant: (typeof hostedGuideVariants)[number],
  wrapperContent: string,
  renderedContent: string,
): Promise<void> {
  const linkDestinations = (
    await extractMarkdownLinkDestinations(wrapperContent)
  ).map((destination) => destination.split(/[?#]/, 1)[0]);
  const executableCode = [
    ...extractMdxCodeFences(renderedContent)
      .filter((fence) =>
        /^(?:[cm]?[jt]sx?|javascript|typescript|vue)$/.test(fence.language),
      )
      .map((fence) => fence.content),
    await extractExecutableMdx(renderedContent),
  ].join("\n");
  const allowedReactPackages = new Set<string>(
    variant.name === "React Native" ? ["react-native"] : [],
  );
  const reactPackages = [
    ...executableCode.matchAll(
      /["']@copilotkit\/(react(?:-[a-z0-9-]+)?)(?:\/[^"']*)?["']/g,
    ),
  ].map((match) => match[1]);

  expect(linkDestinations).toContain(variant.handoff);
  expect(
    reactPackages.filter(
      (packageName) => !allowedReactPackages.has(packageName),
    ),
  ).toEqual([]);
  expect(executableCode).not.toMatch(
    variant.name === "Angular"
      ? /\b[A-Za-z_$][\w$]*\.(?:CopilotKitProvider|CopilotThreadsDrawer|useThreads)\b|<(?:CopilotKitProvider|CopilotThreadsDrawer)\b|\buseThreads\s*\(/
      : /\b[A-Za-z_$][\w$]*\.(?:CopilotKitProvider|CopilotThreadsDrawer)\b|<(?:CopilotKitProvider|CopilotThreadsDrawer)\b/,
  );
}

test("extracts destinations only from rendered Markdown links", async () => {
  const renderedDestination = `${canonicalGuidePath}?source=entry#runtime`;
  const content = [
    `[rendered](${renderedDestination})`,
    `\`[inline code](${canonicalGuidePath})\``,
    String.raw`\[escaped link](${canonicalGuidePath})`,
    `![image](${canonicalGuidePath})`,
    `{/* [MDX comment](${canonicalGuidePath}) */}`,
    "```md",
    `[backtick fence](${canonicalGuidePath})`,
    "```",
    "~~~md",
    `[tilde fence](${canonicalGuidePath})`,
    "~~~",
  ].join("\n");

  const destinations = await extractMarkdownLinkDestinations(content);

  expect(destinations).toEqual([renderedDestination]);
});

test("keeps links inside a shorter nested fence non-rendered", async () => {
  const content = [
    "````md",
    "```md",
    `[nested example](${canonicalGuidePath})`,
    "```",
    "````",
  ].join("\n");

  expect(await extractMarkdownLinkDestinations(content)).toEqual([]);
});

test("ignores Markdown-looking links in MDX expressions and JSX props", async () => {
  const content = [
    `<Callout note="[JSX prop](${canonicalGuidePath})" />`,
    `{"[MDX expression](${canonicalGuidePath})"}`,
  ].join("\n");

  expect(await extractMarkdownLinkDestinations(content)).toEqual([]);
});

test("honors escaped backticks and backslash parity around rendered links", async () => {
  const content = [
    String.raw`\`[escaped backticks](${canonicalGuidePath})\``,
    String.raw`\\[even backslashes](${canonicalGuidePath})`,
    String.raw`\[one backslash](${canonicalGuidePath})`,
    String.raw`\\\[odd backslashes](${canonicalGuidePath})`,
  ].join("\n");

  expect(await extractMarkdownLinkDestinations(content)).toEqual([
    canonicalGuidePath,
    canonicalGuidePath,
  ]);
});

test("rejects React-only APIs in shared code rendered by frontend guides", async () => {
  const variant = hostedGuideVariants[0];
  const wrapperContent = `[Continue](${variant.handoff})`;
  const renderedContent = `${wrapperContent}\n\n\`\`\`tsx\nimport { CopilotKitProvider } from "@copilotkit/react-core/v2";\n\`\`\``;

  await expect(
    expectFrameworkNativeGuide(variant, wrapperContent, renderedContent),
  ).rejects.toThrow();
});

test.each([
  [
    "a namespace import",
    'import * as ReactCore from "@copilotkit/react-core/v2";',
  ],
  ["a default import", 'import ReactCore from "@copilotkit/react-core/v2";'],
  [
    "an aliased public headless hook",
    'import { useThreads as useThreadList } from "@copilotkit/react-core/v2/headless";',
  ],
  ["a member-qualified API", "const Drawer = ReactCore.CopilotThreadsDrawer;"],
])(
  "rejects React-only APIs expressed through %s",
  async (_caseName, reactOnlyCode) => {
    const variant = hostedGuideVariants[0];
    const wrapperContent = `[Continue](${variant.handoff})`;
    const renderedContent = `${wrapperContent}\n\n\`\`\`tsx\n${reactOnlyCode}\n\`\`\``;

    await expect(
      expectFrameworkNativeGuide(variant, wrapperContent, renderedContent),
    ).rejects.toThrow();
  },
);

test.each([
  ["Angular", "@copilotkit/react-ui"],
  ["Angular", "@copilotkit/react-textarea"],
  ["Vue", "@copilotkit/react-native"],
  ["React Native", "@copilotkit/react-ui"],
] as const)(
  "the %s hosted guide rejects the %s package",
  async (variantName, packageName) => {
    const variant = hostedGuideVariants.find(
      ({ name }) => name === variantName,
    );

    expect(variant).toBeDefined();
    if (!variant) return;

    const wrapperContent = `[Continue](${variant.handoff})`;
    const renderedContent = `${wrapperContent}\n\n\`\`\`ts\nimport { NativeSurface } from "${packageName}";\n\`\`\``;

    await expect(
      expectFrameworkNativeGuide(variant, wrapperContent, renderedContent),
    ).rejects.toThrow();
  },
);

test("allows the React Native package in the React Native hosted guide", async () => {
  const variant = hostedGuideVariants.find(
    ({ name }) => name === "React Native",
  );

  expect(variant).toBeDefined();
  if (!variant) return;

  const wrapperContent = `[Continue](${variant.handoff})`;
  const renderedContent = `${wrapperContent}\n\n\`\`\`ts\nimport { useThreads } from "@copilotkit/react-native/headless";\nconst threads = useThreads({ agentId: "default" });\nvoid threads;\n\`\`\``;

  await expectFrameworkNativeGuide(variant, wrapperContent, renderedContent);
});

test("rejects React imports in executable Vue code fences", async () => {
  const variant = hostedGuideVariants.find(({ name }) => name === "Vue");

  expect(variant).toBeDefined();
  if (!variant) return;

  const wrapperContent = `[Continue](${variant.handoff})`;
  const renderedContent = `${wrapperContent}\n\n\`\`\`vue\n<script setup lang="ts">\nimport { useThreads } from "@copilotkit/react-core/v2";\nuseThreads({ agentId: "default" });\n</script>\n\`\`\``;

  await expect(
    expectFrameworkNativeGuide(variant, wrapperContent, renderedContent),
  ).rejects.toThrow();
});

test.each([
  [
    "an ESM import",
    'import { useThreads as useThreadList } from "@copilotkit/react-core/v2/headless";',
  ],
  ["a JSX element", "<CopilotThreadsDrawer />"],
  ["an MDX expression", '{useThreads({ agentId: "default" })}'],
])(
  "rejects React-only APIs in executable MDX through %s",
  async (_caseName, reactOnlySource) => {
    const variant = hostedGuideVariants[0];
    const wrapperContent = `[Continue](${variant.handoff})`;
    const renderedContent = `${wrapperContent}\n\n${reactOnlySource}`;

    await expect(
      expectFrameworkNativeGuide(variant, wrapperContent, renderedContent),
    ).rejects.toThrow();
  },
);

test("accepts React-only API names in non-executable MDX prose", async () => {
  const variant = hostedGuideVariants[0];
  const wrapperContent = `[Continue](${variant.handoff})`;
  const renderedContent = `${wrapperContent}\n\nThe React guide covers CopilotThreadsDrawer and useThreads.`;

  await expectFrameworkNativeGuide(variant, wrapperContent, renderedContent);
});

test("accepts non-React executable MDX outside code fences", async () => {
  const variant = hostedGuideVariants[0];
  const wrapperContent = `[Continue](${variant.handoff})`;
  const renderedContent = [
    'import { Callout } from "@/components/Callout";',
    "",
    wrapperContent,
    "",
    '<Callout title="Native guide">{1 + 1}</Callout>',
  ].join("\n");

  await expectFrameworkNativeGuide(variant, wrapperContent, renderedContent);
});

test("does not treat a Markdown fence as executable frontend code", async () => {
  const variant = hostedGuideVariants[0];
  const wrapperContent = `[Continue](${variant.handoff})`;
  const renderedContent = [
    wrapperContent,
    "",
    "```md",
    "Mention `useThreads()` when linking to the React guide.",
    "```",
  ].join("\n");

  await expectFrameworkNativeGuide(variant, wrapperContent, renderedContent);
});

test.each([
  "Archived threads are soft-deleted.",
  "Deleted threads are permanently removed.",
  "The platform permanently removes the stored row.",
])("rejects the removal contradiction: %s", (contradiction) => {
  expect(() => expectNoThreadRemovalContradictions(contradiction)).toThrow();
});

test.each([
  "Deleting a thread does not permanently remove the stored row.",
  "Deleting a thread never physically removes the stored row.",
])("accepts the negated retention claim: %s", (retentionClaim) => {
  expect(() =>
    expectNoThreadRemovalContradictions(retentionClaim),
  ).not.toThrow();
});

/** Assert that MDX source links to the canonical guide path. */
async function expectCanonicalGuideLink(content: string): Promise<void> {
  const destinations = await extractMarkdownLinkDestinations(content);

  expect(
    destinations.some(
      (destination) => destination.split(/[?#]/, 1)[0] === canonicalGuidePath,
    ),
  ).toBe(true);
}

/** Assert that each owned entry point omits its retired setup syntax. */
function expectNoRetiredThreadSetup(
  contentsByPath: ReadonlyMap<string, string>,
): void {
  expect(contentsByPath.has(drawerEntryPointPath)).toBe(true);
  expect(contentsByPath.has(headlessEntryPointPath)).toBe(true);

  const executableModels = (content: string): TypeScriptModel[] => {
    const fences = extractMdxCodeFences(content).filter((fence) =>
      /^(?:[cm]?[jt]sx?|javascript|typescript)$/.test(fence.language),
    );
    return (
      fences.length > 0 ? fences.map((fence) => fence.content) : [content]
    ).map((source) => parseTypeScriptModel(source));
  };
  const retiredDrawerProps: string[] = [];
  for (const model of executableModels(
    contentsByPath.get(drawerEntryPointPath) ?? "",
  )) {
    visitTypeScript(model, (node) => {
      if (!ts.isJsxOpeningLikeElement(node)) return;
      for (const attribute of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(model) === "publicLicenseKey"
        ) {
          retiredDrawerProps.push(attribute.name.getText(model));
        } else if (ts.isJsxSpreadAttribute(attribute)) {
          const expression = unwrapTypeScriptExpression(attribute.expression);
          if (
            ts.isObjectLiteralExpression(expression) &&
            expression.properties.some(
              (property) =>
                property.name !== undefined &&
                getStaticTypeScriptName(property.name) === "publicLicenseKey",
            )
          ) {
            retiredDrawerProps.push("publicLicenseKey");
          }
        }
      }
    });
  }
  expect(retiredDrawerProps).toEqual([]);

  const runtimeViolations: string[] = [];
  for (const model of executableModels(
    contentsByPath.get(headlessEntryPointPath) ?? "",
  )) {
    visitTypeScript(model, (node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        /^@copilotkit\/runtime(?:\/|$)/.test(node.moduleSpecifier.text)
      ) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            if (
              (binding.propertyName ?? binding.name).text === "CopilotRuntime"
            ) {
              runtimeViolations.push(binding.name.text);
            }
          }
        }
      }
      if (ts.isNewExpression(node)) {
        const expression = node.expression;
        if (
          (ts.isIdentifier(expression) &&
            expression.text === "CopilotRuntime") ||
          (ts.isPropertyAccessExpression(expression) &&
            expression.name.text === "CopilotRuntime")
        ) {
          runtimeViolations.push(expression.getText(model));
        }
      }
    });
  }
  expect(runtimeViolations).toEqual([]);
}

/** Build the path-keyed entry-point fixture used by retired-code checks. */
function createEntryPointFixture(
  drawerContent: string,
  headlessContent: string,
  reverseOrder = false,
): ReadonlyMap<string, string> {
  const drawerEntry = [drawerEntryPointPath, drawerContent] as const;
  const headlessEntry = [headlessEntryPointPath, headlessContent] as const;

  return new Map(
    reverseOrder ? [headlessEntry, drawerEntry] : [drawerEntry, headlessEntry],
  );
}

/** Extract Markdown code fences with their language and optional title. */
function extractMdxCodeFences(content: string): MdxCodeFence[] {
  const lines = content.split(/\r?\n/);
  const fences: MdxCodeFence[] = [];

  for (let openingIndex = 0; openingIndex < lines.length; openingIndex += 1) {
    const opening = lines[openingIndex]?.match(
      /^[ \t]*(`{3,}|~{3,})[ \t]*([^\r\n]*)$/,
    );
    if (!opening) continue;

    const openingMarker = opening[1] ?? "";
    let closingIndex = -1;

    for (
      let candidateIndex = openingIndex + 1;
      candidateIndex < lines.length;
      candidateIndex += 1
    ) {
      const closingMarker =
        lines[candidateIndex]?.match(/^[ \t]*(`+|~+)[ \t]*$/)?.[1] ?? "";
      if (
        closingMarker.startsWith(openingMarker[0] ?? "") &&
        closingMarker.length >= openingMarker.length
      ) {
        closingIndex = candidateIndex;
        break;
      }
    }

    if (closingIndex < 0) break;

    const info = (opening[2] ?? "").trim();
    const titleMatch = info.match(/\btitle=(?:"([^"]+)"|'([^']+)')/);
    const bodyLines = lines.slice(openingIndex + 1, closingIndex);

    fences.push({
      language: info.split(/\s+/, 1)[0] ?? "",
      title: titleMatch?.[1] ?? titleMatch?.[2],
      content: `${bodyLines.join("\n")}${bodyLines.length > 0 ? "\n" : ""}`,
    });
    openingIndex = closingIndex;
  }

  return fences;
}

test("parses a code fence closed by a longer delimiter", () => {
  const content = [
    '```tsx title="example.tsx"',
    "export const example = true;",
    "````",
  ].join("\n");

  expect(extractMdxCodeFences(content)).toEqual([
    {
      language: "tsx",
      title: "example.tsx",
      content: "export const example = true;\n",
    },
  ]);
});

/** Return the sole code fence with the requested language, title, and marker. */
function findMdxCodeFence(
  fences: MdxCodeFence[],
  language: string,
  title: string,
  marker?: string,
): string {
  const matches = fences.filter(
    (fence) =>
      fence.language === language &&
      fence.title === title &&
      (!marker || fence.content.includes(marker)),
  );
  const [match] = matches;

  if (matches.length !== 1 || !match) {
    throw new Error(
      `Expected one ${language} fence titled ${title}${marker ? ` containing ${marker}` : ""}`,
    );
  }

  return match.content;
}

/** Return the sole CLI snippet fence with the requested language and title. */
function findCliCodeFence(language: string, title: string): string {
  return findMdxCodeFence(
    extractMdxCodeFences(readContent("snippets/shared/cli/cli.mdx")),
    language,
    title,
  );
}

/** Assert that a React Router route delegates its native loader/action surface to the Fetch handler. */
function expectReactRouterAdapterContract(routeSource: string): void {
  expect(routeSource).toMatch(
    /import type \{ Route \} from ["']\.\/\+types\/api\.copilotkit\.\$["'];/,
  );
  expect(routeSource).toMatch(
    /export async function loader\(\{ request \}: Route\.LoaderArgs\) \{\s*return handler\(request\);\s*\}/,
  );
  expect(routeSource).toMatch(
    /export async function action\(\{ request \}: Route\.ActionArgs\) \{\s*return handler\(request\);\s*\}/,
  );

  const model = parseTypeScriptModel(routeSource, "react-router-route.ts");
  const exportedNames = new Set<string>();
  const collectBindingNames = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      exportedNames.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) collectBindingNames(element.name);
    }
  };

  for (const statement of model.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          exportedNames.add(element.name.text);
        }
      }
      continue;
    }
    if (!isExportedDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      exportedNames.add(statement.name.text);
    }
  }

  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    expect(exportedNames).not.toContain(method);
  }
}

/** Assert executable authentication inside the `onRequest` callback. */
function expectExecutableOnRequestAuth(source: string): void {
  const model = parseTypeScriptModel(source, "runtime-route.ts");
  const callbacks: ts.ArrowFunction[] = [];

  visitTypeScript(model, (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      getTypeScriptName(node.name) === "onRequest" &&
      ts.isArrowFunction(node.initializer) &&
      ts.isBlock(node.initializer.body)
    ) {
      callbacks.push(node.initializer);
    }
  });

  const [callback] = callbacks;
  if (!callback || callbacks.length !== 1 || !ts.isBlock(callback.body)) {
    throw new Error("Expected one onRequest callback body");
  }

  const isUnauthorizedResponse = (expression: ts.Expression): boolean => {
    const response = unwrapTypeScriptExpression(expression);
    if (
      !ts.isNewExpression(response) ||
      !ts.isIdentifier(response.expression) ||
      response.expression.text !== "Response"
    ) {
      return false;
    }

    const initArgument = response.arguments?.[1];
    if (!initArgument) return false;

    const init = unwrapTypeScriptExpression(initArgument);
    if (!ts.isObjectLiteralExpression(init)) return false;

    const hasAmbiguousOverride = init.properties.some(
      (property) =>
        ts.isSpreadAssignment(property) ||
        getStaticTypeScriptName(property.name) === undefined,
    );
    const statusProperties = init.properties.filter(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) &&
        getStaticTypeScriptName(property.name) === "status",
    );
    const [statusProperty] = statusProperties;
    const status = statusProperty
      ? unwrapTypeScriptExpression(statusProperty.initializer)
      : undefined;

    return (
      !hasAmbiguousOverride &&
      statusProperties.length === 1 &&
      !!status &&
      ts.isNumericLiteral(status) &&
      status.text === "401"
    );
  };

  const [callbackParameter] = callback.parameters;
  const [requestBinding] =
    callbackParameter && ts.isObjectBindingPattern(callbackParameter.name)
      ? callbackParameter.name.elements
      : [];
  const hasRequestParameter =
    callback.parameters.length === 1 &&
    !!callbackParameter &&
    ts.isObjectBindingPattern(callbackParameter.name) &&
    callbackParameter.name.elements.length === 1 &&
    !!requestBinding &&
    !requestBinding.propertyName &&
    !requestBinding.dotDotDotToken &&
    ts.isIdentifier(requestBinding.name) &&
    requestBinding.name.text === "request";
  const [verifierStatement, guardStatement] = callback.body.statements;
  const [verifiedDeclaration] =
    verifierStatement && ts.isVariableStatement(verifierStatement)
      ? verifierStatement.declarationList.declarations
      : [];
  const verifierInitializer = verifiedDeclaration?.initializer
    ? unwrapTypeScriptExpression(verifiedDeclaration.initializer)
    : undefined;
  const awaited =
    verifierInitializer && ts.isAwaitExpression(verifierInitializer)
      ? unwrapTypeScriptExpression(verifierInitializer.expression)
      : undefined;
  const hasVerifiedDeclaration =
    !!verifierStatement &&
    ts.isVariableStatement(verifierStatement) &&
    verifierStatement.declarationList.declarations.length === 1 &&
    (verifierStatement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
    !!verifiedDeclaration &&
    ts.isIdentifier(verifiedDeclaration.name) &&
    verifiedDeclaration.name.text === "user" &&
    !!awaited &&
    ts.isCallExpression(awaited) &&
    ts.isIdentifier(awaited.expression) &&
    awaited.expression.text === "getVerifiedAppUser" &&
    awaited.arguments.length === 1 &&
    ts.isIdentifier(awaited.arguments[0]) &&
    awaited.arguments[0].text === "request";
  const [firstBranchStatement] =
    guardStatement &&
    ts.isIfStatement(guardStatement) &&
    ts.isBlock(guardStatement.thenStatement)
      ? guardStatement.thenStatement.statements
      : [];
  const hasBound401Exit =
    hasVerifiedDeclaration &&
    !!verifiedDeclaration &&
    ts.isIdentifier(verifiedDeclaration.name) &&
    !!guardStatement &&
    ts.isIfStatement(guardStatement) &&
    ts.isPrefixUnaryExpression(guardStatement.expression) &&
    guardStatement.expression.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isIdentifier(guardStatement.expression.operand) &&
    guardStatement.expression.operand.text === verifiedDeclaration.name.text &&
    !!firstBranchStatement &&
    ts.isThrowStatement(firstBranchStatement) &&
    !!firstBranchStatement.expression &&
    isUnauthorizedResponse(firstBranchStatement.expression);

  expect(
    hasRequestParameter &&
      callback.body.statements.length === 2 &&
      hasBound401Exit,
  ).toBe(true);
}

/** Assert that `identifyUser` returns the identity produced by the verifier. */
function expectExecutableIdentifyUser(source: string): void {
  const model = parseTypeScriptModel(source, "runtime-route.ts");
  const callbacks: ts.ArrowFunction[] = [];

  visitTypeScript(model, (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      getTypeScriptName(node.name) === "identifyUser" &&
      ts.isArrowFunction(node.initializer) &&
      ts.isBlock(node.initializer.body)
    ) {
      callbacks.push(node.initializer);
    }
  });

  const [callback] = callbacks;
  if (!callback || callbacks.length !== 1 || !ts.isBlock(callback.body)) {
    throw new Error("Expected one identifyUser callback body");
  }

  const [parameter] = callback.parameters;
  const [declarationStatement, guardStatement, returnStatement] =
    callback.body.statements;
  const [declaration] =
    declarationStatement && ts.isVariableStatement(declarationStatement)
      ? declarationStatement.declarationList.declarations
      : [];
  const initializer = declaration?.initializer
    ? unwrapTypeScriptExpression(declaration.initializer)
    : undefined;
  const verifierCall =
    initializer && ts.isAwaitExpression(initializer)
      ? unwrapTypeScriptExpression(initializer.expression)
      : undefined;
  const [guardExit] =
    guardStatement &&
    ts.isIfStatement(guardStatement) &&
    ts.isBlock(guardStatement.thenStatement)
      ? guardStatement.thenStatement.statements
      : [];
  const returned =
    returnStatement && ts.isReturnStatement(returnStatement)
      ? returnStatement.expression
      : undefined;
  const returnedObject = returned
    ? unwrapTypeScriptExpression(returned)
    : undefined;
  const returnedMembers = new Map<string, string>();
  if (returnedObject && ts.isObjectLiteralExpression(returnedObject)) {
    for (const property of returnedObject.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = getStaticTypeScriptName(property.name);
      const value = unwrapTypeScriptExpression(property.initializer);
      if (
        name &&
        ts.isPropertyAccessExpression(value) &&
        ts.isIdentifier(value.expression)
      ) {
        returnedMembers.set(
          name,
          `${value.expression.text}.${value.name.text}`,
        );
      }
    }
  }

  expect(
    callback.parameters.length === 1 &&
      !!parameter &&
      ts.isIdentifier(parameter.name) &&
      parameter.name.text === "request" &&
      callback.body.statements.length === 3 &&
      !!declarationStatement &&
      ts.isVariableStatement(declarationStatement) &&
      (declarationStatement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
      declarationStatement.declarationList.declarations.length === 1 &&
      !!declaration &&
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === "user" &&
      !!verifierCall &&
      ts.isCallExpression(verifierCall) &&
      ts.isIdentifier(verifierCall.expression) &&
      verifierCall.expression.text === "getVerifiedAppUser" &&
      verifierCall.arguments.length === 1 &&
      ts.isIdentifier(verifierCall.arguments[0]) &&
      verifierCall.arguments[0].text === "request" &&
      !!guardStatement &&
      ts.isIfStatement(guardStatement) &&
      ts.isPrefixUnaryExpression(guardStatement.expression) &&
      guardStatement.expression.operator === ts.SyntaxKind.ExclamationToken &&
      ts.isIdentifier(guardStatement.expression.operand) &&
      guardStatement.expression.operand.text === "user" &&
      !!guardExit &&
      ts.isThrowStatement(guardExit) &&
      returnedMembers.size === 2 &&
      returnedMembers.get("id") === "user.id" &&
      returnedMembers.get("name") === "user.name",
  ).toBe(true);
}

/** Return the static JSX tag name for one element. */
function getJsxTagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const tag = ts.isJsxElement(node)
    ? node.openingElement.tagName
    : node.tagName;
  return tag.getText().split(".").at(-1) ?? "";
}

/** Return JSX elements nested under a node, excluding comments. */
function getNestedJsxElements(
  node: ts.Node,
): Array<ts.JsxElement | ts.JsxSelfClosingElement> {
  const elements: Array<ts.JsxElement | ts.JsxSelfClosingElement> = [];
  ts.forEachChild(node, (child) => {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      elements.push(child);
    }
    elements.push(...getNestedJsxElements(child));
  });
  return elements;
}

/** Assert the executable Runtime and handler declarations in the server route. */
function expectCanonicalServerRoute(source: string): void {
  const model = parseTypeScriptModel(source, "runtime-route.ts");
  let runtimeHasAgents = false;
  let handlerHasBasePath = false;

  visitTypeScript(model, (node) => {
    if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression)) return;
    if (node.expression.text !== "CopilotRuntime") return;
    const [argument] = node.arguments ?? [];
    if (!argument || !ts.isObjectLiteralExpression(argument)) return;
    runtimeHasAgents = argument.properties.some(
      (property) =>
        (ts.isShorthandPropertyAssignment(property) &&
          property.name.text === "agents") ||
        (ts.isPropertyAssignment(property) &&
          getStaticTypeScriptName(property.name) === "agents" &&
          ts.isIdentifier(unwrapTypeScriptExpression(property.initializer)) &&
          (unwrapTypeScriptExpression(property.initializer) as ts.Identifier)
            .text === "agents"),
    );
  });

  visitTypeScript(model, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== "createCopilotRuntimeHandler"
    ) {
      return;
    }
    const [argument] = node.arguments;
    if (!argument || !ts.isObjectLiteralExpression(argument)) return;
    handlerHasBasePath = argument.properties.some((property) => {
      if (
        !ts.isPropertyAssignment(property) ||
        getStaticTypeScriptName(property.name) !== "basePath"
      ) {
        return false;
      }
      const value = unwrapTypeScriptExpression(property.initializer);
      return ts.isStringLiteral(value) && value.text === "/api/copilotkit";
    });
  });

  const exportedHandlerMethods = new Set<string>();
  for (const statement of model.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !isExportedDeclaration(statement)
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        ts.isIdentifier(unwrapTypeScriptExpression(declaration.initializer)) &&
        (unwrapTypeScriptExpression(declaration.initializer) as ts.Identifier)
          .text === "handler"
      ) {
        exportedHandlerMethods.add(declaration.name.text);
      }
    }
  }

  expect(runtimeHasAgents).toBe(true);
  expect(handlerHasBasePath).toBe(true);
  expect(exportedHandlerMethods).toEqual(
    new Set(["GET", "POST", "PATCH", "DELETE"]),
  );
}

/** Assert the executable provider hierarchy in the client example. */
function expectCanonicalClientTree(source: string): void {
  const model = parseTypeScriptModel(source, "app-page.tsx");
  const provider = getNestedJsxElements(model).find(
    (element) => getJsxTagName(element) === "CopilotKitProvider",
  );
  expect(provider).toBeDefined();
  if (!provider) return;

  const attributes = ts.isJsxElement(provider)
    ? provider.openingElement.attributes.properties
    : provider.attributes.properties;
  const attributeValues = new Map<string, string>();
  for (const attribute of attributes) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = attribute.name.getText(model);
    const initializer = attribute.initializer;
    if (initializer && ts.isStringLiteral(initializer)) {
      attributeValues.set(name, initializer.text);
    } else if (
      initializer &&
      ts.isJsxExpression(initializer) &&
      initializer.expression
    ) {
      attributeValues.set(name, initializer.expression.getText(model));
    }
  }
  expect(attributeValues.get("runtimeUrl")).toBe("/api/copilotkit");
  expect(attributeValues.get("useSingleEndpoint")).toBe("false");

  const configurations = getNestedJsxElements(provider).filter(
    (element) => getJsxTagName(element) === "CopilotChatConfigurationProvider",
  );
  expect(configurations).toHaveLength(1);
  const [configuration] = configurations;
  if (!configuration) return;
  const children = getNestedJsxElements(configuration).map(getJsxTagName);
  expect(
    children.filter((name) => name === "CopilotThreadsDrawer"),
  ).toHaveLength(1);
  expect(children.filter((name) => name === "CopilotChat")).toHaveLength(1);
}

/** Return explicit agent ID overrides on the hosted React thread surfaces. */
function extractHostedAgentIdOverrides(source: string): string[] {
  const model = parseTypeScriptModel(source);
  const managedSurfaceNames = getManagedReactSurfaceNames(model);
  const unknownAgentId = "<dynamic-agent-id>";
  const values: string[] = [];
  const readExpression = (expression: ts.Expression): string => {
    const unwrapped = unwrapTypeScriptExpression(expression);
    if (
      ts.isStringLiteral(unwrapped) ||
      ts.isNoSubstitutionTemplateLiteral(unwrapped)
    ) {
      return unwrapped.text;
    }
    return unknownAgentId;
  };
  visitTypeScript(model, (node) => {
    if (!ts.isJsxOpeningLikeElement(node)) return;
    const tagName = node.tagName.getText(model).split(".").at(-1);
    if (!tagName || !managedSurfaceNames.has(tagName)) return;
    for (const attribute of node.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        values.push(unknownAgentId);
      } else if (attribute.name.getText(model) === "agentId") {
        const initializer = attribute.initializer;
        if (!initializer) {
          values.push(unknownAgentId);
        } else if (ts.isStringLiteral(initializer)) {
          values.push(initializer.text);
        } else if (ts.isJsxExpression(initializer) && initializer.expression) {
          values.push(readExpression(initializer.expression));
        } else {
          values.push(unknownAgentId);
        }
      }
    }
  });
  return values;
}

/** Assert that the executable client page contains no managed server secrets. */
function expectNoManagedClientSecrets(source: string): void {
  const model = parseTypeScriptModel(source, "app-page.tsx");
  const forbiddenIdentifier =
    /^(?:CPK_INTELLIGENCE_(?:API_KEY|API_URL|GATEWAY_WS_URL)|COPILOTKIT_LICENSE_TOKEN)$/;
  const forbiddenValue =
    /^(?:CPK_INTELLIGENCE_(?:API_KEY|API_URL|GATEWAY_WS_URL)|COPILOTKIT_LICENSE_TOKEN)$/;
  const forbiddenHostedUrl =
    /^(?:https:\/\/api\.intelligence\.copilotkit\.ai|wss:\/\/realtime\.intelligence\.copilotkit\.ai)(?::443)?(?=$|[/?#])/i;
  const forbiddenBrowserProp =
    /^(?:publicApiKey|publicLicenseKey|licenseToken)$/;
  const violations: string[] = [];
  const managedSurfaceNames = getManagedReactSurfaceNames(model);

  visitTypeScript(model, (node) => {
    if (ts.isIdentifier(node) && forbiddenIdentifier.test(node.text)) {
      violations.push(node.text);
    }
    const literalValue =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : ts.isTemplateExpression(node)
          ? node.head.text
          : undefined;
    if (
      literalValue &&
      (forbiddenValue.test(literalValue) ||
        forbiddenHostedUrl.test(literalValue))
    ) {
      violations.push(literalValue);
    }
    if (!ts.isJsxOpeningLikeElement(node)) return;

    const tagName = node.tagName.getText(model).split(".").at(-1);
    if (!tagName || !managedSurfaceNames.has(tagName)) return;

    for (const attribute of node.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        violations.push("<managed-target-spread>");
      } else if (forbiddenBrowserProp.test(attribute.name.getText(model))) {
        violations.push(attribute.name.getText(model));
      }
    }
  });

  expect(violations).toEqual([]);
}

/** Assert that every explicit chat-side agent ID matches the thread list. */
function expectHostedAgentIdOverrides(source: string, expected: string): void {
  const overrides = extractHostedAgentIdOverrides(source);
  expect(overrides).not.toHaveLength(0);
  expect(overrides.every((agentId) => agentId === expected)).toBe(true);
}

/** Assert the canonical guide's managed Runtime, auth, and UI contracts. */
function expectCanonicalGuideContracts(guide: string): void {
  const { data: frontmatter, content } = matter(guide);
  const fences = extractMdxCodeFences(content);
  const serverRoute = findMdxCodeFence(
    fences,
    "ts",
    "app/api/copilotkit/[[...slug]]/route.ts",
  );
  const appPage = findMdxCodeFence(fences, "tsx", "app/page.tsx");

  for (const fence of fences) {
    if (
      /^(?:[cm]?[jt]sx?|javascript|typescript)$/.test(fence.language) &&
      /^\s*["']use client["'];/m.test(fence.content)
    ) {
      expectNoManagedClientSecrets(fence.content);
    }
  }

  expect(frontmatter.doc_type).toBe("how-to");
  expect(content).toContain('surface="docs_existing_app_hosted_intelligence"');
  expect(content).toContain("CPK_TELEMETRY_ID");
  expect(content).toContain("two real app accounts");
  expect(content).toContain(
    "The ID must be 1–128 characters and may contain only ASCII letters (`A`–`Z` and `a`–`z`), ASCII digits (`0`–`9`), `_`, `.`, `@`, `:`, `=`, or `-`.",
  );
  expect(content).toContain(`${runnerException} ${runtimeSetupLead}`);

  expect(serverRoute).toMatch(
    /const intelligenceApiKey\s*=\s*process\.env\.CPK_INTELLIGENCE_API_KEY\?\.trim\(\);/,
  );
  expect(serverRoute).not.toContain("runner");
  expect(serverRoute).toMatch(
    /if\s*\(!intelligenceApiKey\)\s*\{\s*throw new Error\("CPK_INTELLIGENCE_API_KEY is required"\);\s*\}/,
  );
  expect(serverRoute).toContain("const runtime = new CopilotRuntime({");
  expect(serverRoute).toContain("intelligence: new CopilotKitIntelligence({");
  expect(serverRoute).toContain("apiKey: intelligenceApiKey");
  expect(serverRoute).toContain(
    'apiUrl: "https://api.intelligence.copilotkit.ai"',
  );
  expect(serverRoute).toContain(
    'wsUrl: "wss://realtime.intelligence.copilotkit.ai"',
  );
  expectExecutableIdentifyUser(serverRoute);
  expectExecutableOnRequestAuth(serverRoute);
  expectCanonicalServerRoute(serverRoute);
  expectCanonicalClientTree(appPage);
  expect(
    new Set(extractHostedAgentIdOverrides(appPage)).size,
  ).toBeLessThanOrEqual(1);
}

test("lists the existing-app guide in both Intelligence navigation files", () => {
  const rootMeta = JSON.parse(readContent("docs/meta.json")) as {
    pages: unknown[];
  };
  const premiumMeta = JSON.parse(readContent("docs/premium/meta.json")) as {
    pages: unknown[];
  };

  expectPageImmediatelyAfter(
    rootMeta.pages,
    "premium/existing-app-hosted-intelligence",
    "premium/managed-intelligence-platform",
  );
  expectPageImmediatelyAfter(
    premiumMeta.pages,
    "existing-app-hosted-intelligence",
    "managed-intelligence-platform",
  );
});

test.each([
  {
    caseName: "a missing anchor when the target is first",
    pages: ["existing-app-hosted-intelligence"],
    target: "existing-app-hosted-intelligence",
    anchor: "managed-intelligence-platform",
  },
  {
    caseName: "a duplicate target after the anchor",
    pages: [
      "managed-intelligence-platform",
      "existing-app-hosted-intelligence",
      "existing-app-hosted-intelligence",
    ],
    target: "existing-app-hosted-intelligence",
    anchor: "managed-intelligence-platform",
  },
])("rejects $caseName", ({ pages, target, anchor }) => {
  expect(() => expectPageImmediatelyAfter(pages, target, anchor)).toThrow();
});

test("documents the managed Runtime, auth, UI, and verification contracts", () => {
  const guide = readCanonicalGuide();

  expectCanonicalGuideContracts(guide);
});

test.each(hostedGuideWrappers)(
  "$name wrapper renders the shared hosted Runtime/platform guide",
  ({ path }) => {
    const sharedRuntimePlatformContent = readContent(hostedRuntimeSnippetPath);

    const guide = readRenderedHostedGuide(path);

    expect(guide).toContain(sharedRuntimePlatformContent);
    expect(guide).not.toContain("<HostedIntelligencePlatformRuntime");
  },
);

test.each(hostedGuideWrappers)(
  "$name frontend boundary names both hosted server URLs",
  ({ path }) => {
    const guide = readContent(path);

    expect(guide).toContain("hosted API URL");
    expect(guide).toContain("hosted WebSocket URL");
    expect(guide).not.toContain("either hosted URL");
    if (path !== canonicalGuideContentPath) {
      expect(guide).toContain(
        "The shared server setup below configures the hosted API URL and hosted WebSocket URL inside that Runtime.",
      );
      expect(guide).not.toContain("when you update the Runtime URL");
    }
  },
);

test.each([
  ["React", "react", "/reference/hooks/useThreads", true],
  [
    "Angular",
    "angular",
    "/angular/guides/threads-memory-attachments-headless",
    false,
  ],
  ["Vue", "vue", "/reference/vue/hooks/useThreads", false],
  [
    "React Native",
    "react-native",
    "/reference/react-native/hooks/useThreads",
    false,
  ],
] as const)(
  "the Threads architecture page gives $0 a native frontend handoff",
  (_name, frontend, expectedHandoff, expectsReactGuides) => {
    const guide = filterFrontendScopedBlocks(
      readContent(threadsExplainedPath),
      frontend,
    );

    expect(guide).toContain(expectedHandoff);
    if (expectsReactGuides) {
      expect(guide).toContain("/headless-threads");
      expect(guide).toContain("/threads-lifecycle");
    } else {
      expect(guide).not.toContain("/headless-threads");
      expect(guide).not.toContain("/threads-lifecycle");
    }
  },
);

test("the canonical key-rotation link resolves to the supported replacement sequence", async () => {
  const guide = readCanonicalGuide();
  const cli = readContent("snippets/shared/cli/cli.mdx");
  const rotationLinkLine =
    guide
      .split("\n")
      .find((line) => line.includes("dashboard key-rotation sequence")) ?? "";
  const sectionStart = cli.indexOf("## Rotate a project API key");
  const sectionEnd = cli.indexOf("## Skills commands", sectionStart);

  expect(await extractMarkdownLinkDestinations(rotationLinkLine)).toContain(
    "/cli",
  );
  expect(sectionStart).toBeGreaterThanOrEqual(0);
  expect(sectionEnd).toBeGreaterThan(sectionStart);

  const section = cli.slice(sectionStart, sectionEnd);
  const orderedSteps = [
    "### Create a replacement",
    "### Update the running app",
    "### Verify the replacement",
    "### Revoke the old key",
  ];
  let previousStepIndex = -1;

  for (const step of orderedSteps) {
    const stepIndex = section.indexOf(step);

    expect(stepIndex).toBeGreaterThan(previousStepIndex);
    previousStepIndex = stepIndex;
  }

  expect(section).toContain(
    "[hosted dashboard](https://dashboard.operations.copilotkit.ai)",
  );
  expect(section).toContain("**API Keys**");
  expect(section).toContain("**Create API key**");
  expect(section).toContain("The full token is shown once");
  expect(section).toContain("`CPK_INTELLIGENCE_API_KEY`");
  expect(section).toContain("Keep the old key active");
  expect(section).toMatch(/\b(?:restart|redeploy)\b/);
  expect(section).toContain("create a new Thread");
  expect(section).toContain("**Delete API key**");
  expect(section).toContain("revokes it immediately");
  expect(section).not.toMatch(
    /npx copilotkit@latest\s+(?:api-keys?|keys?)\s+(?:delete|revoke)/,
  );
});

test("documents framework-native registration for the same four HTTP methods", () => {
  const guide = readCanonicalGuide();
  const headlessGuide = readContent(headlessEntryPointPath);
  const reactRouterExample = fs.readFileSync(reactRouterRouteSourceUrl, "utf8");
  const reactRouterGuideRoute = findMdxCodeFence(
    extractMdxCodeFences(guide),
    "ts",
    "app/routes/api.copilotkit.$.tsx",
  );

  expectReactRouterAdapterContract(reactRouterExample);
  expectReactRouterAdapterContract(reactRouterGuideRoute);
  expect(headlessGuide).toMatch(
    /Next\.js App Router[^.]*`GET`, `POST`, `PATCH`, and `DELETE` named exports/,
  );
  expect(headlessGuide).toMatch(
    /React Router[^.]*`loader`[^.]*`GET`[^.]*`action`[^.]*`POST`, `PATCH`, and `DELETE`/,
  );
  expect(headlessGuide).not.toContain(
    "handler hooks, and four HTTP exports in your Runtime route",
  );
});

test.each([
  "export { handler as GET };",
  "export const POST = (request: Request) => handler(request);",
  "export async function PATCH(request: Request) { return handler(request); }",
  "const DELETE = handler; export { DELETE };",
])("rejects React Router binding %s", (forbiddenExport) => {
  expect(() =>
    expectReactRouterAdapterContract(
      `${fs.readFileSync(reactRouterRouteSourceUrl, "utf8")}\n${forbiddenExport}`,
    ),
  ).toThrow();
});

test("rejects a guide that omits the explicit runner exception", () => {
  const guide = readCanonicalGuide();
  const guideWithoutException = guide.replace(runnerException, "");

  expect(guideWithoutException).not.toContain(runnerException);
  expect(() => expectCanonicalGuideContracts(guideWithoutException)).toThrow();
});

test.each([
  {
    caseName: "identifyUser callback with only a prose mention left",
    mutateGuide: (guide: string) =>
      `${guide.replace(
        /      identifyUser: async \(request\) => \{[\s\S]*?\n      \},\n/,
        "",
      )}\n\nThe \`identifyUser\` callback remains required.\n`,
    removedPattern: /identifyUser: async \(request\)/,
  },
  {
    caseName: "onRequest auth gate with only a prose mention left",
    mutateGuide: (guide: string) =>
      `${guide.replace(
        /      hooks: \{\n        onRequest: async \(\{ request \}\) => \{[\s\S]*?\n        \},\n      \},\n/,
        "",
      )}\n\nThe \`onRequest\` auth gate remains required.\n`,
    removedPattern: /onRequest: async \(\{ request \}\)/,
  },
  {
    caseName: "onRequest 401 branch without a control-flow exit",
    mutateGuide: (guide: string) =>
      guide.replace(
        "            throw new Response(",
        "            new Response(",
      ),
    removedPattern: /throw new Response\(/,
  },
  {
    caseName: "Drawer JSX with only a prose mention left",
    mutateGuide: (guide: string) =>
      `${guide.replace(
        /^[ \t]*<CopilotThreadsDrawer \/>$/m,
        "          {/* Drawer omitted */}",
      )}\n\nKeep \`<CopilotThreadsDrawer />\` in the page.\n`,
    removedPattern: /^[ \t]*<CopilotThreadsDrawer \/>$/m,
  },
])("rejects a missing $caseName", ({ mutateGuide, removedPattern }) => {
  const guide = readCanonicalGuide();
  const mutatedGuide = mutateGuide(guide);

  expect(mutatedGuide).not.toMatch(removedPattern);
  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("rejects an onRequest auth gate satisfied only by later code", () => {
  const mutatedGuide = readCanonicalGuide()
    .replace(
      /        onRequest: async \(\{ request \}\) => \{[\s\S]*?\n        \},/,
      "        onRequest: async ({ request }) => { void request; },",
    )
    .replace(
      "    export const GET = handler;",
      '    async function unrelatedAuthGate(request: Request) { const user = await getVerifiedAppUser(request); if (!user) { throw new Response("Unauthorized", { status: 401 }); } }\n\n    export const GET = handler;',
    );

  expect(mutatedGuide).toContain("async function unrelatedAuthGate");
  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("rejects returning a 401 Response from onRequest", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    "            throw new Response(",
    "            return new Response(",
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("binds identifyUser output to the verified user", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    "        return { id: user.id, name: user.name };",
    `        const exampleOnly = () => {
          return { id: user.id, name: user.name };
        };
        void exampleOnly;
        return { id: "constant-user", name: "Constant User" };`,
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test.each([
  [
    "agent map",
    "      agents, // Keep the agent map and tools your app already uses.",
    "      // agents omitted",
  ],
  [
    "handler base path",
    '      basePath: "/api/copilotkit",',
    '      basePath: "/wrong",',
  ],
] as const)(
  "rejects a canonical server example with the wrong %s",
  (_name, before, after) => {
    const mutatedGuide = readCanonicalGuide().replace(before, after);

    expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
  },
);

test("rejects named HTTP exports that exist only in comments", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    /    export const (GET|POST|PATCH|DELETE) = handler;/g,
    "    // export const $1 = handler;",
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("rejects thread UI that exists only in JSX comments", () => {
  const mutatedGuide = readCanonicalGuide()
    .replace(
      "          <CopilotThreadsDrawer />",
      "          {/* <CopilotThreadsDrawer /> */}",
    )
    .replace("          <CopilotChat />", "          {/* <CopilotChat /> */}");

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test.each([
  {
    caseName: "an ignored verifier result and unrelated 401 condition",
    body: `          const verified = await getVerifiedAppUser(request);
          const unrelated = null;
          if (!unrelated) {
            throw new Response("Unauthorized", { status: 401 });
          }
          void verified;`,
  },
  {
    caseName: "a 401 exit nested in a function",
    body: `          const user = await getVerifiedAppUser(request);
          if (!user) {
            function rejectLater() {
              throw new Response("Unauthorized", { status: 401 });
            }
            void rejectLater;
          }`,
  },
  {
    caseName: "a 401 exit behind another condition",
    body: `          const user = await getVerifiedAppUser(request);
          if (!user) {
            if (false) {
              throw new Response("Unauthorized", { status: 401 });
            }
          }`,
  },
  {
    caseName: "a 401 marker in the response body only",
    body: `          const user = await getVerifiedAppUser(request);
          if (!user) {
            throw new Response(JSON.stringify({ status: 401 }), { status: 200 });
          }`,
  },
  {
    caseName: "a reassigned verifier binding",
    body: `          let user = await getVerifiedAppUser(request);
          user = null;
          if (!user) {
            throw new Response("Unauthorized", { status: 401 });
          }`,
  },
  {
    caseName: "an unreachable 401 after another exit",
    body: `          const user = await getVerifiedAppUser(request);
          if (!user) {
            return new Response("OK", { status: 200 });
            throw new Response("Unauthorized", { status: 401 });
          }`,
  },
  {
    caseName: "a shadowed request binding",
    body: `          const request = await getVerifiedAppUser(request);
          if (!request) {
            throw new Response("Unauthorized", { status: 401 });
          }`,
  },
  {
    caseName: "a shadowed Response binding",
    body: `          const Response = await getVerifiedAppUser(request);
          if (!Response) {
            throw new Response("Unauthorized", { status: 401 });
          }`,
  },
  {
    caseName: "work before the direct 401 exit",
    body: `          const user = await getVerifiedAppUser(request);
          if (!user) {
            console.error("Unauthorized");
            throw new Response("Unauthorized", { status: 401 });
          }`,
  },
])("rejects onRequest auth with $caseName", ({ body }) => {
  const mutatedGuide = readCanonicalGuide().replace(
    /        onRequest: async \(\{ request \}\) => \{[\s\S]*?\n        \},/,
    `        onRequest: async ({ request }) => {\n${body}\n        },`,
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("rejects an aliased onRequest request binding", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    "        onRequest: async ({ request }) => {",
    "        onRequest: async ({ something: request }) => {",
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("rejects a conflicting nested CopilotChat agent override", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    "          <CopilotChat />",
    '          <CopilotChat agentId="other-agent" />',
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test.each([
  "const leak = process.env.CPK_INTELLIGENCE_API_KEY;",
  "const leak = process.env.CPK_INTELLIGENCE_API_URL;",
  "const leak = process.env.CPK_INTELLIGENCE_GATEWAY_WS_URL;",
  'const leak = "https://api.intelligence.copilotkit.ai";',
  'const leak = "wss://realtime.intelligence.copilotkit.ai";',
  'const leak = "https://api.intelligence.copilotkit.ai/";',
  'const leak = "https://api.intelligence.copilotkit.ai/threads";',
  'const leak = "https://api.intelligence.copilotkit.ai?region=us";',
  'const leak = "https://api.intelligence.copilotkit.ai#client";',
  'const leak = "wss://realtime.intelligence.copilotkit.ai/";',
  'const leak = "wss://realtime.intelligence.copilotkit.ai/socket";',
  'const leak = "wss://realtime.intelligence.copilotkit.ai?region=us";',
  'const leak = "wss://realtime.intelligence.copilotkit.ai#client";',
  "const leak = `https://api.intelligence.copilotkit.ai/${path}`;",
  "const leak = `wss://realtime.intelligence.copilotkit.ai/?token=${token}`;",
  'const leak = "https://API.INTELLIGENCE.COPILOTKIT.AI:443/threads";',
  'const leak = "wss://REALTIME.INTELLIGENCE.COPILOTKIT.AI:443/socket";',
  'publicLicenseKey="stale"',
  'licenseToken="stale"',
  '{...{ licenseToken: "stale" }}',
  '{...{ ["licenseToken"]: "stale" }}',
])("rejects client app-page leak %s", (leak) => {
  const guide = readCanonicalGuide();
  const mutatedGuide = leak.startsWith("const ")
    ? guide.replace('"use client";', `"use client";\n${leak}`)
    : guide.replace(
        "    <CopilotKitProvider\n",
        `    <CopilotKitProvider\n      ${leak}\n`,
      );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("rejects an ambiguous computed property on a provider spread", () => {
  const mutatedGuide = readCanonicalGuide()
    .replace(
      '"use client";',
      '"use client";\nconst providerProp = Math.random() ? "licenseToken" : "className";\nconst providerProps = { [providerProp]: "stale" };',
    )
    .replace(
      "    <CopilotKitProvider\n",
      "    <CopilotKitProvider\n      {...providerProps}\n",
    );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("rejects a browser secret on an aliased managed component", () => {
  const appPage = findMdxCodeFence(
    extractMdxCodeFences(readCanonicalGuide()),
    "tsx",
    "app/page.tsx",
  )
    .replace("  CopilotKitProvider,", "  CopilotKitProvider as Provider,")
    .replace(
      "    <CopilotKitProvider\n",
      '    <Provider\n      licenseToken="stale"\n',
    )
    .replace("    </CopilotKitProvider>", "    </Provider>");

  expect(() => expectNoManagedClientSecrets(appPage)).toThrow();
});

test("allows an unrelated ambiguous computed property in client app logic", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    '"use client";',
    '"use client";\nconst appProp = Math.random() ? "label" : "className";\nconst appProps = { [appProp]: "safe" };\nvoid appProps;',
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).not.toThrow();
});

test("allows an unrelated licenseToken property in client app logic", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    '"use client";',
    '"use client";\nconst appState = { licenseToken: "app-owned" };\nvoid appState;',
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).not.toThrow();
});

test("rejects malformed executable syntax in a published snippet", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    '"use client";',
    '"use client";\nconst broken = {;',
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("checks every executable client module for managed secrets", () => {
  const mutatedGuide = `${readCanonicalGuide()}

\`\`\`tsx title="app/another-client-component.tsx"
"use client";
const leakedKey = process.env.CPK_INTELLIGENCE_API_KEY;
void leakedKey;
\`\`\``;

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("rejects an onRequest auth gate that is fully commented out", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    /(        onRequest: async \(\{ request \}\) => \{\n)([\s\S]*?)(\n        \},)/,
    (_match, opening: string, body: string, closing: string) =>
      `${opening}${body
        .split("\n")
        .map((line) => line.replace(/^(\s*)/, "$1// "))
        .join("\n")}${closing}`,
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("allows a block comment before executable onRequest auth", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    "        onRequest: async ({ request }) => {",
    "        onRequest: async ({ request }) => {\n          /* } */",
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).not.toThrow();
});

test("allows a parenthesized awaited verifier result", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    "          const user = await getVerifiedAppUser(request);",
    "          const user = (await getVerifiedAppUser(request));",
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).not.toThrow();
});

test("rejects onRequest auth masked by an opening brace in a literal", () => {
  const mutatedGuide = readCanonicalGuide().replace(
    /        onRequest: async \(\{ request \}\) => \{[\s\S]*?\n        \},/,
    `        onRequest: async ({ request }) => {
          const marker = "{";
          void request;
        },
        unrelated: async ({ request }) => {
          const user = await getVerifiedAppUser(request);
          if (!user) {
            throw new Response("Unauthorized", { status: 401 });
          }
        },`,
  );

  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("checks user B's successful agent-scoped pages for user A's thread", () => {
  const guide = readCanonicalGuide();

  expect(guide).toMatch(
    /new URLSearchParams\(\{[\s\S]*?agentId,[\s\S]*?includeArchived: "true",[\s\S]*?\}\)/,
  );
  expect(guide).toContain("`${runtimeUrl}/threads?${query}`");
  expect(guide).toMatch(
    /if \(!listResponse\.ok\) \{[\s\S]*?throw new Error\([\s\S]*?\);[\s\S]*?\}[\s\S]*?const listBody = await listResponse\.json\(\);/,
  );
  expect(guide).toMatch(
    /if \(listBody\.threads\.some\(\(thread\) => thread\.id === threadId\)\) \{[\s\S]*?throw new Error/,
  );
});

test("checks every thread page and rejects successful cross-user route access", () => {
  const verificationCode = findMdxCodeFence(
    extractMdxCodeFences(readCanonicalGuide()),
    "js",
    "Authenticated client — user B's session",
  );

  expect(verificationCode).toContain("const seenCursors = new Set();");
  expect(verificationCode).toContain('includeArchived: "true"');
  expect(verificationCode).toContain("do {");
  expect(verificationCode).toContain("if (!Array.isArray(listBody.threads)) {");
  expect(verificationCode).toContain("const nextCursor = listBody.nextCursor;");
  expect(verificationCode).toContain("} while (cursor);");
  expect(verificationCode).toContain("const allowedDenialStatuses = new Set([");
  expect(verificationCode).toContain("401, 403, 404");
  expect(verificationCode).toContain("assertDenied(messagesResponse");
  expect(verificationCode).toContain("assertDenied(eventsResponse");
  expect(verificationCode).toContain("assertDenied(stateResponse");
  expect(verificationCode).toContain("assertDenied(connectResponse");
  expect(verificationCode).toContain("assertDenied(stopResponse");
  expect(verificationCode).toContain(
    "`${runtimeUrl}/threads/${encodedThreadId}/events`",
  );
  expect(verificationCode).toContain(
    "`${runtimeUrl}/threads/${encodedThreadId}/state`",
  );
  expect(verificationCode).toContain(
    "`${runtimeUrl}/agent/${encodedAgentId}/stop/${encodedThreadId}`",
  );
  expect(verificationCode).toMatch(/method:\s*"POST"/);
});

test("proves user A can reach each isolation endpoint before testing user B", () => {
  const verificationCode = findMdxCodeFence(
    extractMdxCodeFences(readCanonicalGuide()),
    "js",
    "Authenticated client — user A's session",
  );

  expect(verificationCode).toContain(
    'for (const route of ["messages", "events", "state"])',
  );
  expect(verificationCode).toContain(
    "`${runtimeUrl}/threads/${encodedThreadId}/${route}`",
  );
  expect(verificationCode).toContain("if (!response.ok) throw new Error");
});

test("replaces the Quickstart Runtime route with one hosted catch-all route", () => {
  const quickstart = readContent(
    "docs/integrations/built-in-agent/quickstart.mdx",
  );
  const guide = readCanonicalGuide();

  expect(quickstart).toContain("app/api/copilotkit/route.ts");
  expect(guide).toContain(
    "Move the Runtime setup from `app/api/copilotkit/route.ts` to `app/api/copilotkit/[[...slug]]/route.ts`, then delete the old `app/api/copilotkit/route.ts`. Keep only the catch-all route.",
  );
});

test("links each public entry point back to the canonical guide", async () => {
  const contentsByPath = new Map(
    entryPointPaths.map((path) => [path, readContent(path)]),
  );
  const contents = [...contentsByPath.values()];

  for (const content of contents) {
    await expectCanonicalGuideLink(content);
  }

  expect(findUnsafeManagedIdentifiers(readCanonicalGuide(), contents)).toEqual(
    [],
  );
  expectNoRetiredThreadSetup(contentsByPath);
});

test("rejects a valueless retired Drawer license prop", () => {
  const fixture = createEntryPointFixture(
    "```tsx\n<CopilotThreadsDrawer publicLicenseKey />\n```",
    "```tsx\nconst headless = true;\n```",
  );

  expect(() => expectNoRetiredThreadSetup(fixture)).toThrow();
});

test("documents only customization accepted and forwarded by the React Drawer wrapper", () => {
  const drawerGuide = readContent(drawerEntryPointPath);
  const drawerReference = readContent(drawerReferencePath);
  const collapsedDrawerReference = collapseWhitespace(drawerReference);
  const drawerWrapperSource = fs.readFileSync(drawerWrapperSourceUrl, "utf8");
  const propsInterface =
    drawerWrapperSource.match(
      /export interface CopilotThreadsDrawerProps \{([\s\S]*?)\n\}/,
    )?.[1] ?? "";
  const wrapperArguments =
    drawerWrapperSource.match(
      /export function CopilotThreadsDrawer\(\{([\s\S]*?)\}: CopilotThreadsDrawerProps\)/,
    )?.[1] ?? "";

  expect(propsInterface).not.toMatch(/^\s*children\??\s*:/m);
  expect(propsInterface).toMatch(/\brenderRow\?:/);
  expect(wrapperArguments).not.toMatch(/\bchildren\b/);
  expect(drawerWrapperSource).toMatch(
    /React\.createElement\([\s\S]*COPILOTKIT_THREADS_DRAWER_TAG[\s\S]*rowChildren/,
  );
  expect(drawerGuide).not.toMatch(
    /<CopilotThreadsDrawer\b[^>]*>\s*<span\b[^>]*\bslot=["']header["']/,
  );
  for (const fence of extractMdxCodeFences(drawerReference)) {
    expect(fence.content).not.toMatch(
      /<CopilotThreadsDrawer\b[^>]*>[\s\S]*?\bslot\s*=/,
    );
  }
  expect(drawerReference).not.toContain('slot="header"');
  expect(drawerReference).not.toContain("`launcher-icon`");
  expect(collapsedDrawerReference).toContain(
    "The React wrapper does not forward arbitrary children to the custom element.",
  );

  const customizationExample = findMdxCodeFence(
    extractMdxCodeFences(drawerGuide),
    "tsx",
    "app/threads-drawer.tsx",
  );

  expect(customizationExample).toContain(
    'import { CopilotThreadsDrawer } from "@copilotkit/react-core/v2";',
  );
  expect(customizationExample).toContain('label="My conversations"');
  expect(customizationExample).toContain("renderRow={(thread) => (");
  expect(customizationExample).toContain(
    '<span>{thread.name ?? "New conversation"}</span>',
  );
});

test.each([
  {
    path: "docs/premium/managed-intelligence-platform.mdx",
    sectionStart: "Thread actions map to the same lifecycle",
    sectionEnd: "Use the thread detail page",
  },
  {
    path: headlessEntryPointPath,
    sectionStart: "**Archive vs. delete:**",
    sectionEnd: "      </Step>",
  },
  {
    path: useThreadsReferencePath,
    sectionStart: '<PropertyReference name="archiveThread"',
    sectionEnd: "## Usage",
  },
])(
  "$path matches the hosted thread removal contract",
  ({ path, sectionStart, sectionEnd }) => {
    const content = readContent(path);
    const startIndex = content.indexOf(sectionStart);
    const endIndex = content.indexOf(
      sectionEnd,
      startIndex + sectionStart.length,
    );

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);

    const lifecycle = content
      .slice(startIndex, endIndex)
      .replace(/`/g, "")
      .replace(/\s+/g, " ");

    expectNoThreadRemovalContradictions(lifecycle);
    expect(lifecycle).toMatch(/\barchive(?:Thread)?\b[^.]*\breversible\b/i);
    expect(lifecycle).toContain("includeArchived: true");
    expect(lifecycle).toMatch(/\bunarchive(?:Thread)?\b/i);
    expect(lifecycle).toMatch(
      /\bdelete(?:Thread)?\b[^.]*\birreversible to the app user\b/i,
    );
    expect(lifecycle).toMatch(/\bsoft-deletes?\b/i);
    expect(lifecycle).toMatch(/\bretains?\b[^.]*\b(?:stored )?row\b/i);
    expect(lifecycle).not.toMatch(
      /\b\d+\s+(?:hours?|days?|weeks?|months?|years?)\b/i,
    );
  },
);

test("T1: publishes framework-native variants of the hosted existing-app guide", async () => {
  const { data: frontmatter } = matter(readContent(canonicalGuideContentPath));

  expect.soft(frontmatter.frontend, "root guide frontend metadata").toEqual({
    kind: "frontend-variant",
    fallback: "hide",
  });

  for (const variant of hostedGuideVariants) {
    const variantUrl = new URL(
      `../../content/${variant.path}`,
      import.meta.url,
    );
    const exists = fs.existsSync(variantUrl);

    expect.soft(exists, `${variant.name} hosted guide variant`).toBe(true);
    if (!exists) continue;

    await expectFrameworkNativeGuide(
      variant,
      readContent(variant.path),
      readRenderedHostedGuide(variant.path),
    );
  }
});

test("Angular public API inventory lists public thread entry points", () => {
  const inventory = readContent("reference/angular/public-api.mdx");
  const rootApiFamilies =
    inventory.match(
      /## Root API families([\s\S]*?)## MCP Apps API family/,
    )?.[1] ?? "";
  const completeUiFamily =
    rootApiFamilies.match(
      /- \*\*Complete UI:\*\*([\s\S]*?)(?=- \*\*|$)/,
    )?.[0] ?? "";
  const applicationStateFamily =
    rootApiFamilies.match(
      /- \*\*Agents and application state:\*\*([\s\S]*?)(?=- \*\*|$)/,
    )?.[0] ?? "";

  expect(completeUiFamily).toContain("`CopilotThreadsDrawer`");
  expect(applicationStateFamily).toContain("`injectThreads`");
});

test("the Angular custom list switches both the thread store and chat", () => {
  const example = findMdxCodeFence(
    extractMdxCodeFences(readContent(angularThreadsGuidePath)),
    "ts",
    "src/app/thread-list.component.ts",
  );

  expect(example).toContain("injectChatConfiguration");
  expect(example).toContain("readonly chat = injectChatConfiguration();");
  expect(example).toContain("this.chat.setActiveThreadId(threadId);");
  expect(example).toContain("this.threads.startNewThread();");
  expect(example).toContain("this.chat.startNewThread();");
});

test("the Vue thread reference uses managed entitlement instead of a browser key", () => {
  const reference = readContent(vueUseThreadsReferencePath);

  expect(reference).toContain(
    'body="Create a cloud-hosted project or connect a self-hosted deployment to start syncing threads."',
  );
  expect(reference).not.toMatch(/\bpublic license key\b/i);
  expect(reference).not.toMatch(/\blicense (?:key|token)\b/i);
});

test.each([
  ["React", useThreadsReferencePath],
  ["React Native", reactNativeUseThreadsReferencePath],
  ["Vue", vueUseThreadsReferencePath],
  ["architecture", threadsExplainedPath],
])(
  "the %s thread docs do not promise a client mutation timeout",
  (_name, path) => {
    const content = collapseWhitespace(readContent(path));

    expect(content).not.toMatch(/\b15(?:-second| seconds?)\b/i);
    expect(content).toMatch(
      /\bno built-in mutation timeout\b[^.]*\bstalled request\b[^.]*\bremain pending\b/i,
    );
  },
);

test("the React thread reference lists every realtime lifecycle event", () => {
  const reference = collapseWhitespace(readContent(useThreadsReferencePath));

  expect(reference).toContain(
    "Thread creates, renames, archives, unarchives, and deletes from any client are reflected immediately without polling.",
  );
});

test("the architecture guide documents the actual thread error channels", () => {
  const guide = collapseWhitespace(readContent(threadsExplainedPath));

  expect(guide).toContain(
    "All mutation methods (`renameThread`, `archiveThread`, `unarchiveThread`, `deleteThread`)",
  );
  expect(guide).toContain(
    "A full list request clears the list or mutation error when it starts.",
  );
  expect(guide).toContain(
    "A fetch-more retry clears the page error when it starts.",
  );
  expect(guide).toContain(
    "A successful mutation does not clear an earlier list or mutation error.",
  );
  expect(guide).not.toContain("clears it after the next successful operation");
});

test("the architecture guide keeps mutation timeout guidance outside the cause list", () => {
  const guide = readContent(threadsExplainedPath);

  expect(guide).toMatch(
    /- \*\*Authorization failure\.\*\*[^\n]+\n\nThe thread APIs have no built-in mutation timeout/,
  );
});

test("the headless guide gives the actual thread auto-name timing", () => {
  const guide = readContent(headlessEntryPointPath);

  expect(guide).toContain(
    "starts a best-effort naming task from the first run's input messages",
  );
  expect(guide).toContain("one to eight words");
  expect(guide).not.toContain("after the first run completes by default");
});

test("the headless example can return to a new conversation", () => {
  const guide = readContent(headlessEntryPointPath);
  const sidebar = findMdxCodeFence(
    extractMdxCodeFences(guide),
    "tsx",
    "ThreadSidebar.tsx",
    "interface ThreadSidebarProps",
  );
  const app = findMdxCodeFence(extractMdxCodeFences(guide), "tsx", "App.tsx");

  expect(sidebar).toContain("onNewThread: () => void");
  expect(sidebar).toContain("onClick={onNewThread}");
  expect(app).toContain("onNewThread={startNewThread}");
  expect(app).toContain("setActiveThreadId(crypto.randomUUID())");
  expect(guide).toContain(
    "creates the stored row lazily on the next agent run",
  );
  expect(guide).not.toMatch(/useThreads[^.]*\bcreates\b/i);
});

test("the Angular custom list exposes cursor pagination and page errors", () => {
  const example = findMdxCodeFence(
    extractMdxCodeFences(readContent(angularThreadsGuidePath)),
    "ts",
    "src/app/thread-list.component.ts",
  );

  expect(example).toContain("threads.hasMoreThreads()");
  expect(example).toContain("threads.fetchMoreThreads()");
  expect(example).toContain("threads.isFetchingMoreThreads()");
  expect(example).toContain("threads.fetchMoreError()");
});

test("native thread references stay on native headless APIs", async () => {
  const reference = readContent(reactNativeUseThreadsReferencePath);

  expect(reference).toContain('from "@copilotkit/react-native/headless"');
  expect(reference).not.toContain("/headless-threads");
  expect(await extractMarkdownLinkDestinations(reference)).not.toContain(
    "/headless-threads",
  );
});

test("thread references describe realtime as a runtime capability", () => {
  for (const path of [
    useThreadsReferencePath,
    reactNativeUseThreadsReferencePath,
  ]) {
    const reference = collapseWhitespace(readContent(path));

    expect(reference).toMatch(
      /when the runtime supplies (?:a )?WebSocket (?:URL|capability)/i,
    );
    expect(reference).not.toMatch(
      /On mount, fetches the thread list and establishes a realtime WebSocket subscription/i,
    );
  }
});

test("the React useThreads TSDoc imports the v2 hook", () => {
  const source = fs.readFileSync(useThreadsSourceUrl, "utf8");
  const tsdoc = extractPublicTsdoc(parseTypeScriptModel(source), "useThreads");

  expect(tsdoc).toContain(
    'import { useThreads } from "@copilotkit/react-core/v2"',
  );
  expect(tsdoc).not.toContain(
    'import { useThreads } from "@copilotkit/react-core"',
  );
});

test("the Drawer reference documents its license callbacks", () => {
  const reference = readContent(drawerReferencePath);

  for (const prop of ["onLicensed", "licenseUrl"]) {
    expect(reference).toContain(`<PropertyReference name="${prop}"`);
  }
});

test("the Drawer reference lists every public wrapper prop", () => {
  const source = fs.readFileSync(drawerWrapperSourceUrl, "utf8");
  const model = parseTypeScriptModel(source);
  const declaration = model.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === "CopilotThreadsDrawerProps",
  );

  expect(declaration).toBeDefined();
  if (!declaration) return;

  const publicProps = new Set(
    declaration.members.flatMap((member) =>
      member.name
        ? [getTypeScriptName(member.name).replace(/^['"]|['"]$/g, "")]
        : [],
    ),
  );
  const documentedProps = new Set(
    Array.from(
      readContent(drawerReferencePath).matchAll(
        /<PropertyReference name="([^"]+)"/g,
      ),
      (match) => match[1] ?? "",
    ),
  );

  expect(documentedProps).toEqual(publicProps);
});

test("published thread examples handle rejected mutations and confirm delete", () => {
  for (const path of [useThreadsReferencePath, vueUseThreadsReferencePath]) {
    const reference = readContent(path);

    expect(reference).toContain("runMutation");
    expect(reference).toContain("error");
    expect(reference).toContain("confirm(");
  }

  const nativeReference = readContent(reactNativeUseThreadsReferencePath);
  expect(nativeReference).toContain("runMutation");
  expect(nativeReference).toContain("error");
  expect(nativeReference).toContain("Alert.alert(");
});

test("every public thread surface documents actual auto-name behavior", () => {
  for (const path of [
    threadsExplainedPath,
    headlessEntryPointPath,
    useThreadsReferencePath,
    reactNativeUseThreadsReferencePath,
    vueUseThreadsReferencePath,
  ]) {
    const content = collapseWhitespace(readContent(path));

    expect(content).toContain("first run's input messages");
    expect(content).toContain("one to eight words");
    expect(content).toContain("falls back to `Untitled`");
    expect(content).not.toMatch(/after (?:the|their) first run/i);
    expect(content).not.toMatch(/2(?:–|-| to )5(?:-word| words?)/i);
  }
});

test("the hosted guide states the agent-ID compatibility constraint", () => {
  const guide = readCanonicalGuide();

  expect(guide).toContain(
    "Every agent key used with hosted Threads must follow the same 1–128-character identifier grammar",
  );
  expect(guide).toContain(
    "Rename or map an incompatible agent key before enabling the thread UI",
  );
});

test("the architecture guide does not promise ephemeral Intelligence chat by omitting threadId", () => {
  const guide = readContent(threadsExplainedPath);

  expect(guide).not.toContain("Use `CopilotChat` without a `threadId`");
  expect(guide).toContain(
    "An Intelligence-enabled Runtime persists the first run even when the frontend omits an explicit `threadId`",
  );
});

test.each([threadsExplainedPath, headlessEntryPointPath])(
  "%s documents the thread-lock heartbeat invariant",
  (path) => {
    const guide = collapseWhitespace(readContent(path));

    expect(guide).toContain(
      "Keep `lockHeartbeatIntervalSeconds` strictly below `lockTtlSeconds`",
    );
  },
);

test("all public removal docs describe delete as a retained soft delete", () => {
  const runtimeClient = fs.readFileSync(
    new URL(
      "../../../../../packages/runtime/src/v2/runtime/intelligence-platform/client.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const angularReference = readContent(
    "reference/angular/functions/injectThreads.mdx",
  );
  const runtimeDeleteTsdoc = extractPublicTsdoc(
    parseTypeScriptModel(runtimeClient),
    "CopilotKitIntelligence",
    "deleteThread",
  );
  const angularDeleteRow =
    angularReference
      .split("\n")
      .find((line) => line.includes("`deleteThread(id)`")) ?? "";

  expectNoThreadRemovalContradictions(runtimeDeleteTsdoc);
  expectNoThreadRemovalContradictions(angularDeleteRow);
  expect(runtimeDeleteTsdoc).toMatch(
    /soft-delete[^.]*retains?[^.]*stored row/i,
  );
  expect(angularDeleteRow).toMatch(/soft-delete[^.]*retaining[^.]*stored row/i);
});

test("the Drawer guide labels its prop table as non-exhaustive", () => {
  const guide = readContent(drawerEntryPointPath);

  expect(guide).toContain("Common optional props:");
  expect(guide).not.toContain("The optional ones:");
});

test.each([
  {
    surface: "threads explanation",
    read: () => readContent("docs/premium/threads-explained.mdx"),
    archiveContract: true,
    deleteContract: true,
    paginationContract: false,
    optimisticContract: true,
    orderingContract: false,
  },
  {
    surface: "Angular headless threads guide",
    read: () =>
      readContent(
        "docs/frontends/angular/guides/threads-memory-attachments-headless.mdx",
      ),
    archiveContract: false,
    deleteContract: true,
    paginationContract: false,
    optimisticContract: false,
    orderingContract: false,
  },
  {
    surface: "Vue useThreads reference",
    read: () => readContent("reference/vue/hooks/useThreads.mdx"),
    archiveContract: true,
    deleteContract: true,
    paginationContract: true,
    optimisticContract: true,
    orderingContract: true,
  },
  {
    surface: "React Native useThreads reference",
    read: () => readContent("reference/react-native/hooks/useThreads.mdx"),
    archiveContract: true,
    deleteContract: true,
    paginationContract: true,
    optimisticContract: true,
    orderingContract: true,
  },
  {
    surface: "React useThreads TSDoc",
    read: () =>
      extractTsdocComments(fs.readFileSync(useThreadsSourceUrl, "utf8")),
    archiveContract: true,
    deleteContract: true,
    paginationContract: true,
    optimisticContract: true,
    orderingContract: true,
  },
  {
    surface: "Angular injectThreads TSDoc",
    read: () =>
      extractTsdocComments(
        fs.readFileSync(
          new URL(
            "../../../../../packages/angular/src/lib/threads.ts",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    archiveContract: true,
    deleteContract: true,
    paginationContract: true,
    optimisticContract: true,
    orderingContract: true,
  },
])(
  "T2: $surface matches the cross-frontend thread contract",
  ({
    surface,
    read,
    archiveContract,
    deleteContract,
    paginationContract,
    optimisticContract,
    orderingContract,
  }) => {
    const content = collapseWhitespace(read().replace(/`/g, ""));

    expect.soft(content, `${surface}: content loads`).not.toHaveLength(0);
    if (archiveContract || deleteContract) {
      expectNoThreadRemovalContradictions(content);
    }

    if (archiveContract) {
      expect
        .soft(content, `${surface}: archive is a reversible visibility state`)
        .toMatch(/\barchive(?:Thread)?\b[^.]*\breversible visibility state\b/i);
      expect
        .soft(content, `${surface}: archived rows can be included`)
        .toContain("includeArchived: true");
      expect
        .soft(content, `${surface}: unarchive restores the active row`)
        .toMatch(/\bunarchive(?:Thread|d)?\b[^.]*\brestores?\b/i);
      expect
        .soft(content, `${surface}: archive is not described as soft-delete`)
        .not.toMatch(/\barchive(?:Thread)?\b[^.]*\bsoft[ -]?delete\b/i);
    }

    if (deleteContract) {
      expect
        .soft(content, `${surface}: delete is irreversible to the app user`)
        .toMatch(
          /\b(?:delete(?:Thread)?|deletion)\b[^.]*\birreversible to (?:the )?app user\b/i,
        );
      expect
        .soft(content, `${surface}: the platform soft-deletes`)
        .toMatch(/\bplatform\b[^.]*\bsoft-deletes?\b/i);
      expect
        .soft(content, `${surface}: the platform retains the stored row`)
        .toMatch(/\bretains?\b[^.]*\bstored row\b/i);
      expect
        .soft(content, `${surface}: delete does not promise a purge window`)
        .not.toMatch(
          /\b(?:delete(?:Thread)?|deletion)\b[^.]*\b\d+\s+(?:hours?|days?|weeks?|months?|years?)\b/i,
        );
    }

    if (paginationContract) {
      expect
        .soft(content, `${surface}: cursor pages default to 50 rows`)
        .toMatch(
          /\b(?:default page size (?:is|of)|default is|defaults? to) 50(?: threads)? per page\b/i,
        );
      expect
        .soft(content, `${surface}: limit only overrides page size`)
        .toMatch(
          /\blimit\b[^.]*\boverrides?\b[^.]*\bpage size\b|\boverrides? the thread page size\b/i,
        );
      expect
        .soft(content, `${surface}: cursor pagination works without limit`)
        .toMatch(
          /\bcursor(?:-based)? pagination\b[^.]*\b(?:remains active when (?:this|limit) is omitted|without (?:a )?limit)\b/i,
        );
      expect
        .soft(content, `${surface}: limit is not required for pagination`)
        .not.toMatch(
          /\bonly meaningful when limit is set\b|\blimit\b[^.]*\benables? cursor-based pagination\b|\bcursor-based pagination\b[^.]*\bwhen (?:a )?limit is (?:provided|set)\b/i,
        );
    }

    if (optimisticContract) {
      expect
        .soft(content, `${surface}: all four mutations are optimistic`)
        .toMatch(
          /\brename\b[\s\S]{0,120}\barchive\b[\s\S]{0,80}\bunarchive\b[\s\S]{0,80}\bdelete\b[\s\S]{0,220}\boptimistic(?:ally)?\b/i,
        );
      expect
        .soft(content, `${surface}: rejected delete restores its row`)
        .toMatch(
          /\b(?:rejected delete|delete[^.]*\b(?:rejects?|fails?|failure)\b)[^.]*\b(?:restores?|rolls? back)\b[^.]*\brow\b/i,
        );
      expect
        .soft(content, `${surface}: other failures reconcile`)
        .toMatch(
          /\bother\b[^.]*\b(?:failures|rejected mutations)\b[^.]*\brealtime\b[^.]*\brefetch\b/i,
        );
      expect
        .soft(content, `${surface}: mutations are not pessimistic`)
        .not.toMatch(/\bpessimistic updates?\b/i);
    }

    if (orderingContract) {
      expect
        .soft(
          content,
          `${surface}: newest-first ordering uses the fallback recency key`,
        )
        .toMatch(
          /\blastRunAt\b[^.]*\bwhen present\b[^.]*\b(?:falling back to|otherwise)\b[^.]*\bupdatedAt\b[^.]*\b(?:then|otherwise)\b[^.]*\bcreatedAt\b[^.]*\b(?:most recent|newest)[ -]first\b/i,
        );
      expect
        .soft(content, `${surface}: ordering is not a tie-breaker chain`)
        .not.toMatch(
          /\bsorted by\s+lastRunAt\b[^.]*\bthen\b[^.]*\bupdatedAt\b[^.]*\bthen\b[^.]*\bcreatedAt\b/i,
        );
      expect
        .soft(content, `${surface}: ordering is not updatedAt-only`)
        .not.toMatch(
          /\bsorted (?:by )?most[ -]recently[ -]updated first\b|\bsorted by updatedAt(?: descending)?\b/i,
        );
    }
  },
);

test("T3: public Drawer TSDoc describes hosted managed entitlement without browser tokens", () => {
  const tsdoc = collapseWhitespace(
    extractTsdocComments(fs.readFileSync(drawerWrapperSourceUrl, "utf8")),
  );
  const browserWithoutToken =
    /(?:\bno\b|\bwithout\b)[^.]*\bbrowser\b[^.]*\b(?:license )?token\b|\bbrowser\b[^.]*(?:\bdoes not\b|\bdoesn't\b|\bnever\b|\bno\b|\bwithout\b)[^.]*\b(?:license )?token\b/i;

  expect
    .soft(tsdoc, "hosted entitlement comes from the Runtime-connected project")
    .toMatch(
      /\b(?:cloud-hosted|hosted)\b[^.]*\bmanaged entitlement\b[^.]*(?:\bIntelligence project\b[^.]*\bconnected to (?:the )?Runtime\b|\bRuntime-connected Intelligence project\b)/i,
    );
  expect
    .soft(tsdoc, "hosted setup sends no license token to the browser")
    .toMatch(browserWithoutToken);
  expect.soft(tsdoc, "retired browser prop").not.toContain("publicLicenseKey");
  expect
    .soft(tsdoc, "retired license-status framing")
    .not.toMatch(
      /\b(?:license gating is two-pronged|no license is configured|runtime reported no license status)\b/i,
    );

  const tokenSentences = tsdoc
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => /\b(?:license )?token\b/i.test(sentence));

  for (const sentence of tokenSentences) {
    if (browserWithoutToken.test(sentence)) continue;

    expect
      .soft(
        sentence,
        "explicit tokens are limited to a separate deployment case",
      )
      .toMatch(/\b(?:self-hosted|offline)\b/i);
    expect
      .soft(sentence, "self-hosted or offline tokens are explicit")
      .toMatch(/\bexplicit\b/i);
    expect
      .soft(sentence, "hosted managed entitlement does not use a token")
      .not.toMatch(/\b(?:cloud-hosted|hosted managed)\b/i);
  }
});

test("callback-free Drawer TSDoc shares one chat configuration provider", () => {
  expectCallbackFreeDrawerExample(
    fs.readFileSync(drawerWrapperSourceUrl, "utf8"),
  );
});

test("rejects callback-free Drawer and Chat as provider siblings", () => {
  const oldSiblingExample = `
    /**
     * @example
     * \`\`\`tsx
     * <CopilotKitProvider runtimeUrl="/api/copilotkit">
     *   <CopilotChat />
     *   <CopilotThreadsDrawer />
     * </CopilotKitProvider>
     * \`\`\`
     */
  `;

  expect(() => expectCallbackFreeDrawerExample(oldSiblingExample)).toThrow();
});

test("the useThreads reference matches optimistic Core mutations", () => {
  const reference = collapseWhitespace(readContent(useThreadsReferencePath));

  expect(reference).toContain(
    '<PropertyReference name="unarchiveThread" type="(threadId: string) => Promise<void>">',
  );
  expect(reference).toContain(
    "Rename, archive, unarchive, and delete update the local thread list optimistically.",
  );
  expect(reference).toContain(
    "A rejected delete restores the removed row; other rejected mutations surface an error and realtime updates or a refetch reconcile the server state.",
  );
  expect(reference).not.toMatch(/\bpessimistic updates\b/i);
});

test("the Drawer reference distinguishes managed entitlements from offline license tokens", () => {
  const reference = collapseWhitespace(readContent(drawerReferencePath));

  expect(reference).toContain(
    "A cloud-hosted app gets its entitlement from the Intelligence project connected to the Runtime.",
  );
  expect(reference).toContain(
    "Self-hosted and offline enterprise setups may use an explicit license token.",
  );
  expect(reference).not.toMatch(/without (?:a )?license key[^.]*locked view/i);
});

test("the Drawer reference matches the custom element's inclusive mobile breakpoint", () => {
  const elementSource = fs.readFileSync(drawerElementSourceUrl, "utf8");
  const breakpoint = /const MOBILE_BREAKPOINT = (\d+);/.exec(
    elementSource,
  )?.[1];

  expect(breakpoint).toBeDefined();

  const reference = readContent(drawerReferencePath);
  expect(reference).toContain(`at ${breakpoint}px or below`);
  expect(reference).not.toContain(`below ${breakpoint}px`);
});

test.each([
  [
    "a spaced Drawer license prop",
    '<CopilotThreadsDrawer publicLicenseKey = "stale" />',
    "",
  ],
  [
    "a line-broken Drawer license prop",
    '<CopilotThreadsDrawer\n  publicLicenseKey\n  = "stale"\n/>',
    "",
  ],
  [
    "a JSX-spread Drawer license prop",
    '<CopilotThreadsDrawer {...{ publicLicenseKey: "stale" }} />',
    "",
  ],
  [
    "a single-quoted Runtime import",
    "",
    "import { CopilotRuntime } from '@copilotkit/runtime';",
  ],
  [
    "a multiline Runtime import",
    "",
    'import {\n  CopilotRuntime,\n} from "@copilotkit/runtime";',
  ],
  [
    "a multi-symbol Runtime import",
    "",
    'import { ExperimentalEmptyAdapter, CopilotRuntime } from "@copilotkit/runtime";',
  ],
  [
    "a namespace Runtime member",
    "",
    'import * as Runtime from "@copilotkit/runtime";\nconst runtime = new Runtime.CopilotRuntime({});',
  ],
  [
    "a Runtime /v2 import",
    "",
    'import { CopilotRuntime } from "@copilotkit/runtime/v2";\nconst runtime = new CopilotRuntime({});',
  ],
  [
    "an aliased Runtime /v2 import",
    "",
    'import { CopilotRuntime as ManagedRuntime } from "@copilotkit/runtime/v2";\nconst runtime = new ManagedRuntime({});',
  ],
  [
    "a namespace Runtime /v2 construction",
    "",
    'import * as RuntimeV2 from "@copilotkit/runtime/v2";\nconst runtime = new RuntimeV2.CopilotRuntime({});',
  ],
  [
    "a bare executable Runtime construction",
    "",
    "const runtime = new CopilotRuntime({});",
  ],
])("rejects %s", (_caseName, drawer, headless) => {
  expect(() =>
    expectNoRetiredThreadSetup(createEntryPointFixture(drawer, headless)),
  ).toThrow();
});

test("binds retired-code scans to entry-point paths", () => {
  const reorderedContents = createEntryPointFixture(
    'publicLicenseKey="stale"',
    'import { CopilotRuntime } from "@copilotkit/runtime";',
    true,
  );

  expect(() => expectNoRetiredThreadSetup(reorderedContents)).toThrow();
});

test("documents a typed headless thread-selection component boundary", () => {
  const headlessThreads = readContent(headlessEntryPointPath);
  const fences = extractMdxCodeFences(headlessThreads);
  const threadSidebar = findMdxCodeFence(
    fences,
    "tsx",
    "ThreadSidebar.tsx",
    "function ThreadSidebar",
  );
  const app = findMdxCodeFence(fences, "tsx", "App.tsx");

  expect
    .soft(threadSidebar)
    .toMatch(
      /interface ThreadSidebarProps\s*\{\s*onSelectThread:\s*\(threadId:\s*string\)\s*=>\s*void;\s*onNewThread:\s*\(\)\s*=>\s*void;\s*\}/,
    );
  expect
    .soft(threadSidebar)
    .toMatch(
      /export function ThreadSidebar\(\{\s*onSelectThread,\s*onNewThread,\s*\}:\s*ThreadSidebarProps\)/,
    );
  expect
    .soft(threadSidebar)
    .toMatch(
      /<button\s+onClick=\{\(\)\s*=>\s*onSelectThread\(thread\.id\)\}\s*>\s*Open\s*<\/button>/,
    );
  expect
    .soft(threadSidebar.match(/\bonSelectThread\(thread\.id\)/g) ?? [])
    .toHaveLength(1);

  expect
    .soft(app)
    .toContain('import { ThreadSidebar } from "./ThreadSidebar";');
  expect.soft(app.match(/<ThreadSidebar\b/g) ?? []).toHaveLength(1);
  expect(app).toMatch(
    /<ThreadSidebar\s+onSelectThread=\{setActiveThreadId\}\s+onNewThread=\{startNewThread\}\s*\/>/,
  );
});

test("uses one explicit agent ID for the headless thread list and chat", () => {
  const headlessThreads = readContent(headlessEntryPointPath);
  const fences = extractMdxCodeFences(headlessThreads);
  const threadSidebar = findMdxCodeFence(
    fences,
    "tsx",
    "ThreadSidebar.tsx",
    "function ThreadSidebar",
  );
  const app = findMdxCodeFence(fences, "tsx", "App.tsx");
  const listAgentId = threadSidebar.match(
    /useThreads\(\s*\{[\s\S]*?\bagentId\s*:\s*(["'])([^"']+)\1[\s\S]*?\}\s*\)/,
  )?.[2];

  expect.soft(listAgentId).toBe("my-agent");
  expectHostedAgentIdOverrides(app, listAgentId ?? "");
});

test.each([
  {
    caseName: "a later direct CopilotChat override",
    replacement:
      '<CopilotChat agentId="my-agent" threadId={activeThreadId} />\n              <CopilotChat agentId="other-agent" />',
  },
  {
    caseName: "an inline JSX spread override",
    replacement:
      '<CopilotChat agentId="my-agent" threadId={activeThreadId} {...{ agentId: "other-agent" }} />',
  },
  {
    caseName: "a nested inline JSX spread override",
    replacement:
      '<CopilotChat agentId="my-agent" threadId={activeThreadId} />\n              <section><CopilotChat {...{ agentId: "other-agent" }} /></section>',
  },
])("rejects $caseName", ({ replacement }) => {
  const mutatedHeadlessGuide = readContent(headlessEntryPointPath).replace(
    '<CopilotChat agentId="my-agent" threadId={activeThreadId} />',
    replacement,
  );
  const app = findMdxCodeFence(
    extractMdxCodeFences(mutatedHeadlessGuide),
    "tsx",
    "App.tsx",
  );

  expect(() => expectHostedAgentIdOverrides(app, "my-agent")).toThrow();
});

test.each([
  {
    caseName: "a static computed agentId override",
    setup: "",
    replacement:
      '<CopilotChat agentId="my-agent" threadId={activeThreadId} {...{ ["agentId"]: "other-agent" }} />',
  },
  {
    caseName: "an ambiguous computed property on a target spread",
    setup:
      'const chatProp = Math.random() ? "agentId" : "className";\n        const chatProps = { [chatProp]: "other-agent" };\n\n        ',
    replacement:
      '<CopilotChat agentId="my-agent" threadId={activeThreadId} {...chatProps} />',
  },
  {
    caseName: "a shorthand agentId override",
    setup: 'const agentId = "other-agent";\n\n        ',
    replacement:
      '<CopilotChat agentId="my-agent" threadId={activeThreadId} {...{ agentId }} />',
  },
  {
    caseName: "a valueless direct agentId override",
    setup: "",
    replacement:
      '<CopilotChat agentId="my-agent" threadId={activeThreadId} agentId />',
  },
])("rejects $caseName", ({ setup, replacement }) => {
  const mutatedHeadlessGuide = readContent(headlessEntryPointPath)
    .replace("        function App() {", `        ${setup}function App() {`)
    .replace(
      '<CopilotChat agentId="my-agent" threadId={activeThreadId} />',
      replacement,
    );
  const app = findMdxCodeFence(
    extractMdxCodeFences(mutatedHeadlessGuide),
    "tsx",
    "App.tsx",
  );

  expect(() => expectHostedAgentIdOverrides(app, "my-agent")).toThrow();
});

test("rejects an agentId override on an aliased chat component", () => {
  const mutatedHeadlessGuide = readContent(headlessEntryPointPath)
    .replace(
      'import { CopilotChat } from "@copilotkit/react-core/v2";',
      'import { CopilotChat as Chat } from "@copilotkit/react-core/v2";',
    )
    .replace(
      '<CopilotChat agentId="my-agent" threadId={activeThreadId} />',
      '<Chat agentId="other-agent" threadId={activeThreadId} />',
    );
  const app = findMdxCodeFence(
    extractMdxCodeFences(mutatedHeadlessGuide),
    "tsx",
    "App.tsx",
  );

  expect(extractHostedAgentIdOverrides(app)).toEqual(["other-agent"]);
  expect(() => expectHostedAgentIdOverrides(app, "my-agent")).toThrow();
});

test.each([
  drawerEntryPointPath,
  headlessEntryPointPath,
  drawerReferencePath,
  useThreadsReferencePath,
])("%s documents default cursor pagination", (path) => {
  const content = collapseWhitespace(readContent(path));

  expect
    .soft(content)
    .toMatch(/(?:default page size (?:is|of)|defaults? to) 50/i);
  expect.soft(content).toContain("`nextCursor`");
  expect.soft(content).toMatch(/`limit`[^.]*override[^.]*page size/i);
  expect(content).not.toMatch(
    /(?:omit (?:it|`limit`) to load (?:all|the full list)|only meaningful when `limit` is set|`limit`[^.]*enable(?:s)? cursor-based pagination)/i,
  );
});

test("the Drawer reference shows that limit defaults to undefined", () => {
  const reference = readContent(drawerReferencePath);

  expect(reference).toContain(
    '<PropertyReference name="limit" type="number" default="undefined">',
  );
});

test("public React TSDoc keeps pagination active when limit is omitted", () => {
  const drawerSource = fs.readFileSync(drawerWrapperSourceUrl, "utf8");
  const useThreadsSource = fs.readFileSync(useThreadsSourceUrl, "utf8");

  expectPublicReactPaginationTsdoc(drawerSource, "CopilotThreadsDrawerProps");
  expectPublicReactPaginationTsdoc(useThreadsSource, "UseThreadsInput", {
    interfaceName: "UseThreadsResult",
    memberName: "hasMoreThreads",
  });
});

test("public thread and Drawer TSDoc satisfies the declaration/member matrix", () => {
  expectPublicTsdocContractMatrix(
    createPublicTsdocContractMatrix(
      fs.readFileSync(useThreadsSourceUrl, "utf8"),
      fs.readFileSync(drawerWrapperSourceUrl, "utf8"),
      fs.readFileSync(angularThreadsSourceUrl, "utf8"),
    ),
  );
});

test.each([
  "useThreads",
  "UseThreadsResult.threads",
  "CopilotThreadsDrawer",
  "CopilotThreadsDrawerProps.limit",
  "injectThreads",
  "InjectThreadsResult.hasMoreThreads",
])("does not let unrelated TSDoc satisfy %s", (target) => {
  const [declarationName = "", memberName] = target.split(".");
  const declaration = memberName
    ? `export interface ${declarationName} { /** Public docs are missing the contract. */ ${memberName}: unknown; }`
    : `/** Public docs are missing the contract. */ export function ${declarationName}(): void {}`;
  const source = `${declaration}\n/** Required target wording. */ function privateHelper(): void {}`;

  expect(() =>
    expectPublicTsdocContractMatrix([
      {
        source,
        declarationName,
        memberName,
        required: [/Required target wording/i],
      },
    ]),
  ).toThrow();
});

test("requires the omitted-limit guarantee on the public React limit member", () => {
  const source = `
    export interface UseThreadsInput {
      /** The default is 50 threads per page. */ limit?: number;
    }
    /** Cursor-based pagination remains active when this is omitted. */
    function privatePaginationNote(): void {}
  `;

  expect(() =>
    expectPublicTsdocContractMatrix([
      {
        source,
        declarationName: "UseThreadsInput",
        memberName: "limit",
        required: [
          /default is 50 threads per page/i,
          /pagination[^.]*active when this is omitted/i,
        ],
      },
    ]),
  ).toThrow();
});

test("implementation text cannot mask missing public pagination TSDoc", () => {
  const sourceWithImplementationOnly = `
    /** Lists threads. */
    const implementationDetails = {
      pageSize: "The default is 50 threads per page.",
      cursor: "\`nextCursor\`",
    };
  `;

  expect(() =>
    expectPublicReactPaginationTsdoc(
      sourceWithImplementationOnly,
      "PaginationInput",
    ),
  ).toThrow();
});

test("unrelated TSDoc cannot mask missing pagination docs on the public limit member", () => {
  const sourceWithUnrelatedTsdoc = `
    export interface PaginationInput {
      /** The default is 50 threads per page. */
      limit?: number;
    }

    /**
     * The default is 50 threads per page.
     * Cursor pagination uses \`nextCursor\`.
     */
    export interface UnrelatedResult {
      threads: unknown[];
    }
  `;

  expect(() =>
    expectPublicReactPaginationTsdoc(
      sourceWithUnrelatedTsdoc,
      "PaginationInput",
    ),
  ).toThrow();
});

test.each([
  ["plain text", `See ${canonicalGuidePath} for setup.`],
  ["an MDX comment", `{/* [Setup guide](${canonicalGuidePath}) */}`],
  [
    "a fenced-code mention",
    `\`\`\`md\n[Setup guide](${canonicalGuidePath})\n\`\`\``,
  ],
  ["a longer route", `[Setup guide](${canonicalGuidePath}-old)`],
])("rejects %s as a canonical guide link", async (_caseName, content) => {
  await expect(expectCanonicalGuideLink(content)).rejects.toThrow();
});

test.each([
  ["the exact route", `[Setup guide](${canonicalGuidePath})`],
  [
    "a route with a query string",
    `[Setup guide](${canonicalGuidePath}?source=cli)`,
  ],
  ["a route with a fragment", `[Setup guide](${canonicalGuidePath}#runtime)`],
])("accepts %s as a canonical guide link", async (_caseName, content) => {
  await expectCanonicalGuideLink(content);
});

test.each([
  {
    canonicalGuide: "",
    entryPoints: ["NEXT_PUBLIC_CPK_INTELLIGENCE_API_KEY"],
    identifier: "NEXT_PUBLIC_CPK_INTELLIGENCE_API_KEY",
  },
  {
    canonicalGuide: "",
    entryPoints: ["CPK_INTELLIGENCE_API_KEY_BACKUP"],
    identifier: "CPK_INTELLIGENCE_API_KEY_BACKUP",
  },
  {
    canonicalGuide: "INTELLIGENCE_API_KEY",
    entryPoints: [],
    identifier: "INTELLIGENCE_API_KEY",
  },
])(
  "rejects the unsafe managed identifier $identifier",
  ({ canonicalGuide, entryPoints, identifier }) => {
    expect(findUnsafeManagedIdentifiers(canonicalGuide, entryPoints)).toEqual([
      identifier,
    ]);
  },
);

test("the Headless guide and React reference document run-based ordering", () => {
  const headlessThreads = readContent(headlessEntryPointPath);
  const sectionStart = headlessThreads.indexOf(
    "### List and manage threads with useThreads",
  );
  const sectionEnd = headlessThreads.indexOf(
    "### Switch between threads",
    sectionStart + 1,
  );

  expect(sectionStart).toBeGreaterThanOrEqual(0);
  expect(sectionEnd).toBeGreaterThan(sectionStart);

  const section = collapseWhitespace(
    headlessThreads.slice(sectionStart, sectionEnd),
  );
  const useThreadsReference = collapseWhitespace(
    readContent(useThreadsReferencePath),
  );
  const recencyOrder =
    "The `threads` array is sorted by recency: `lastRunAt` when present, falling back to `updatedAt`, then `createdAt` (most recent first).";

  for (const source of [section, useThreadsReference]) {
    expect.soft(source).toContain(recencyOrder);
    expect(source).not.toMatch(
      /(?:most recently updated first|sorted by `updatedAt` descending)/,
    );
  }
  expect(section).toContain(
    "Metadata-only updates such as rename or archive do not change the sort key for a thread that already has `lastRunAt`.",
  );
});

test("keeps shared Headless prerequisites provider-neutral", () => {
  const a2aHeadlessPage = readContent(
    "docs/integrations/a2a/headless-threads.mdx",
  );
  const sharedHeadlessGuide = readContent(headlessEntryPointPath);

  expect(a2aHeadlessPage).toContain(
    'import HeadlessThreads from "@/snippets/shared/threads/headless-threads.mdx";',
  );
  expect(sharedHeadlessGuide).toContain(
    "Credentials required by your configured agent provider or remote agent",
  );
  expect(sharedHeadlessGuide).not.toMatch(/^\s*- An OpenAI API key\s*$/m);
});

test("accepts the exact server-side managed key identifier", () => {
  expect(findUnsafeManagedIdentifiers("CPK_INTELLIGENCE_API_KEY", [])).toEqual(
    [],
  );
});

test("ignores prose that does not form an environment identifier", () => {
  expect(
    findUnsafeManagedIdentifiers(
      "Keep the Intelligence API key on the server.",
      [],
    ),
  ).toEqual([]);
});

test("does not promise an unused license key during hosted Quickstart signup", () => {
  const quickstart = readContent(
    "docs/integrations/built-in-agent/quickstart.mdx",
  );
  const hostedSignupLine = quickstart
    .split("\n")
    .find((line) =>
      line.includes('surface="docs_built_in_agent_quickstart_step1"'),
    );

  expect(hostedSignupLine).toContain(
    "With that account, you can later create or select a hosted project for persistent Threads and the Inspector.",
  );
  expect(hostedSignupLine).not.toMatch(/\blicense key\b/i);
});

test.each([
  {
    path: "docs/premium/managed-intelligence-platform.mdx",
    unqualifiedCreateClaim:
      "The CLI provisions a project-scoped key during `create` and `project select`",
  },
  {
    path: "snippets/shared/cli/cli.mdx",
    unqualifiedCreateClaim:
      "scaffolds the starter, and connects the app to a cloud-hosted Enterprise Intelligence project",
  },
])(
  "$path limits create-time managed provisioning to Threads-enabled starters",
  ({ path, unqualifiedCreateClaim }) => {
    const content = readContent(path);

    expect(content).toContain(
      "`create` scaffolds any supported starter. During `create`, only starters with Threads support continue through managed project selection and project-scoped key provisioning.",
    );
    expect(content).toContain(
      "[Connect an Existing App to Hosted Intelligence](/premium/existing-app-hosted-intelligence)",
    );
    expect(content).not.toContain(unqualifiedCreateClaim);
  },
);

test("distinguishes hosted onboarding from deployment-neutral Threads UI", () => {
  const managed = readContent("docs/premium/managed-intelligence-platform.mdx");
  const drawer = readContent(
    "snippets/shared/basics/copilot-threads-drawer.mdx",
  );
  const cli = readContent("snippets/shared/cli/cli.mdx");

  expect(managed).toContain(
    "For an existing app that you want to connect to the cloud-hosted service, run `npx copilotkit@latest project select`, then follow [Connect an Existing App to Hosted Intelligence](/premium/existing-app-hosted-intelligence).",
  );
  expect(managed).not.toContain(
    "For any existing app with a working Runtime v2 endpoint",
  );
  expect(drawer).toContain(
    "The React setup below is the same for cloud-hosted and self-hosted deployments; only the platform endpoint and Runtime credential change.",
  );
  expect(drawer).toContain(
    "For a cloud-hosted project, follow [Connect an Existing App to Hosted Intelligence](/premium/existing-app-hosted-intelligence) first.",
  );
  expect(drawer).not.toContain(
    "If your app already has a working Runtime v2 endpoint",
  );
  expect(cli).toContain(
    "For cloud-hosted Intelligence, it handles browser sign-in, project selection, project-scoped Runtime keys, and local project configuration.",
  );
  expect(cli).toContain(
    "Its import command can also target a self-hosted deployment through explicit destination flags, and its license commands support self-hosted or offline enterprise flows.",
  );
  expect(cli).toContain(
    "For an existing app that you want to connect to a cloud-hosted project, run `npx copilotkit@latest project select`, then follow [Connect an Existing App to Hosted Intelligence](/premium/existing-app-hosted-intelligence).",
  );
  expect(cli).not.toContain(
    "For any existing app with a working Runtime v2 endpoint",
  );
  expect(cli).not.toContain(
    "`project select` works in any app that already has a working Runtime v2 endpoint",
  );
});

const conditionalTelemetryClaim =
  "When telemetry is enabled and identity creation succeeds, the CLI may write `CPK_TELEMETRY_ID` for analytics attribution.";
const requiredKeyClaim =
  "`CPK_INTELLIGENCE_API_KEY` remains required for managed connectivity.";
const projectKeyOnlyClaim =
  "A selected project and its project-scoped key are a valid managed setup without `CPK_TELEMETRY_ID`.";

test("the CLI project config example shows every persisted binding field", () => {
  const projectConfigExample = findCliCodeFence(
    "json",
    ".copilotkit/project.json",
  );
  const serializedFields = Array.from(
    projectConfigExample.matchAll(/^\s*"([^"]+)"\s*:/gm),
    (match) => match[1],
  );

  expect(() => JSON.parse(projectConfigExample)).not.toThrow();
  expect(serializedFields).toEqual([
    "projectId",
    "projectSlug",
    "projectName",
    "clerkOrgId",
    "telemetryBindingId",
  ]);
});

test("the CLI .env example marks telemetry output as conditional", () => {
  const envExample = findCliCodeFence("bash", ".env");
  const envLines = envExample.split("\n").map((line) => line.trim());
  const keyIndex = envLines.indexOf("CPK_INTELLIGENCE_API_KEY=cpk_...");
  const telemetryIndex = envLines.indexOf("CPK_TELEMETRY_ID=...");

  expect(keyIndex).toBeGreaterThanOrEqual(0);
  expect(envLines[keyIndex - 2]).toBe(
    "# Your CopilotKit Enterprise Intelligence API Key",
  );
  expect(telemetryIndex).toBeGreaterThan(keyIndex);
  expect(envLines[telemetryIndex - 1]).toBe(
    "# Optional: written only when telemetry is enabled and identity creation succeeds",
  );
});

test("allows import and project reselection from any configured existing app", () => {
  const existingAppGuide = readCanonicalGuide();
  const cli = readContent("snippets/shared/cli/cli.mdx");
  const importStart = cli.indexOf(
    "## Import and synchronize historical conversations",
  );
  const authStart = cli.indexOf("## Auth commands", importStart);

  expect
    .soft(existingAppGuide)
    .toContain("Run these commands from your existing app:");
  expect
    .soft(existingAppGuide)
    .toContain(
      "The CLI records the project in `.copilotkit/project.json` and writes the project key to `.env`",
    );
  expect.soft(importStart).toBeGreaterThanOrEqual(0);
  expect.soft(authStart).toBeGreaterThan(importStart);

  const importSection = cli.slice(importStart, authStart).replace(/\s+/g, " ");

  expect.soft(importSection).not.toContain("created with the CLI");
  expect
    .soft(importSection)
    .toContain(
      "Use `import` from any existing app directory with Enterprise Intelligence enabled. The app does not need to have been created by the CLI.",
    );
  expect(importSection).toContain(
    "Any existing app can safely re-run `project select` before the dry run",
  );
  expect(importSection).toContain(
    "It does not by itself set the import destination.",
  );
  expect(importSection).toContain(
    "The importer does not load `.env` or `.copilotkit/project.json` automatically.",
  );
  expect(importSection).not.toContain(
    "The importer uses the selected project by default.",
  );
});

test.each([
  {
    path: "docs/premium/managed-intelligence-platform.mdx",
    sectionStart: "## API keys",
    sectionEnd: "## Threads and conversation history",
    staleClaims: [
      "It also writes the non-secret `CPK_TELEMETRY_ID` for analytics attribution.",
    ],
    preservedClaim:
      "Managed setup does not issue or write `COPILOTKIT_LICENSE_TOKEN`.",
  },
  {
    path: "snippets/shared/cli/cli.mdx",
    sectionStart: "### Use the generated environment",
    sectionEnd: "### Start development",
    staleClaims: [
      "The CLI writes the project-scoped runtime key and telemetry metadata to `.env`.",
      "The CLI writes `CPK_TELEMETRY_ID` for analytics attribution",
    ],
    preservedClaim: undefined,
  },
])(
  "$path makes telemetry identity output conditional in its managed setup section",
  ({ path, sectionStart, sectionEnd, staleClaims, preservedClaim }) => {
    const content = readContent(path);
    const startIndex = content.indexOf(sectionStart);
    const endIndex = content.indexOf(
      sectionEnd,
      startIndex + sectionStart.length,
    );

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);

    const section = content.slice(startIndex, endIndex).replace(/\s+/g, " ");

    expect(section).toContain(conditionalTelemetryClaim);
    expect(section).toContain(requiredKeyClaim);
    expect(section).toContain(projectKeyOnlyClaim);
    for (const staleClaim of staleClaims) {
      expect(section).not.toContain(staleClaim);
    }
    if (preservedClaim !== undefined) {
      expect(section).toContain(preservedClaim);
    }
  },
);
