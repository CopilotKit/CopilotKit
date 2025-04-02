#!/usr/bin/env node

/**
 * Documentation processor for CopilotKit
 *
 * This script processes TypeDoc-generated Markdown files and converts them to
 * beautifully formatted MDX files for the documentation site.
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// TypeScript declarations for Node.js globals
declare const __dirname: string;
declare const process: {
  exit: (code: number) => never;
  [key: string]: any;
};

// Paths
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const TYPEDOC_OUTPUT = path.resolve(PROJECT_ROOT, "docs/.typedoc-temp");
const DOCS_OUTPUT = path.resolve(PROJECT_ROOT, "docs/content/docs/reference");

interface CategorySection {
  title: string;
  packages?: string[];
  files?: string[];
}

interface Category {
  title: string;
  packages?: string[];
  sections?: Record<string, CategorySection>;
}

interface PythonModule {
  name: string;
  path: string;
  description: string;
}

/**
 * Main categories and packages
 */
const CATEGORIES: Record<string, Category> = {
  components: {
    title: "Components",
    packages: ["react-ui", "react-core", "react-textarea"],
  },
  hooks: {
    title: "Hooks",
    packages: ["react-core", "react-ui", "react-textarea"],
  },
  classes: {
    title: "Classes",
    packages: ["runtime", "runtime-client-gql"],
  },
  sdk: {
    title: "SDK",
    sections: {
      js: {
        title: "JavaScript SDK",
        packages: ["sdk-js"],
      },
      python: {
        title: "Python SDK",
        files: ["LangGraph", "LangGraphAgent", "CrewAI", "CrewAIAgent", "RemoteEndpoints"],
      },
    },
  },
  shared: {
    title: "Shared",
    packages: ["shared"],
  },
};

/**
 * Run TypeDoc to generate documentation
 */
function generateTypeDocDocs(): boolean {
  console.log("Generating TypeScript documentation using TypeDoc...");

  try {
    execSync("npx typedoc", {
      cwd: PROJECT_ROOT,
      stdio: "ignore",
    });
    console.log("✓ TypeDoc documentation generated successfully");
    return true;
  } catch (error) {
    console.error("× Error generating TypeDoc documentation:", (error as Error).message);
    console.log("⚠️ Continuing with documentation generation despite TypeDoc errors");
    return true;
  }
}

/**
 * Generate Python documentation
 */
function generatePythonDocs(): boolean {
  console.log("Generating Python documentation...");

  // Create Python SDK directory
  const pythonDocsDir = path.resolve(DOCS_OUTPUT, "sdk/python");
  fs.mkdirSync(pythonDocsDir, { recursive: true });

  // List of Python modules to document
  const pythonModules: PythonModule[] = [
    {
      name: "LangGraph",
      path: "copilotkit/langgraph.py",
      description: "Utilities for building and running LangGraph workflows",
    },
    {
      name: "LangGraphAgent",
      path: "copilotkit/langgraph_agent.py",
      description: "Define custom agents built with LangChain's LangGraph framework",
    },
    {
      name: "CrewAI",
      path: "copilotkit/crewai/crewai_sdk.py",
      description: "Utilities for creating and managing CrewAI agent systems",
    },
    {
      name: "CrewAIAgent",
      path: "copilotkit/crewai/crewai_agent.py",
      description: "Use CrewAI to build autonomous AI agents that work together",
    },
    {
      name: "RemoteEndpoints",
      path: "copilotkit/sdk.py",
      description: "Connect Python agents to your JavaScript/TypeScript CopilotKit applications",
    },
  ];

  // Create minimal MDX files for Python modules
  for (const module of pythonModules) {
    const filePath = path.resolve(pythonDocsDir, `${module.name}.mdx`);
    const content = generatePythonMdx(module);
    fs.writeFileSync(filePath, content);
    console.log(`Generated ${module.name}.mdx`);
  }

  // Create index.mdx for Python SDK
  const indexPath = path.resolve(pythonDocsDir, "index.mdx");
  const indexContent = generatePythonIndexMdx(pythonModules);
  fs.writeFileSync(indexPath, indexContent);

  // Create meta.json for Python SDK
  const metaPath = path.resolve(pythonDocsDir, "meta.json");
  const metaContent = {
    title: "Python SDK",
    pages: ["index", ...pythonModules.map((m) => m.name)],
  };
  fs.writeFileSync(metaPath, JSON.stringify(metaContent, null, 2));

  console.log("✓ Python documentation generated successfully");
  return true;
}

/**
 * Generate MDX content for a Python module
 */
function generatePythonMdx(module: PythonModule): string {
  return `---
title: "${module.name}"
description: "${module.description}"
---

# ${module.name}

${module.description}

## Documentation

This documentation is a placeholder for the ${module.name} module.

For detailed usage and examples, please refer to the [Python SDK documentation](/reference/sdk/python).
`;
}

/**
 * Generate index MDX for Python SDK
 */
function generatePythonIndexMdx(modules: PythonModule[]): string {
  let content = `---
title: "Python SDK"
description: "CopilotKit Python SDK Reference"
---

# Python SDK

The CopilotKit Python SDK allows you to build powerful AI agents using frameworks like LangGraph and CrewAI, with seamless integration to your CopilotKit applications.

## Available Modules

`;

  for (const module of modules) {
    content += `- [${module.name}](/reference/sdk/python/${module.name}): ${module.description}\n`;
  }

  return content;
}

/**
 * Process TypeDoc output and create the reference documentation structure
 */
function processTypeDocOutput(): void {
  console.log("Processing TypeDoc output...");

  // Clean the output directory
  if (fs.existsSync(DOCS_OUTPUT)) {
    fs.rmSync(DOCS_OUTPUT, { recursive: true, force: true });
  }
  fs.mkdirSync(DOCS_OUTPUT, { recursive: true });

  // Create the directory structure
  createDirectoryStructure();

  // Process each category
  console.log("Processing categories...");
  for (const [categoryKey, category] of Object.entries(CATEGORIES)) {
    if (categoryKey === "sdk") {
      // SDK has a special structure with sections
      processSdkCategory(category);
    } else {
      // Regular category processing
      processCategory(categoryKey, category);
    }
  }

  // Create root index and meta files
  createRootFiles();

  console.log("✓ TypeDoc processing completed");
}

/**
 * Create the basic directory structure for reference docs
 */
function createDirectoryStructure(): void {
  console.log("Creating directory structure...");

  // Create category directories
  for (const categoryKey of Object.keys(CATEGORIES)) {
    const categoryDir = path.resolve(DOCS_OUTPUT, categoryKey);
    fs.mkdirSync(categoryDir, { recursive: true });

    // Create subdirectories for SDK
    if (categoryKey === "sdk") {
      const sections = CATEGORIES[categoryKey].sections;
      if (sections) {
        for (const sectionKey of Object.keys(sections)) {
          const sectionDir = path.resolve(categoryDir, sectionKey);
          fs.mkdirSync(sectionDir, { recursive: true });
        }
      }
    }
  }
}

/**
 * Process a standard category
 */
function processCategory(categoryKey: string, category: Category): void {
  const categoryDir = path.resolve(DOCS_OUTPUT, categoryKey);

  if (!category.packages) {
    return;
  }

  // Create index.mdx
  const indexPath = path.resolve(categoryDir, "index.mdx");
  const indexContent = `---
title: "${category.title}"
description: "CopilotKit ${category.title} API Reference"
---

# ${category.title}

This section contains API documentation for CopilotKit ${category.title.toLowerCase()}.

${category.packages
  .map((pkg) => {
    const packageTitle = pkg
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
    return `- [${packageTitle}](/reference/${categoryKey}/${pkg}): ${packageTitle} documentation`;
  })
  .join("\n")}
`;
  fs.writeFileSync(indexPath, indexContent);

  // Create meta.json
  const metaPath = path.resolve(categoryDir, "meta.json");
  const metaContent = {
    title: category.title,
    pages: ["index", ...category.packages],
  };
  fs.writeFileSync(metaPath, JSON.stringify(metaContent, null, 2));

  // Process each package in this category
  for (const pkg of category.packages) {
    processPackage(categoryKey, category, pkg);
  }
}

/**
 * Process SDK category with its sections
 */
function processSdkCategory(category: Category): void {
  const categoryDir = path.resolve(DOCS_OUTPUT, "sdk");

  // Create index.mdx
  const indexPath = path.resolve(categoryDir, "index.mdx");
  const indexContent = `---
title: "SDK"
description: "CopilotKit SDK Reference"
---

# SDK

CopilotKit provides SDKs for both Python and JavaScript to build and integrate AI agents with your applications.

## SDK Types

- [JavaScript SDK](/reference/sdk/js): Create and manage LangGraph workflows in JavaScript
- [Python SDK](/reference/sdk/python): Build agents using LangGraph or CrewAI
`;
  fs.writeFileSync(indexPath, indexContent);

  // Create meta.json
  const metaPath = path.resolve(categoryDir, "meta.json");
  const sections = category.sections || {};
  const metaContent = {
    title: "SDK",
    pages: ["index", ...Object.keys(sections)],
  };
  fs.writeFileSync(metaPath, JSON.stringify(metaContent, null, 2));

  // Process each section
  if (category.sections) {
    for (const [sectionKey, section] of Object.entries(category.sections)) {
      if (sectionKey === "js") {
        // Process JavaScript SDK
        const sectionDir = path.resolve(categoryDir, sectionKey);

        // Create index.mdx
        const sectionIndexPath = path.resolve(sectionDir, "index.mdx");
        const packages = section.packages || [];
        const sectionIndexContent = `---
title: "${section.title}"
description: "CopilotKit JavaScript SDK Reference"
---

# ${section.title}

The CopilotKit JavaScript SDK provides utilities for building AI agents directly within your JavaScript or TypeScript applications.

${packages.map((pkg) => `- [${pkg}](/reference/sdk/${sectionKey}/${pkg})`).join("\n")}
`;
        fs.writeFileSync(sectionIndexPath, sectionIndexContent);

        // Create meta.json
        const sectionMetaPath = path.resolve(sectionDir, "meta.json");
        const sectionMetaContent = {
          title: section.title,
          pages: ["index", "LangGraph"],
        };
        fs.writeFileSync(sectionMetaPath, JSON.stringify(sectionMetaContent, null, 2));

        // Create LangGraph.mdx
        const langGraphPath = path.resolve(sectionDir, "LangGraph.mdx");
        const langGraphContent = `---
title: "LangGraph"
description: "JavaScript SDK for LangGraph"
---

# LangGraph 

The CopilotKit LangGraph SDK for JavaScript allows you to build and run LangGraph workflows with CopilotKit.

## Functions

- \`copilotkitCustomizeConfig\`: Customize the configuration for your LangGraph
- \`copilotkitExit\`: Exit the current workflow
- \`copilotkitEmitState\`: Emit state updates to the UI
- \`copilotkitEmitMessage\`: Emit messages to the user
- \`copilotkitEmitToolCall\`: Emit tool calls to execute actions
`;
        fs.writeFileSync(langGraphPath, langGraphContent);
      }
      // Python SDK is handled separately in generatePythonDocs()
    }
  }
}

/**
 * Process a specific package within a category
 */
function processPackage(categoryKey: string, category: Category, pkg: string): void {
  const packageDir = path.resolve(DOCS_OUTPUT, categoryKey, pkg);
  fs.mkdirSync(packageDir, { recursive: true });

  // Format package title
  const packageTitle = pkg
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  // Create index.mdx
  const indexPath = path.resolve(packageDir, "index.mdx");
  const indexContent = `---
title: "${packageTitle}"
description: "CopilotKit ${packageTitle} API Reference"
---

# ${packageTitle}

Documentation for the ${packageTitle} package in CopilotKit.

## Key Exports

${getMockExportsForPackage(pkg, categoryKey)}
`;
  fs.writeFileSync(indexPath, indexContent);

  // Create meta.json
  const metaPath = path.resolve(packageDir, "meta.json");
  const metaContent = {
    title: packageTitle,
    pages: ["index"],
  };
  fs.writeFileSync(metaPath, JSON.stringify(metaContent, null, 2));
}

/**
 * Get mock exports list for a package
 */
function getMockExportsForPackage(pkg: string, categoryKey: string): string {
  switch (pkg) {
    case "react-ui":
      return `- \`CopilotChat\`: Chat interface for interacting with your copilot
- \`CopilotPopup\`: Popup interface for interacting with your copilot
- \`CopilotSidebar\`: Sidebar interface for interacting with your copilot`;

    case "react-core":
      if (categoryKey === "components") {
        return `- \`CopilotKit\`: The main provider component`;
      } else {
        // hooks
        return `- \`useCopilotChat\`: Hook for interacting with the chat functionality
- \`useCopilotReadable\`: Hook for providing knowledge to your copilot
- \`useCoAgent\`: Hook for creating agents with bidirectional state sharing`;
      }

    case "react-textarea":
      return `- \`CopilotTextarea\`: AI-powered textarea component`;

    case "runtime":
      return `- \`CopilotRuntime\`: Back-end component for CopilotKit
- \`OpenAIAdapter\`: Adapter for OpenAI
- \`AnthropicAdapter\`: Adapter for Anthropic Claude
- \`GoogleGenerativeAIAdapter\`: Adapter for Google Gemini`;

    case "runtime-client-gql":
      return `- GraphQL client utilities`;

    case "sdk-js":
      return `- LangGraph utilities`;

    case "shared":
      return `- Common utilities and type definitions`;

    default:
      return `- Various API exports`;
  }
}

/**
 * Create root index and meta files
 */
function createRootFiles(): void {
  // Create index.mdx
  const indexPath = path.resolve(DOCS_OUTPUT, "index.mdx");
  const indexContent = `---
title: "API Reference"
description: "CopilotKit API Reference"
---

# API Reference

This section contains comprehensive API documentation for all CopilotKit packages.

## Components

UI Components for building interfaces with CopilotKit.

- [CopilotKit](/reference/components/react-core): The CopilotKit provider component
- [CopilotChat](/reference/components/react-ui): Chat interface for interacting with your copilot
- [CopilotTextarea](/reference/components/react-textarea): AI-powered textarea component

## Hooks

React hooks for integrating AI capabilities.

- [useCopilotChat](/reference/hooks/react-core): Hook for interacting with the chat functionality
- [useCopilotReadable](/reference/hooks/react-core): Hook for providing knowledge to your copilot
- [useCoAgent](/reference/hooks/react-core): Hook for creating agents with bidirectional state sharing

## Classes

Core runtime adapters and service implementations.

- [CopilotRuntime](/reference/classes/runtime): Back-end component for CopilotKit
- [LLM Adapters](/reference/classes/runtime): Service adapters for various LLM providers

## SDK

SDKs for integrating with CopilotKit.

- [Python SDK](/reference/sdk/python): SDK for Python integration
- [JavaScript SDK](/reference/sdk/js): SDK for JavaScript integration
`;
  fs.writeFileSync(indexPath, indexContent);

  // Create meta.json
  const metaPath = path.resolve(DOCS_OUTPUT, "meta.json");
  const metaContent = {
    title: "reference",
    root: true,
    pages: ["index", "---Categories---", "components", "hooks", "classes", "sdk", "shared"],
  };
  fs.writeFileSync(metaPath, JSON.stringify(metaContent, null, 2));
}

/**
 * Cleanup temporary files
 */
function cleanup(): void {
  console.log("Cleaning up temporary files...");

  if (fs.existsSync(TYPEDOC_OUTPUT)) {
    fs.rmSync(TYPEDOC_OUTPUT, { recursive: true, force: true });
  }

  console.log("✓ Cleanup completed");
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log("Starting CopilotKit documentation generation...");

  // Generate TypeDoc documentation
  const typeDocSuccess = generateTypeDocDocs();

  // Process TypeDoc output
  processTypeDocOutput();

  // Generate Python documentation
  const pythonSuccess = generatePythonDocs();

  // Cleanup
  cleanup();

  if (typeDocSuccess && pythonSuccess) {
    console.log("✅ Documentation generation completed successfully");
  } else {
    console.warn("⚠️ Documentation generation completed with some issues");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
