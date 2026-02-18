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
      'crewai-crews',
      'direct-to-llm',
      'langgraph',
      'llamaindex',
      'mastra',
      'pydantic-ai',
      'microsoft-agent-framework',
      'aws-strands',
    ];

    return {
      beforeFiles: [
        // Map /guides/* to /direct-to-llm/guides/*
        {
          source: '/guides/:path*',
          destination: '/direct-to-llm/guides/:path*',
        },
        // Map integration URLs
        ...integrations.map((integration) => ({
          source: `/${integration}/:path*`,
          destination: `/integrations/${integration}/:path*`,
        })),
      ],
    };
  },

  async redirects() {
    // Generate automatic redirects for folders with meta.json but no index.mdx
    const autoRedirects = generateFolderRedirects('content/docs');

    // Manual redirects for specific cases
    const manualRedirects = [
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
        destination: '/coagents/frontend-actions',
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
        source: '/crewai-crews/multi-agent-flows',
        destination: '/crewai-crews',
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
        source: '/crewai-crews/quickstart/crewai',
        destination: '/crewai-crews/quickstart',
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
        destination: '/vibe-coding-mcp',
        permanent: true,
      },
      {
        source: '/ag2/mcp',
        destination: '/ag2/vibe-coding-mcp',
        permanent: true,
      },
      {
        source: '/agno/mcp',
        destination: '/agno/vibe-coding-mcp',
        permanent: true,
      },
      {
        source: '/crewai-crews/mcp',
        destination: '/crewai-crews/vibe-coding-mcp',
        permanent: true,
      },
      {
        source: '/crewai-flows/mcp',
        destination: '/crewai-flows/vibe-coding-mcp',
        permanent: true,
      },
      {
        source: '/direct-to-llm/guides/mcp',
        destination: '/direct-to-llm/guides/vibe-coding-mcp',
        permanent: true,
      },
      {
        source: '/langgraph/mcp',
        destination: '/langgraph/vibe-coding-mcp',
        permanent: true,
      },
      {
        source: '/llamaindex/mcp',
        destination: '/llamaindex/vibe-coding-mcp',
        permanent: true,
      },
      {
        source: '/mastra/mcp',
        destination: '/mastra/vibe-coding-mcp',
        permanent: true,
      },
      {
        source: '/pydantic-ai/mcp',
        destination: '/pydantic-ai/vibe-coding-mcp',
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
        destination: '/adk/vibe-coding-mcp',
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
    ];

    // Combine auto-generated and manual redirects
    return [...autoRedirects, ...manualRedirects];
  },
};

export default withMDX(config);
