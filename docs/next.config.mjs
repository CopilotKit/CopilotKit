import { createMDX } from 'fumadocs-mdx/next';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const withMDX = createMDX();

/**
 * Generate redirects for folders with meta.json but no index.mdx
 * Redirects to the first page in the meta.json pages array
 */
function generateFolderRedirects(baseDir) {
  const redirects = [];

  function scanDirectory(dir, urlPath = '') {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      if (!item.isDirectory()) continue;

      const fullPath = path.join(dir, item.name);
      const metaJsonPath = path.join(fullPath, 'meta.json');
      const indexMdxPath = path.join(fullPath, 'index.mdx');

      // Skip route groups like (root), (other)
      const isRouteGroup = item.name.match(/^\([^)]+\)$/);
      let currentUrlPath = urlPath;

      if (!isRouteGroup) {
        // Build URL path, removing 'integrations' prefix
        const pathSegments = urlPath.split('/').filter(Boolean);
        if (item.name !== 'integrations') {
          pathSegments.push(item.name);
        }
        currentUrlPath = '/' + pathSegments.join('/');
      }

      // Check if folder has meta.json but no index.mdx
      // Skip route groups - they're virtual groupings, not actual URL paths
      if (!isRouteGroup && fs.existsSync(metaJsonPath) && !fs.existsSync(indexMdxPath)) {
        try {
          const metaContent = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8'));
          if (metaContent.pages && metaContent.pages.length > 0) {
            // Get first page, filtering out separators and spread operators
            const firstPage = metaContent.pages.find(
              page => typeof page === 'string' && !page.startsWith('---') && !page.startsWith('...')
            );

            if (firstPage) {
              const source = currentUrlPath;
              const destination = `${currentUrlPath}/${firstPage}`;

              if (source && source !== '/') {
                redirects.push({
                  source,
                  destination,
                  permanent: true,
                });
              }
            }
          }
        } catch (error) {
          console.warn(`Warning: Could not parse ${metaJsonPath}:`, error.message);
        }
      }

      // Recursively scan subdirectories
      scanDirectory(fullPath, isRouteGroup ? urlPath : currentUrlPath);
    }
  }

  const contentDocsPath = path.join(__dirname, baseDir);
  if (fs.existsSync(contentDocsPath)) {
    scanDirectory(contentDocsPath);
  }

  return redirects;
}

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  env: {
    RB2B_ID: process.env.RB2B_ID,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    SCARF_PIXEL_ID: process.env.SCARF_PIXEL_ID,
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'github-production-user-asset-6210df.s3.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'fonts.gstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'docs.copilotkit.ai',
      },
      {
        protocol: 'https',
        hostname: 'cdn.copilotkit.ai',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  skipTrailingSlashRedirect: true,
  skipProxyUrlNormalize: true,

  // turbopack: true, // Disabled due to pnpm monorepo issues

  async rewrites() {
    const integrations = [
      'adk',
      'a2a',
      'ag2',
      'agno',
      'agent-spec',
      'crewai-flows',
      'built-in-agent',
      'langgraph',
      'deepagents',
      'llamaindex',
      'mastra',
      'pydantic-ai',
      'microsoft-agent-framework',
      'aws-strands',
    ];

    return {
      beforeFiles: [
        // PostHog reverse proxy — routes analytics through our domain to bypass ad blockers
        {
          source: '/ingest/static/:path*',
          destination: 'https://eu-assets.i.posthog.com/static/:path*',
        },
        {
          source: '/ingest/:path*',
          destination: 'https://eu.i.posthog.com/:path*',
        },
        // Map /guides/* to /built-in-agent/guides/* (legacy path)
        {
          source: '/guides/:path*',
          destination: '/built-in-agent/guides/:path*',
        },
        // Map integration URLs
        ...integrations.map((integration) => ({
          source: `/${integration}/:path*`,
          destination: `/integrations/${integration}/:path*`,
        })),
        // Map deploy section URLs
        {
          source: '/agentcore/:path*',
          destination: '/deploy/agentcore/:path*',
        },
      ],
    };
  },

  async redirects() {
    // Generate automatic redirects for folders with meta.json but no index.mdx
    const autoRedirects = generateFolderRedirects('content/docs');

    // Manual redirects for specific cases
    const manualRedirects = [
      // Redirect /whats-new/v1-50 to /learn/whats-new/v1-50
      {
        source: '/whats-new/v1-50',
        destination: '/learn/whats-new/v1-50',
        permanent: true,
      },
      // Redirect /reference root to /reference/v2
      {
        source: '/reference',
        destination: '/reference/v2',
        permanent: false,
      },
      {
        source: '/generative-ui-specs/:path*',
        destination: '/generative-ui/specs/:path*',
        permanent: true,
      },
      {
        source: '/coagents/:path*',
        destination: '/langgraph/:path*',
        permanent: true,
      },
      {
        source: '/crewai-crews/:path*',
        destination: '/crewai-flows/:path*',
        permanent: true,
      },
      {
        source: '/crewai-crews',
        destination: '/crewai-flows',
        permanent: true,
      },
      // Strip /generative-ui/ prefix from old URLs
      {
        source: '/generative-ui/direct-to-llm/:path*',
        destination: '/direct-to-llm/:path*',
        permanent: true,
      },
      {
        source: '/generative-ui/langgraph/:path*',
        destination: '/langgraph/:path*',
        permanent: true,
      },
      // Old /shared/ path redirects
      {
        source: '/shared/:path*',
        destination: '/:path*',
        permanent: true,
      },
      // aws-strands doesn't have human-in-the-loop, redirect to general one
      {
        source: '/aws-strands/human-in-the-loop',
        destination: '/human-in-the-loop',
        permanent: true,
      },
      {
        source: '/coagents/tutorials/ai-travel-app/overview',
        destination: '/coagents/tutorials/ai-travel-app',
        permanent: true,
      },
      {
        source: '/coagents/chat-ui/hitl/json-hitl',
        destination: '/coagents/chat-ui/hitl',
        permanent: true,
      },
      {
        source: '/coagents/react-ui/frontend-functions',
        destination: '/coagents/react-ui/hitl',
        permanent: true,
      },
      {
        source: '/coagents/chat-ui/render-agent-state',
        destination: '/coagents/generative-ui/agentic',
        permanent: true,
      },
      {
        source: '/coagents/chat-ui/hitl',
        destination: '/coagents/human-in-the-loop/node-flow',
        permanent: true,
      },
      {
        source: '/coagents/chat-ui/hitl/interrupt-flow',
        destination: '/coagents/human-in-the-loop/interrupt-flow',
        permanent: true,
      },
      {
        source: '/coagents/chat-ui/loading-message-history',
        destination: '/coagents/persistence/loading-message-history',
        permanent: true,
      },
      {
        source: '/coagents/react-ui/in-app-agent-read',
        destination: '/coagents/shared-state/in-app-agent-read',
        permanent: true,
      },
      {
        source: '/coagents/react-ui/in-app-agent-write',
        destination: '/coagents/shared-state/in-app-agent-write',
        permanent: true,
      },
      {
        source: '/coagents/react-ui/hitl',
        destination: '/coagents/human-in-the-loop/node-flow',
        permanent: true,
      },
      {
        source: '/coagents/advanced/router-mode-agent-lock',
        destination: '/coagents',
        permanent: true,
      },
      {
        source: '/coagents/advanced/intermediate-state-streaming',
        destination: '/coagents/shared-state/predictive-state-updates',
        permanent: true,
      },
      {
        source: '/coagents/shared-state/intermediate-state-streaming',
        destination: '/coagents/shared-state/predictive-state-updates',
        permanent: true,
      },
      {
        source: '/coagents/advanced/manually-emitting-messages',
        destination: '/coagents/advanced/emit-messages',
        permanent: true,
      },
      {
        source: '/coagents/advanced/state-streaming',
        destination: '/coagents/shared-state',
        permanent: true,
      },
      {
        source: '/coagents/advanced/copilotkit-state',
        destination: '/langgraph/frontend-tools',
        permanent: true,
      },
      {
        source: '/coagents/advanced/message-persistence',
        destination: '/coagents/persistence/message-persistence',
        permanent: true,
      },
      {
        source: '/coagents/advanced/loading-message-history',
        destination: '/coagents/persistence/loading-message-history',
        permanent: true,
      },
      {
        source: '/coagents/advanced/loading-agent-state',
        destination: '/coagents/persistence/loading-agent-state',
        permanent: true,
      },
      {
        source: '/coagents/concepts/state',
        destination: '/coagents/shared-state',
        permanent: true,
      },
      {
        source: '/coagents/concepts/human-in-the-loop',
        destination: '/coagents/human-in-the-loop',
        permanent: true,
      },
      {
        source: '/coagents/concepts/multi-agent-flows',
        destination: '/coagents',
        permanent: true,
      },
      {
        source: '/llamaindex/multi-agent-flows',
        destination: '/llamaindex',
        permanent: true,
      },
      {
        source: '/crewai-flows/multi-agent-flows',
        destination: '/crewai-flows',
        permanent: true,
      },
      {
        source: '/langgraph/advanced/multi-agent-flows',
        destination: '/langgraph',
        permanent: true,
      },
      {
        source: '/coagents/quickstart/langgraph',
        destination: '/coagents/quickstart',
        permanent: true,
      },
      {
        source: '/langgraph/quickstart/langgraph',
        destination: '/langgraph/quickstart',
        permanent: true,
      },
      {
        source: '/crewai-flows/quickstart/crewai',
        destination: '/crewai-flows/quickstart',
        permanent: true,
      },
      {
        source: '/mastra/quickstart/mastra',
        destination: '/mastra/quickstart',
        permanent: true,
      },
      {
        source: '/ag2/quickstart/ag2',
        destination: '/ag2/quickstart',
        permanent: true,
      },
      {
        source: '/llamaindex/',
        destination: '/llamaindex',
        permanent: true,
      },
      {
        source: '/agno/quickstart/agno',
        destination: '/agno/quickstart',
        permanent: true,
      },
      {
        source: '/mcp',
        destination: '/coding-agents',
        permanent: true,
      },
      {
        source: '/vibe-coding-mcp',
        destination: '/coding-agents',
        permanent: true,
      },
      {
        source: '/ag2/mcp',
        destination: '/ag2/coding-agents',
        permanent: true,
      },
      {
        source: '/agno/mcp',
        destination: '/agno/coding-agents',
        permanent: true,
      },
      {
        source: '/crewai-flows/mcp',
        destination: '/crewai-flows/coding-agents',
        permanent: true,
      },
      {
        source: '/direct-to-llm/guides/mcp',
        destination: '/built-in-agent/coding-agents',
        permanent: true,
      },
      {
        source: '/langgraph/mcp',
        destination: '/langgraph/coding-agents',
        permanent: true,
      },
      {
        source: '/llamaindex/mcp',
        destination: '/llamaindex/coding-agents',
        permanent: true,
      },
      {
        source: '/mastra/mcp',
        destination: '/mastra/coding-agents',
        permanent: true,
      },
      {
        source: '/pydantic-ai/mcp',
        destination: '/pydantic-ai/coding-agents',
        permanent: true,
      },
      {
        source: '/pydantic-ai/quickstart/pydantic-ai',
        destination: '/pydantic-ai/quickstart',
        permanent: true,
      },
      {
        source: '/adk/quickstart/adk',
        destination: '/adk/quickstart',
        permanent: true,
      },
      {
        source: '/adk/mcp',
        destination: '/adk/coding-agents',
        permanent: true,
      },
      {
        source: "/adk/shared-state/state-inputs-outputs",
        destination: "/adk/shared-state/workflow-execution",
        permanent: true,
      },
      {
        source: "/langgraph/shared-state/state-inputs-outputs",
        destination: "/langgraph/shared-state/workflow-execution",
        permanent: true,
      },
      {
        source: "/llamaindex/shared-state/state-inputs-outputs",
        destination: "/llamaindex/shared-state/workflow-execution",
        permanent: true,
      },
      {
        source: "/coagents/shared-state/state-inputs-outputs",
        destination: "/langgraph/shared-state/workflow-execution",
        permanent: true,
      },
      // Learn tab — content moved from root
      {
        source: '/agentic-protocols',
        destination: '/learn/agentic-protocols',
        permanent: true,
      },
      {
        source: '/ag-ui-protocol',
        destination: '/learn/ag-ui-protocol',
        permanent: true,
      },
      {
        source: '/ag-ui',
        destination: 'https://docs.ag-ui.com/',
        permanent: false,
      },
      {
        source: '/connect-mcp-servers',
        destination: '/learn/connect-mcp-servers',
        permanent: true,
      },
      {
        source: '/a2a-protocol',
        destination: '/learn/a2a-protocol',
        permanent: true,
      },
      {
        source: '/architecture',
        destination: '/learn/architecture',
        permanent: true,
      },

      // === Docs Restructure Redirects (2026-02) ===

      // Priority 1: direct-to-llm / builtin-agent → built-in-agent
      {
        source: '/direct-to-llm/:path*',
        destination: '/built-in-agent/:path*',
        permanent: true,
      },
      {
        source: '/builtin-agent/:path*',
        destination: '/built-in-agent/:path*',
        permanent: true,
      },

      // Priority 2: LangGraph-specific redirects
      {
        source: '/langgraph/generative-ui/display',
        destination: '/langgraph/generative-ui/your-components/display-only',
        permanent: true,
      },
      {
        source: '/langgraph/generative-ui/interactive/interrupt-based',
        destination: '/langgraph/generative-ui/your-components/interrupt-based',
        permanent: true,
      },
      {
        source: '/langgraph/generative-ui/interactive/client-side',
        destination: '/langgraph/generative-ui/your-components/interactive',
        permanent: true,
      },
      {
        source: '/langgraph/human-in-the-loop/node-flow',
        destination: '/langgraph/human-in-the-loop/interrupt-flow',
        permanent: true,
      },
      {
        source: '/langgraph/human-in-the-loop/prebuilt-agents',
        destination: '/langgraph/prebuilt-components',
        permanent: true,
      },

      // === 404 cleanup (2026-05) — see PostHog broken_link_accessed events ===

      // Generative UI specs moved under /learn/
      {
        source: '/generative-ui/specs',
        destination: '/learn/generative-ui/specs',
        permanent: true,
      },
      {
        source: '/generative-ui/specs/:path*',
        destination: '/learn/generative-ui/specs/:path*',
        permanent: true,
      },

      // /premium/threads and /premium/inspector are top-level pages, not under /premium
      {
        source: '/premium/threads',
        destination: '/threads',
        permanent: true,
      },
      {
        source: '/premium/inspector',
        destination: '/inspector',
        permanent: true,
      },
      {
        source: '/premium/premium/overview',
        destination: '/premium/overview',
        permanent: true,
      },

      // /built-in-agent/guides/* — guides/ prefix dropped in restructure
      {
        source: '/built-in-agent/guides/quickstart',
        destination: '/built-in-agent/quickstart',
        permanent: true,
      },
      {
        source: '/built-in-agent/guides/use-agent-hook',
        destination: '/built-in-agent/programmatic-control',
        permanent: true,
      },
      {
        source: '/built-in-agent/guides/self-hosting',
        destination: '/built-in-agent/premium/self-hosting',
        permanent: true,
      },
      {
        source: '/built-in-agent/guides/:path*',
        destination: '/built-in-agent',
        permanent: true,
      },

      // /built-in-agent/* pages with no built-in-agent equivalent → root or closest concept
      {
        source: '/built-in-agent/human-in-the-loop',
        destination: '/human-in-the-loop',
        permanent: true,
      },
      {
        source: '/built-in-agent/generative-ui/state-rendering',
        destination: '/built-in-agent/generative-ui',
        permanent: true,
      },
      {
        source: '/built-in-agent/cookbook/state-machine',
        destination: '/built-in-agent/programmatic-control',
        permanent: true,
      },

      // /learn/direct-to-llm/* — direct-to-llm namespace removed in 2026-02 restructure
      {
        source: '/learn/direct-to-llm/tutorials/ai-todo-app/overview',
        destination: '/built-in-agent/quickstart',
        permanent: true,
      },
      {
        source: '/learn/generative-ui/direct-to-llm/tutorials/ai-todo-app/overview',
        destination: '/built-in-agent/quickstart',
        permanent: true,
      },
      {
        source: '/learn/direct-to-llm/cookbook/state-machine',
        destination: '/built-in-agent',
        permanent: true,
      },
      {
        source: '/learn/direct-to-llm/:path*',
        destination: '/built-in-agent',
        permanent: true,
      },

      // /learn/langgraph/* — langgraph was never under /learn
      {
        source: '/learn/langgraph/:path*',
        destination: '/langgraph/:path*',
        permanent: true,
      },

      // Deepagents integration is missing pages other integrations have → root equivalents
      {
        source: '/deepagents/prebuilt-components',
        destination: '/prebuilt-components',
        permanent: true,
      },
      {
        source: '/deepagents/custom-look-and-feel/headless-ui',
        destination: '/custom-look-and-feel/headless-ui',
        permanent: true,
      },
      {
        source: '/deepagents/custom-look-and-feel/slots',
        destination: '/custom-look-and-feel/slots',
        permanent: true,
      },

      // /guides/* paths with no /built-in-agent/guides equivalent
      {
        source: '/guides/backend-actions/remote-backend-endpoint',
        destination: '/built-in-agent/copilot-runtime',
        permanent: true,
      },
      {
        source: '/guides/model-context-protocol',
        destination: '/built-in-agent/mcp-servers',
        permanent: true,
      },

      // Reference v1 → v2 for hooks that only exist in v2
      {
        source: '/reference/v1/hooks/useRenderTool',
        destination: '/reference/v2/hooks/useRenderTool',
        permanent: true,
      },
      {
        source: '/reference/v1/hooks/useComponent',
        destination: '/reference/v2/hooks/useComponent',
        permanent: true,
      },
      {
        source: '/reference/v1/hooks/useThreads',
        destination: '/reference/v2/hooks/useThreads',
        permanent: true,
      },
      {
        source: '/reference/v1/hooks/useInterrupt',
        destination: '/reference/v2/hooks/useInterrupt',
        permanent: true,
      },
      {
        source: '/reference/v1/hooks/useCapabilities',
        destination: '/reference/v2/hooks/useCapabilities',
        permanent: true,
      },
      // useCopilotAction renamed to useFrontendTool in v2
      {
        source: '/reference/v2/hooks/useCopilotAction',
        destination: '/reference/v2/hooks/useFrontendTool',
        permanent: true,
      },

      // /whats-new/* moved under /learn/
      {
        source: '/whats-new',
        destination: '/learn/whats-new',
        permanent: true,
      },
      {
        source: '/whats-new/a2ui-launch',
        destination: '/learn/whats-new/a2ui-launch',
        permanent: true,
      },

      // Doubled-prefix paths (broken outbound link generation)
      {
        source: '/agent-spec/agent-spec/wayflow',
        destination: '/agent-spec/wayflow',
        permanent: true,
      },
      {
        source: '/langgraph/langgraph/overview',
        destination: '/langgraph',
        permanent: true,
      },

      // /langgraph/persistence/* moved under /langgraph/advanced/persistence/*
      {
        source: '/langgraph/persistence/message-persistence',
        destination: '/langgraph/advanced/persistence/message-persistence',
        permanent: true,
      },

      // Locale prefix not supported on this site
      {
        source: '/zh/langgraph/deep-agents',
        destination: '/deepagents',
        permanent: true,
      },

      // Old /langgraph/shared-guides/* paths
      {
        source: '/langgraph/shared-guides/langgraph-platform-authentication',
        destination: '/langgraph',
        permanent: true,
      },
    ];

    // Combine auto-generated and manual redirects
    return [...autoRedirects, ...manualRedirects];
  },
};

export default withMDX(config);
