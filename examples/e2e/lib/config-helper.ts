import configs from "../app-configs.json";

// Project name constants with type safety
export const PROJECT_NAMES = {
  AI_RESEARCHER: "coagents-ai-researcher",
  QA_NATIVE: "coagents-qa-native",
  QA_TEXT: "coagents-qa-text",
  RESEARCH_CANVAS: "coagents-research-canvas",
} as const;

// Create type from project name constants
export type ProjectName = (typeof PROJECT_NAMES)[keyof typeof PROJECT_NAMES];

interface ConfigItem {
  url: string;
  description: string;
  projectName: ProjectName;
}

interface ConfigMap {
  [key: string]: ConfigItem;
}

interface GroupedConfigItem extends ConfigItem {
  key: string;
}

interface GroupedConfigs {
  [projectName: string]: {
    [description: string]: GroupedConfigItem[];
  };
}

/**
 * Groups configuration items by project name and description
 * @param targetProjectName - Optional project name to filter configurations
 * @returns Grouped configuration object for the specified project, or all projects if no project name provided
 */
export const getProjectConfigs = (
  targetProjectName?: ProjectName
): GroupedConfigs => {
  return Object.entries(configs as ConfigMap).reduce((acc, [key, value]) => {
    // Skip if targetProjectName is provided and doesn't match
    if (targetProjectName && value.projectName !== targetProjectName) {
      return acc;
    }

    // Create project group if it doesn't exist
    if (!acc[value.projectName]) {
      acc[value.projectName] = {};
    }

    // Group by description (removing the project name for cleaner grouping)
    const baseDescription = value.description.replace(
      `${value.projectName} - `,
      ""
    );
    if (!acc[value.projectName][baseDescription]) {
      acc[value.projectName][baseDescription] = [];
    }

    acc[value.projectName][baseDescription].push({
      key,
      ...value,
    });

    return acc;
  }, {} as GroupedConfigs);
};
