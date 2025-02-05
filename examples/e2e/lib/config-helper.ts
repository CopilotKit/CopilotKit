// lib/config-helper.ts
import configs from "../test-config.json";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Project name constants with type safety
export const PROJECT_NAMES = {
  COAGENTS_RESEARCH_CANVAS: "coagents-research-canvas",
  COAGENTS_QA_NATIVE: "coagents-qa-native",
  COAGENTS_QA_TEXT: "coagents-qa-text",
  COAGENTS_ROUTING: "coagents-routing",
  COPILOTKIT_NEXT_OPENAI: "next-openai",
} as const;

export type ProjectName = (typeof PROJECT_NAMES)[keyof typeof PROJECT_NAMES];

export interface ConfigItem {
  url: string;
  description: string;
  projectName: ProjectName;
  lgcPythonDeploymentUrl?: string;
  lgcJSDeploymentUrl?: string;
  key?: string;
}

export interface ConfigMap {
  [key: string]: ConfigItem;
}

export interface TestVariant {
  name: string;
  queryParams: string;
  isCloud?: boolean;
}

export type TestVariants = TestVariant[];

/**
 * Returns raw config map
 */
export const getConfigs = (): ConfigMap => {
  return configs as ConfigMap;
};

/**
 * Groups configuration items by project name and description
 */
export const groupConfigsByDescription = (
  configs: ConfigMap
): Record<ProjectName, Record<string, ConfigItem[]>> => {
  return Object.entries(configs).reduce((acc, [key, value]) => {
    const { projectName, description } = value;

    if (!acc[projectName]) {
      acc[projectName] = {};
    }

    if (!acc[projectName][description]) {
      acc[projectName][description] = [];
    }

    acc[projectName][description].push({ ...value, key });

    return acc;
  }, {} as Record<ProjectName, Record<string, ConfigItem[]>>);
};

/**
 * Filter configs by project name
 */
export const filterConfigsByProject = (
  configs: ConfigMap,
  projectName: ProjectName
): ConfigMap => {
  return Object.entries(configs).reduce((acc, [key, value]) => {
    if (value.projectName === projectName) {
      acc[key] = value;
    }
    return acc;
  }, {} as ConfigMap);
};

export const appendLGCVariants = (config: ConfigItem, variants: any[]) => {
  let appendedVariants = [...variants];

  if (config.lgcPythonDeploymentUrl) {
    const newVariants = variants.map((variant) => {
      return {
        ...variant,
        name: `${variant.name} (LGC Python in-memory)`,
        queryParams: `${variant.queryParams}&lgcDeploymentUrl=${config.lgcPythonDeploymentUrl}`,
      };
    });

    appendedVariants = [...appendedVariants, ...newVariants];
  }

  if (config.lgcJSDeploymentUrl) {
    const newVariants = variants.map((variant) => {
      return {
        ...variant,
        name: `${variant.name} (LGC JS in-memory)`,
        queryParams: `${variant.queryParams}&lgcDeploymentUrl=${config.lgcJSDeploymentUrl}`,
      };
    });

    appendedVariants = [...appendedVariants, ...newVariants];
  }

  return appendedVariants;
};

export function getCopilotCloudVariants() {
  const variants: TestVariants = [];

  if (
    process.env.COPILOT_CLOUD_PROD_RUNTIME_URL &&
    process.env.COPILOT_CLOUD_PROD_PUBLIC_API_KEY
  ) {
    variants.push({
      name: "Copilot Cloud (Production)",
      queryParams: `?runtimeUrl=${process.env.COPILOT_CLOUD_PROD_RUNTIME_URL}&publicApiKey=${process.env.COPILOT_CLOUD_PROD_PUBLIC_API_KEY}`,
      isCloud: true,
    });
  }

  if (
    process.env.COPILOT_CLOUD_STAGING_RUNTIME_URL &&
    process.env.COPILOT_CLOUD_STAGING_PUBLIC_API_KEY
  ) {
    variants.push({
      name: "Copilot Cloud (Staging)",
      queryParams: `?runtimeUrl=${process.env.COPILOT_CLOUD_STAGING_RUNTIME_URL}&publicApiKey=${process.env.COPILOT_CLOUD_STAGING_PUBLIC_API_KEY}`,
      isCloud: true,
    });
  }

  return variants;
}
