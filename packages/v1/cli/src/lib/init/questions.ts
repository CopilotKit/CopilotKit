import {
  Question,
  MODES,
  CREW_TYPES,
  LANGGRAPH_AGENTS,
  DEPLOYMENT_CHOICES,
  ModeSchema,
  CrewTypeSchema,
  UrlSchema,
  YesNoSchema,
  DeploymentChoiceSchema,
  sanitizers,
} from "./types/index.js";
import { isLocalhost } from "./utils.js";
import { detectInstalledIDEs, IDE_DOCS_CONFIGS } from "./ide-docs.js";

const linkToDocs = ["Mastra", "AG2", "LlamaIndex", "Agno"];

// Validation helpers
const validateUrl = (input: string): true | string => {
  try {
    // First sanitize the URL by removing trailing slashes
    const sanitized = sanitizers.url(input);
    // Then validate
    const result = UrlSchema.safeParse(sanitized);
    if (result.success) return true;
    return result.error.errors[0]?.message || "Invalid URL format";
  } catch (error) {
    return "Invalid URL format";
  }
};

const validateRequired = (input: string): true | string => {
  return sanitizers.trim(input) ? true : "This field is required";
};

// A/B/C Test Feature Flags
type ABCTestBranch = "A" | "B" | "C";

// Helper function to determine which questions to show based on A/B/C test
export function getQuestionsForBranch(branch: ABCTestBranch): Question[] {
  const baseQuestions = getBaseQuestions();

  switch (branch) {
    case "A":
      // Branch A: Copilot Cloud by default, no signup questions
      // API key message and setup handled in init command
      return [...baseQuestions];

    case "B":
      // Branch B: API key setup (automatic) with choice between Cloud vs Self-hosted
      return [...baseQuestions, ...getDeploymentChoiceQuestions()];

    case "C":
    default:
      // Branch C: Current flow (no early signup, just cloud deployment question)
      return [...baseQuestions, ...getCloudDeploymentQuestions()];
  }
}

// Early signup questions - REMOVED (no longer used)

// Base questions for all branches (mode selection and configuration)
function getBaseQuestions(): Question[] {
  return [
    {
      type: "select",
      name: "mode",
      message: "🤖 How will you be interacting with AI?",
      choices: Array.from(MODES),
      validate: (input) => {
        try {
          ModeSchema.parse(input);
          return true;
        } catch (error) {
          return "Please select a valid mode";
        }
      },
    },

    // CrewAI specific questions
    {
      type: "select",
      name: "crewType",
      message: "👥 What kind of CrewAI implementation would you like to use?",
      choices: Array.from(CREW_TYPES),
      when: (answers) => answers.mode === "CrewAI",
      validate: (input) => {
        try {
          CrewTypeSchema.parse(input);
          return true;
        } catch (error) {
          return "Please select a valid crew type";
        }
      },
    },
    {
      type: "input",
      name: "crewName",
      message: "👥 What would you like to name your crew? (can be anything)",
      when: (answers) => answers.mode === "CrewAI",
      default: "MyCopilotCrew",
      validate: validateRequired,
      sanitize: sanitizers.trim,
    },
    {
      type: "input",
      name: "crewUrl",
      message:
        "🔗 Enter your Crew's Enterprise URL (more info at https://app.crewai.com):",
      when: (answers) => answers.mode === "CrewAI",
      validate: validateUrl,
      sanitize: sanitizers.url,
    },
    {
      type: "input",
      name: "crewBearerToken",
      message: "🔑 Enter your Crew's bearer token:",
      when: (answers) => answers.mode === "CrewAI",
      sensitive: true,
      validate: validateRequired,
      sanitize: sanitizers.trim,
    },

    // LangGraph specific questions
    {
      type: "yes/no",
      name: "alreadyDeployed",
      message: "🦜🔗 Do you have an existing LangGraph agent?",
      when: (answers) => answers.mode === "LangGraph",
      validate: (input) => {
        try {
          YesNoSchema.parse(input);
          return true;
        } catch (error) {
          return "Please select Yes or No";
        }
      },
    },
    {
      type: "yes/no",
      name: "langGraphPlatform",
      message:
        "🦜🔗 Do you already have a LangGraph Agent URL? (remote or localhost)",
      when: (answers) =>
        answers.mode === "LangGraph" && answers.alreadyDeployed === "Yes",
      validate: (input) => {
        try {
          YesNoSchema.parse(input);
          return true;
        } catch (error) {
          return "Please select Yes or No";
        }
      },
    },
    {
      type: "input",
      name: "langGraphPlatformUrl",
      message: "🦜🔗 Enter your LangGraph Agent URL (remote or localhost)",
      when: (answers) =>
        answers.mode === "LangGraph" &&
        answers.alreadyDeployed === "Yes" &&
        answers.langGraphPlatform === "Yes",
      validate: validateUrl,
      sanitize: sanitizers.url,
    },
    {
      type: "select",
      name: "langGraphAgent",
      message: "📦 Choose a LangGraph starter template:",
      choices: Array.from(LANGGRAPH_AGENTS),
      when: (answers) =>
        answers.mode === "LangGraph" && answers.alreadyDeployed === "No",
    },
    {
      type: "input",
      name: "langSmithApiKey",
      message:
        "🦜🔗 Enter your LangSmith API key (required by LangGraph Platform) :",
      when: (answers) =>
        answers.mode === "LangGraph" &&
        answers.langGraphPlatform === "Yes" &&
        !(
          answers.langGraphPlatformUrl &&
          isLocalhost(answers.langGraphPlatformUrl)
        ),
      sensitive: true,
      validate: validateRequired,
      sanitize: sanitizers.apiKey,
    },

    // LLM Token for self-hosted setups
    {
      type: "input",
      name: "llmToken",
      message:
        "🔑 Enter your OpenAI API key (optional - leave empty to configure your LLM later):",
      when: (answers) =>
        (answers.mode === "LangGraph" && answers.alreadyDeployed === "No") ||
        (answers.mode === "Standard" &&
          answers.deploymentChoice === "Self-hosted") ||
        (answers.mode === "MCP" &&
          answers.deploymentChoice === "Self-hosted") ||
        (answers.mode === "Standard" && answers.useCopilotCloud !== "Yes") ||
        (answers.mode === "MCP" && answers.useCopilotCloud !== "Yes"),
      sensitive: true,
      sanitize: sanitizers.apiKey,
    },

    // IDE Documentation Setup Questions
    {
      type: "yes/no",
      name: "setupIDEDocs",
      message:
        "📚 Would you like to add CopilotKit documentation to your IDE? (Provides AI assistant with CopilotKit context)",
      when: async () => {
        const installedIDEs = await detectInstalledIDEs();
        return installedIDEs.length > 0;
      },
      validate: (input) => {
        try {
          YesNoSchema.parse(input);
          return true;
        } catch (error) {
          return "Please select Yes or No";
        }
      },
    },
    {
      type: "select",
      name: "selectedIDE",
      message:
        "💻 Which IDE would you like to configure with CopilotKit documentation?",
      choices: async () => {
        const installedIDEs = await detectInstalledIDEs();
        const choices: Array<{ name: string; value: string }> =
          installedIDEs.map((ide: any) => ({
            name: IDE_DOCS_CONFIGS[ide as keyof typeof IDE_DOCS_CONFIGS]
              .displayName,
            value: ide,
          }));
        choices.push({ name: "Skip", value: "skip" });
        return choices;
      },
      when: (answers) => answers.setupIDEDocs === "Yes",
    },
  ];
}

// Deployment choice questions for Branch B only
function getDeploymentChoiceQuestions(): Question[] {
  return [
    {
      type: "select",
      name: "deploymentChoice",
      message: "🚀 Use Copilot Cloud, or self-hosted?",
      choices: Array.from(DEPLOYMENT_CHOICES),
      validate: (input) => {
        try {
          DeploymentChoiceSchema.parse(input);
          return true;
        } catch (error) {
          return "Please select a valid deployment option";
        }
      },
    },
  ];
}

// Cloud deployment questions for Branch C (current flow)
function getCloudDeploymentQuestions(): Question[] {
  return [
    {
      type: "yes/no",
      name: "useCopilotCloud",
      message: "🪁 Deploy with Copilot Cloud? (recommended for production)",
      when: (answers) =>
        answers.mode === "Standard" ||
        answers.mode === "MCP" ||
        (answers.mode === "LangGraph" && answers.alreadyDeployed === "No") || // Include new LangGraph agents
        (answers.mode !== "CrewAI" && // Crews only cloud, flows are self-hosted
          answers.alreadyDeployed === "Yes" &&
          answers.langGraphPlatform !== "No" &&
          !linkToDocs.includes(answers.mode || "") &&
          !isLocalhost(answers.langGraphPlatformUrl || "")),
      validate: (input) => {
        try {
          YesNoSchema.parse(input);
          return true;
        } catch (error) {
          return "Please select Yes or No";
        }
      },
    },
  ];
}

// Maintain backward compatibility by providing the original questions for Branch C
export const questions: Question[] = getQuestionsForBranch("C");
