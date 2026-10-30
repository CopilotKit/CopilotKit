import { defineConfig } from "kiira-core";

// Type-checks every ts/tsx/js/jsx fence in the docs against the real
// CopilotKit source, so a page cannot teach an API that was renamed, removed,
// or deprecated. Run with `pnpm docs:check` (or `nx run CopilotKit:docs:check`).
//
// Compiler options and the workspace-source path overrides live in
// tsconfig.docs.json, which kiira picks up automatically.

const CONTENT = "showcase/shell-docs/src/content";

export default defineConfig({
  include: [`${CONTENT}/**/*.{md,mdx}`],
  exclude: [
    // Release notes and upgrade guides for 1.x releases. Every fence shows 1.x
    // code on purpose, and 2.0 removed those APIs, so nothing on these pages
    // can type-check against the current source.
    `${CONTENT}/docs/whats-new/v1-50.mdx`,
    `${CONTENT}/docs/migrate/1.8.2.mdx`,
    `${CONTENT}/docs/migrate/1.10.X.mdx`,
    `${CONTENT}/snippets/shared/troubleshooting/migrate-to-1.8.2.mdx`,
    `${CONTENT}/snippets/shared/troubleshooting/migrate-to-1.10.X.mdx`,
  ],
  rules: {
    // A page must not teach an API that is tagged @deprecated.
    "deprecated-import": "error",
  },
  // Packages the docs import that no workspace package depends on. kiira
  // installs them into an isolated cache (node_modules/.kiira) and checks the
  // snippets against their real types instead of `ignore`-ing them. Keep each
  // range on the major a reader installs next to CopilotKit 2.0.
  externalPackages: {
    // CopilotKit takes Standard Schema and peers zod >=3.25, so a reader
    // installs zod 4. tsconfig.docs.json points `zod` at this copy: the zod 3
    // copies in the workspace make Mastra's tool generics hit "Type
    // instantiation is excessively deep" and cost gigabytes of memory.
    zod: "^4.0.0",
    // AG-UI integrations shown in the integration guides.
    "@ag-ui/agno": "^0.0.6",
    "@ag-ui/aws-strands": "^1.0.1",
    "@ag-ui/claude-agent-sdk": "^0.0.8",
    "@ag-ui/claude-managed-agents": "^0.0.4",
    "@ag-ui/llamaindex": "^0.3.0",
    "@ag-ui/mastra": "^2.0.1",
    "@strands-agents/sdk": "^1.22.0",
    "@mastra/client-js": "^1.57.0",
    deepagents: "^1.16.0",
    // BuiltInAgent factories. The runtime types TanStack AI structurally and
    // does not depend on it, so check against the release a reader installs.
    "@tanstack/ai": "^1.0.0",
    "@tanstack/ai-openai": "^1.0.0",
    "@tanstack/ai-anthropic": "^1.0.0",
    // Same AI SDK major as the runtime's `ai` / `@ai-sdk/openai`.
    "@ai-sdk/azure": "^3.0.0",
    // One copy for every import (see tsconfig.docs.json for why).
    "@ai-sdk/provider-utils": "^4.0.0",
    // Servers, deploy targets, and libraries shown in guides and cookbooks.
    "@nestjs/common": "^12.0.0",
    "@tanstack/react-start": "^1.169.0",
    "@tanstack/react-router": "^1.170.0",
    "@types/deno": "^2.0.0",
    "@sentry/nextjs": "^11.0.0",
    "@react-native/metro-config": "^0.85.0",
    "aws-cdk-lib": "^2.0.0",
    "@types/aws-lambda": "^8.10.0",
    "serverless-http": "^4.0.0",
    "rehype-highlight": "^7.0.0",
    "rehype-katex": "^7.0.0",
    "react-markdown": "^10.0.0",
    "remark-gfm": "^4.0.0",
    "remark-math": "^6.0.0",
    "@heroicons/react": "^2.0.0",
    "@a2ui/lit": "^0.14.0",
    "react-native-streamdown": "^0.3.0",
    "@arcadeai/arcadejs": "^2.4.1",
    // Same version scripts/doc-tests runs the Daytona cookbook against.
    "@daytonaio/sdk": "0.182.0",
    "@typesafe-ai/sdk": "^0.7.0",
    "mcp-use": "^2.12.0",
    "@anthropic-ai/sdk": "^1.0.0",
    "@openbox-ai/openbox-sdk": "^0.1.1",
  },
  plugins: [
    {
      name: "copilotkit-docs",
      typescript: () => ({
        // `@/…` is the project-root alias of the reader's own Next.js or
        // Vite app (`@/components/…`, `@/lib/…`). Treat it like a relative
        // import, which kiira already leaves unchecked: it stands for code the
        // reader writes, not for a package we can resolve.
        filterDiagnostic: (diagnostic) =>
          !(
            diagnostic.code === 2307 &&
            /Cannot find module '@\//.test(diagnostic.message)
          ),
      }),
    },
  ],
  overrides: [
    // Channels UI is JSX rendered by the channels runtime, not React. The
    // pages tell readers to set this same jsxImportSource.
    {
      include: [
        `${CONTENT}/docs/channels/**`,
        `${CONTENT}/reference/channels/**`,
      ],
      jsxImportSource: "@copilotkit/channels",
    },
    // NestJS decorators need the legacy decorator mode; Nest projects turn it
    // on in their own tsconfig.
    {
      include: [
        `${CONTENT}/snippets/self-hosting-copilot-runtime-create-endpoint.mdx`,
        `${CONTENT}/snippets/self-hosting-copilot-runtime-starter.mdx`,
      ],
      experimentalDecorators: true,
    },
  ],
});
