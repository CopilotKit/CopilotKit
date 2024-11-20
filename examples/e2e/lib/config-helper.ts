// lib/config-helper.ts
import configs from "../app-configs.json";

// Project name constants with type safety
export const PROJECT_NAMES = {
  AI_RESEARCHER: "coagents-ai-researcher",
  QA_NATIVE: "coagents-qa-native",
  QA_TEXT: "coagents-qa-text",
  RESEARCH_CANVAS: "coagents-research-canvas",
} as const;

export type ProjectName = (typeof PROJECT_NAMES)[keyof typeof PROJECT_NAMES];

export interface ConfigItem {
  url: string;
  description: string;
  projectName: ProjectName;
}

export interface ConfigMap {
  [key: string]: ConfigItem;
}

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
