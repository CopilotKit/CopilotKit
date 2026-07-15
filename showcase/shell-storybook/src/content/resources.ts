export const curatedResources = {
  "showcase-home": {
    label: "Open Showcase",
    href: "https://showcase.copilotkit.ai",
  },
  "integration-directory": {
    label: "Browse integrations",
    href: "https://showcase.copilotkit.ai/integrations",
  },
  "coverage-matrix": {
    label: "Open the coverage matrix",
    href: "https://showcase.copilotkit.ai/matrix",
  },
  "showcase-docs": {
    label: "Read CopilotKit docs",
    href: "https://docs.copilotkit.ai",
  },
  "showcase-dashboard": {
    label: "Open the internal dashboard",
    href: "https://dashboard.showcase.copilotkit.ai",
  },
  "showcase-source": {
    label: "Open Showcase source",
    href: "https://github.com/CopilotKit/CopilotKit/tree/main/showcase",
  },
  "showcase-readme": {
    label: "Read the Showcase guide",
    href: "https://github.com/CopilotKit/CopilotKit/blob/main/showcase/README.md",
  },
  "showcase-rules": {
    label: "Read the four iron rules",
    href: "https://github.com/CopilotKit/CopilotKit/blob/main/showcase/AGENTS.md",
  },
  "frontend-strategy": {
    label: "Read the shell strategy",
    href: "https://github.com/CopilotKit/CopilotKit/blob/main/showcase/FRONTEND-STRATEGY.md",
  },
  "manifest-schema": {
    label: "Open the manifest schema",
    href: "https://github.com/CopilotKit/CopilotKit/blob/main/showcase/shared/manifest.schema.json",
  },
  "registry-generator": {
    label: "Open the registry generator",
    href: "https://github.com/CopilotKit/CopilotKit/blob/main/showcase/scripts/generate-registry.ts",
  },
  "harness-source": {
    label: "Open the test harness",
    href: "https://github.com/CopilotKit/CopilotKit/tree/main/showcase/harness",
  },
  "build-workflow": {
    label: "Open the build workflow",
    href: "https://github.com/CopilotKit/CopilotKit/blob/main/.github/workflows/showcase_build.yml",
  },
} as const;

export type CuratedResourceId = keyof typeof curatedResources;
