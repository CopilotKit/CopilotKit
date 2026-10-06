import type { LibraryMapping, SourceSpec, VariantMapping } from "./types";

const integration = (slug: string, file: string) =>
  `showcase/integrations/${slug}/${file}`;

function framework(
  name: string,
  registry: LibraryMapping["registry"],
  source: SourceSpec,
  reason: string,
  releasePolicy: LibraryMapping["releasePolicy"] = "stable",
): LibraryMapping {
  return {
    name,
    registry,
    role: "framework",
    required: true,
    reason,
    source,
    releasePolicy,
  };
}

const requirements = (slug: string): SourceSpec => ({
  kind: "requirements",
  path: integration(slug, "requirements.txt"),
});

const npm = (slug: string, agent = false): SourceSpec => {
  const directory = agent ? "src/agent/" : "";
  return {
    kind: "npm",
    path: integration(slug, `${directory}package.json`),
    lockPath: integration(slug, `${directory}package-lock.json`),
  };
};

const csproj = (
  slug: string,
  file: string,
  transitive = false,
): SourceSpec => ({
  kind: "csproj",
  path: integration(slug, `agent/${file}`),
  ...(transitive ? { transitive: true } : {}),
});

const pom = (property?: string, managedBy?: string): SourceSpec => ({
  kind: "pom",
  path: integration("spring-ai", "pom.xml"),
  ...(property ? { property } : {}),
  ...(managedBy ? { managedBy } : {}),
});

const adapter = (name: string) => ({
  name,
  reason:
    "AG-UI integration adapter; it does not define the selected framework's compatibility version",
});

const provider = (name: string) => ({
  name,
  reason:
    "Generic model-provider client, outside the selected framework-library score",
});

const candidate = (name: string) => ({
  name,
  reason: "Historical candidate not used by the mapped framework surface",
});

/** Explicit membership policy for every Showcase manifest, independent of available version evidence. */
export const COMPATIBILITY_MAPPING: VariantMapping[] = [
  {
    slug: "ag2",
    language: "python",
    libraries: [
      framework(
        "ag2",
        "pypi",
        requirements("ag2"),
        "Agent framework used by this variant",
      ),
    ],
    excludedLibraries: [],
  },
  {
    slug: "agno",
    language: "python",
    libraries: [
      framework(
        "agno",
        "pypi",
        requirements("agno"),
        "Agent framework used by this variant",
      ),
    ],
    excludedLibraries: [],
  },
  {
    slug: "built-in-agent",
    language: "typescript",
    excludedReason:
      "Built-in agent measures CopilotKit itself, not an external framework",
    libraries: [],
    excludedLibraries: [
      {
        name: "@copilotkit/runtime",
        reason:
          "CopilotKit's own runtime is internal and non-comparable with external frameworks",
      },
    ],
  },
  {
    slug: "claude-sdk-python",
    language: "python",
    libraries: [
      framework(
        "claude-agent-sdk",
        "pypi",
        requirements("claude-sdk-python"),
        "Claude agent framework",
      ),
    ],
    excludedLibraries: [adapter("ag-ui-claude-sdk")],
  },
  {
    slug: "claude-sdk-typescript",
    language: "typescript",
    libraries: [
      framework(
        "@anthropic-ai/claude-agent-sdk",
        "npm",
        npm("claude-sdk-typescript"),
        "Claude agent framework",
      ),
    ],
    excludedLibraries: [adapter("@ag-ui/claude-agent-sdk")],
  },
  {
    slug: "crewai-conversational-flows",
    language: "python",
    libraries: [
      framework(
        "crewai",
        "pypi",
        requirements("crewai-conversational-flows"),
        "CrewAI agent framework",
      ),
      framework(
        "crewai-tools",
        "pypi",
        requirements("crewai-conversational-flows"),
        "CrewAI tools package contributes to the framework surface",
      ),
    ],
    excludedLibraries: [adapter("ag-ui-crewai")],
  },
  {
    slug: "crewai-crews",
    language: "python",
    libraries: [
      framework(
        "crewai",
        "pypi",
        requirements("crewai-crews"),
        "CrewAI agent framework",
      ),
      framework(
        "crewai-tools",
        "pypi",
        requirements("crewai-crews"),
        "CrewAI tools package contributes to the framework surface",
      ),
    ],
    excludedLibraries: [adapter("ag-ui-crewai")],
  },
  {
    slug: "google-adk",
    language: "python",
    libraries: [
      framework(
        "google-adk",
        "pypi",
        requirements("google-adk"),
        "Google agent framework",
      ),
    ],
    excludedLibraries: [adapter("ag-ui-adk")],
  },
  {
    slug: "google-antigravity",
    language: "python",
    libraries: [
      framework(
        "google-antigravity",
        "pypi",
        requirements("google-antigravity"),
        "Google Antigravity agent framework SDK",
      ),
    ],
    excludedLibraries: [adapter("ag-ui-antigravity")],
  },
  {
    slug: "langgraph-fastapi",
    language: "python",
    libraries: [
      framework(
        "langgraph",
        "pypi",
        requirements("langgraph-fastapi"),
        "LangGraph agent framework",
      ),
      framework(
        "langgraph-api",
        "pypi",
        requirements("langgraph-fastapi"),
        "LangGraph API contributes to the deployed framework surface",
      ),
      framework(
        "langgraph-cli",
        "pypi",
        requirements("langgraph-fastapi"),
        "LangGraph CLI contributes to the deployed framework surface",
      ),
    ],
    excludedLibraries: [adapter("ag-ui-langgraph")],
  },
  {
    slug: "langgraph-python",
    language: "python",
    libraries: [
      framework(
        "langgraph",
        "pypi",
        requirements("langgraph-python"),
        "LangGraph agent framework",
      ),
      framework(
        "langgraph-api",
        "pypi",
        requirements("langgraph-python"),
        "LangGraph API contributes to the deployed framework surface",
      ),
      framework(
        "langgraph-cli",
        "pypi",
        requirements("langgraph-python"),
        "LangGraph CLI contributes to the deployed framework surface",
      ),
    ],
    excludedLibraries: [adapter("ag-ui-langgraph")],
  },
  {
    slug: "langgraph-typescript",
    language: "typescript",
    libraries: [
      framework(
        "@langchain/langgraph",
        "npm",
        npm("langgraph-typescript", true),
        "LangGraph agent framework",
      ),
      framework(
        "@langchain/langgraph-api",
        "npm",
        npm("langgraph-typescript", true),
        "LangGraph API package contributes to the framework surface",
      ),
      framework(
        "@langchain/langgraph-sdk",
        "npm",
        npm("langgraph-typescript", true),
        "LangGraph SDK contributes to the framework surface",
      ),
    ],
    excludedLibraries: [adapter("@ag-ui/langgraph")],
  },
  {
    slug: "langroid",
    language: "python",
    libraries: [
      framework(
        "langroid",
        "pypi",
        requirements("langroid"),
        "Langroid agent framework",
      ),
    ],
    excludedLibraries: [],
  },
  {
    slug: "llamaindex",
    language: "python",
    libraries: [
      framework(
        "llama-index-core",
        "pypi",
        requirements("llamaindex"),
        "LlamaIndex core agent framework",
      ),
    ],
    excludedLibraries: [adapter("llama-index-protocols-ag-ui")],
  },
  {
    slug: "mastra",
    language: "typescript",
    libraries: [
      framework(
        "@mastra/core",
        "npm",
        npm("mastra"),
        "Mastra core agent framework",
      ),
      framework(
        "@mastra/memory",
        "npm",
        npm("mastra"),
        "Mastra memory package contributes to the framework surface",
      ),
    ],
    excludedLibraries: [
      adapter("@ag-ui/mastra"),
      candidate("@mastra/client-js"),
      candidate("mastra"),
    ],
  },
  {
    slug: "ms-agent-dotnet",
    language: "dotnet",
    libraries: [
      framework(
        "Microsoft.Agents.AI",
        "nuget",
        csproj("ms-agent-dotnet", "ProverbsAgent.csproj", true),
        "Required Agent Framework core package; its transitive version needs resolved evidence",
        "stable-or-ms-preview",
      ),
    ],
    excludedLibraries: [
      {
        name: "Microsoft.Agents.AI.Hosting",
        reason:
          "Hosting support beneath the AG-UI adapter; the core package defines framework compatibility",
      },
      adapter("Microsoft.Agents.AI.Hosting.AGUI.AspNetCore"),
      candidate("Microsoft.Agents.AI.OpenAI"),
      provider("Microsoft.Extensions.AI.OpenAI"),
      provider("OpenAI"),
    ],
  },
  {
    slug: "ms-agent-harness-dotnet",
    language: "dotnet",
    libraries: [
      framework(
        "Microsoft.Agents.AI",
        "nuget",
        csproj("ms-agent-harness-dotnet", "BeautifulChatAgent.csproj", true),
        "Required Agent Framework core package; its transitive version needs resolved evidence",
      ),
      framework(
        "Microsoft.Agents.AI.Harness",
        "nuget",
        csproj("ms-agent-harness-dotnet", "BeautifulChatAgent.csproj"),
        "Agent Framework harness",
      ),
    ],
    excludedLibraries: [
      {
        name: "Microsoft.Agents.AI.Hosting",
        reason:
          "Hosting support beneath the AG-UI adapter; core and Harness define framework compatibility",
      },
      adapter("Microsoft.Agents.AI.Hosting.AGUI.AspNetCore"),
      provider("Microsoft.Extensions.AI.OpenAI"),
      provider("OpenAI"),
    ],
  },
  {
    slug: "ms-agent-python",
    language: "python",
    libraries: [
      framework(
        "agent-framework-ag-ui",
        "pypi",
        requirements("ms-agent-python"),
        "Agent Framework AG-UI package",
      ),
      framework(
        "agent-framework-core",
        "pypi",
        requirements("ms-agent-python"),
        "Agent Framework core package",
      ),
      framework(
        "agent-framework-openai",
        "pypi",
        requirements("ms-agent-python"),
        "Agent Framework OpenAI package contributes to the selected framework surface",
      ),
    ],
    excludedLibraries: [],
  },
  {
    slug: "pydantic-ai",
    language: "python",
    libraries: [
      framework(
        "pydantic-ai-slim",
        "pypi",
        requirements("pydantic-ai"),
        "Pydantic AI agent framework",
      ),
    ],
    excludedLibraries: [],
  },
  {
    slug: "spring-ai",
    language: "java",
    libraries: [
      framework(
        "org.springframework.ai:spring-ai-bom",
        "maven",
        pom("spring-ai.version"),
        "Spring AI BOM selects the framework dependency family; build metadata supplies a source fact",
      ),
      framework(
        "org.springframework.ai:spring-ai-starter-model-openai",
        "maven",
        pom("spring-ai.version", "org.springframework.ai:spring-ai-bom"),
        "Spring AI starter is managed by the selected BOM",
      ),
    ],
    excludedLibraries: [
      adapter("com.ag-ui.community:java-server / com.ag-ui.community:spring"),
      adapter("com.ag-ui.community:spring-ai"),
    ],
  },
  {
    slug: "strands",
    language: "python",
    libraries: [
      framework(
        "strands-agents",
        "pypi",
        requirements("strands"),
        "Strands agent framework",
      ),
    ],
    excludedLibraries: [
      adapter("ag_ui_strands"),
      {
        name: "strands-agents-tools",
        reason:
          "Helper-only tools package; it does not define the agent framework version",
      },
    ],
  },
  {
    slug: "strands-typescript",
    language: "typescript",
    libraries: [
      framework(
        "@strands-agents/sdk",
        "npm",
        npm("strands-typescript", true),
        "Strands agent framework SDK",
      ),
    ],
    excludedLibraries: [adapter("@ag-ui/aws-strands")],
  },
];

/** Reject stale, incomplete, or internally contradictory policy before collecting evidence. */
export function assertMappingCoverage(
  mapping: VariantMapping[],
  manifestSlugs: readonly string[],
): void {
  const seenSlugs = new Set<string>();
  for (const variant of mapping) {
    if (!variant.slug.trim() || seenSlugs.has(variant.slug)) {
      throw new Error(`Duplicate or empty mapping slug: ${variant.slug}`);
    }
    seenSlugs.add(variant.slug);
    if (!variant.language.trim())
      throw new Error(`Missing language for ${variant.slug}`);
    if (!variant.libraries.length && !variant.excludedReason?.trim()) {
      throw new Error(
        `Variant ${variant.slug} needs libraries or an exclusion reason`,
      );
    }
    if (variant.excludedReason && variant.libraries.length) {
      throw new Error(
        `Excluded variant ${variant.slug} cannot map framework libraries`,
      );
    }
    const names = new Set<string>();
    for (const library of variant.libraries) {
      if (!library.name.trim() || names.has(library.name)) {
        throw new Error(
          `Duplicate or empty package in ${variant.slug}: ${library.name}`,
        );
      }
      names.add(library.name);
      if (
        library.role !== "framework" ||
        !library.required ||
        !library.reason.trim()
      ) {
        throw new Error(
          `Mapped package ${variant.slug}/${library.name} needs a required framework role and reason`,
        );
      }
    }
    for (const excluded of variant.excludedLibraries) {
      if (
        !excluded.name.trim() ||
        names.has(excluded.name) ||
        !excluded.reason.trim()
      ) {
        throw new Error(
          `Duplicate or unexplained excluded package in ${variant.slug}: ${excluded.name}`,
        );
      }
      names.add(excluded.name);
    }
  }
  const manifests = new Set(manifestSlugs);
  if (
    manifests.size !== manifestSlugs.length ||
    manifestSlugs.some((slug) => !slug.trim())
  ) {
    throw new Error("Manifest roster has duplicate or empty slugs");
  }
  const missing = [...manifests].filter((slug) => !seenSlugs.has(slug));
  const stale = [...seenSlugs].filter((slug) => !manifests.has(slug));
  if (missing.length || stale.length) {
    throw new Error(
      `Mapping roster differs from manifests: missing=${missing.join(",") || "none"}; stale=${stale.join(",") || "none"}`,
    );
  }
}
