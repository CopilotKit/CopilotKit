import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";

// A framework landing (`integrations/<folder>/index.mdx`) is one
// `<FrameworkOverview ...>` whose props carry the page's copy, so its
// processed Markdown (`getText("processed")`, what `/<framework>.md` serves)
// would be that JSX. This remark plugin replaces it there with the sections
// the component renders (`src/components/docs-mdx/showcase/framework-overview.tsx`):
// the hero, the capabilities, the CLI and quickstart, and the "Connect your
// agent" code (the element's children). The page's HTML is untouched.
//
// Links name the landing's own slug the way it's authored (`/mastra/...`) and
// come out without it (`/quickstart`), as the component strips them, so the
// export scopes them to the URL's framework like any other link.

type Replace = typeof replaceSource;

interface Estree {
  type: string;
  [key: string]: unknown;
}

interface JsxAttribute {
  type: string;
  name?: string;
  value?: string | null | { data?: { estree?: { body?: Estree[] } } };
}

interface Node {
  type: string;
  name?: string | null;
  attributes?: JsxAttribute[];
  children?: Node[];
}

/** A literal expression's value: strings, numbers, arrays, plain objects. */
function literal(node: Estree | null | undefined): unknown {
  switch (node?.type) {
    case "Literal":
      return node.value;
    case "TemplateLiteral": {
      const quasis = node.quasis as { value: { cooked: string } }[];
      return (node.expressions as unknown[]).length
        ? undefined
        : quasis.map((q) => q.value.cooked).join("");
    }
    case "ArrayExpression":
      return (node.elements as Estree[]).map(literal);
    case "ObjectExpression":
      return Object.fromEntries(
        (node.properties as Estree[]).flatMap((p) => {
          const key = p.key as Estree;
          if (p.type !== "Property" || p.computed) return [];
          const name = key.type === "Identifier" ? key.name : key.value;
          return [[String(name), literal(p.value as Estree)]];
        }),
      );
    case "BinaryExpression": {
      const left = literal(node.left as Estree);
      const right = literal(node.right as Estree);
      return node.operator === "+" &&
        typeof left === "string" &&
        typeof right === "string"
        ? left + right
        : undefined;
    }
    default:
      return undefined;
  }
}

/** A JSX element's props; expressions that aren't literals read as undefined. */
function jsxProps(node: Node): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const attr of node.attributes ?? []) {
    if (attr.type !== "mdxJsxAttribute" || !attr.name) continue;
    const { value } = attr;
    if (value == null) props[attr.name] = true;
    else if (typeof value === "string") props[attr.name] = value;
    else {
      const statement = value.data?.estree?.body?.[0];
      if (statement?.type === "ExpressionStatement") {
        props[attr.name] = literal(statement.expression as Estree);
      }
    }
  }
  return props;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** The landing as Markdown; `children` is the element's own stringified content. */
export function frameworkOverviewMarkdown(
  props: Record<string, unknown>,
  children: string,
): string {
  const name = str(props.frameworkName);
  const guideLink = str(props.guideLink);
  const slug = guideLink.split("/")[1] ?? "";
  // `/mastra/quickstart` is `/quickstart` on the landing's framework.
  const link = (href: string) =>
    slug && (href === `/${slug}` || href.startsWith(`/${slug}/`))
      ? href.slice(slug.length + 1) || "/"
      : href;
  const quickstart = link(guideLink || "/quickstart");

  const out = [
    `## ${str(props.header) || `Bring your ${name} agents into any app`}`,
    str(props.subheader) ||
      `CopilotKit is an open-source framework that connects your app to ${name} agents. Give your agents chat, generative UI, human-in-the-loop, AG-UI Streams, Automatic Learning and more.`,
    `[Quickstart](${quickstart})`,
  ];

  const features = (
    Array.isArray(props.supportedFeatures) ? props.supportedFeatures : []
  ).flatMap((f) => (record(f) ? [record(f)!] : []));
  if (features.length) {
    out.push(
      `## Build with ${name}`,
      str(props.lede) ||
        `Add the user-facing capabilities your ${name} agents need.`,
      features
        .map((f) => {
          const docs = str(f.documentationLink);
          const title = docs
            ? `[${str(f.title)}](${link(docs)})`
            : `**${str(f.title)}**`;
          const demo = str(f.demoLink)
            ? ` [Live demo](${link(str(f.demoLink))})`
            : "";
          return `- ${title}: ${str(f.description)}${demo}`;
        })
        .join("\n"),
    );
    const footnote = record(props.capabilitiesFootnote);
    if (footnote) {
      out.push(
        `${str(footnote.text)} [${str(footnote.linkLabel)}](${link(str(footnote.href))})`,
      );
    }
  }

  out.push(
    "## Start building",
    `Scaffold a new app with the CLI, or follow the quickstart to connect the ${name} agent you already run.`,
    `\`\`\`bash\n${str(props.initCommand) || "npx copilotkit@latest init"}\n\`\`\``,
    `[Read the quickstart](${quickstart})`,
  );

  const connect = record(props.connect);
  if (connect) {
    const code = str(connect.code);
    out.push(
      "## Connect your agent",
      str(connect.intro),
      children.trim() ||
        (code
          ? `\`\`\`${str(connect.language)} title="${str(connect.filename)}"\n${code}\n\`\`\``
          : ""),
      `[Read the setup guide](${link(str(connect.guideLink))})`,
    );
  }
  return out.filter(Boolean).join("\n\n");
}

/** Replace each `<FrameworkOverview>` in the processed Markdown. */
export function remarkFrameworkOverview() {
  return (tree: Node, file: Parameters<Replace>[0]) => {
    const visit = (node: Node) => {
      if (
        node.type === "mdxJsxFlowElement" &&
        node.name === "FrameworkOverview"
      ) {
        const props = jsxProps(node);
        replaceSource(file, node as Parameters<Replace>[1], (s) =>
          frameworkOverviewMarkdown(
            props,
            s.inner(node as Parameters<Replace>[1]),
          ),
        );
        return;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
