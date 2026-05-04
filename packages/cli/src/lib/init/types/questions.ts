import { z } from "zod";
import { Flags } from "@oclif/core";
import { isLocalhost } from "../utils.js";

// ===== Core Constants =====
export const MODES = [
  "LangGraph",
  "CrewAI",
  "Mastra",
  "LlamaIndex",
  "Agno",
  "AG2",
  "MCP",
  "Standard",
] as const;
export const CREW_TYPES = ["Crews", "Flows"] as const;
export const CHAT_COMPONENTS = [
  "CopilotChat",
  "CopilotSidebar",
  "Headless",
  "CopilotPopup",
] as const;
export const LANGGRAPH_AGENTS = [
  "Python Starter",
  "TypeScript Starter",
] as const;
export const CREW_FLOW_TEMPLATES = ["Starter"] as const;
export const YES_NO = ["Yes", "No"] as const;
// NEW: Deployment choice options for Branch B
export const DEPLOYMENT_CHOICES = ["Copilot Cloud", "Self-hosted"] as const;

// ===== Sanitizers =====
export const sanitizers = {
  // Remove trailing slash from URLs
  url: (value: string): string => {
    if (!value) return value;
    return value.trim().replace(/\/+$/, "");
  },

  // Trim whitespace from strings
  trim: (value: string): string => {
    if (!value) return value;
    return value.trim();
  },

  // Lowercase strings
  lowercase: (value: string): string => {
    if (!value) return value;
    return value.toLowerCase().trim();
  },

  // Clean API keys (remove whitespace)
  apiKey: (value: string): string => {
    if (!value) return value;
    return value.trim().replace(/\s/g, "");
  },
};

// ===== Zod Schemas =====

// Basic schemas
export const ModeSchema = z.enum(MODES);
export const CrewTypeSchema = z.enum(CREW_TYPES);
export const ChatComponentSchema = z.enum(CHAT_COMPONENTS);
export const LangGraphAgentSchema = z.enum(LANGGRAPH_AGENTS);
export const CrewFlowTemplateSchema = z.enum(CREW_FLOW_TEMPLATES);
export const YesNoSchema = z.enum(YES_NO);
// NEW: Deployment choice schema for Branch B
export const DeploymentChoiceSchema = z.enum(DEPLOYMENT_CHOICES);

// URL validation schema with preprocessing to remove trailing slash
export const UrlSchema = z.preprocess(
  (val) => sanitizers.url(String(val)),
  z.string().url("Please enter a valid URL").min(1, "URL is required"),
);

// Token validation schema with preprocessing to trim
export const TokenSchema = z.preprocess(
  (val) => sanitizers.trim(String(val)),
  z.string().min(1, "Token is required"),
);

// API key validation schema with preprocessing to remove whitespace
export const ApiKeySchema = z.preprocess(
  (val) => sanitizers.apiKey(String(val)),
  z.string().min(1, "API key is required"),
);

export const LLMApiKeySchema = z.preprocess(
  (val) => sanitizers.apiKey(String(val)),
  z.string().optional(),
);

// Name validation schema with preprocessing to trim
export const NameSchema = z.preprocess(
  (val) => sanitizers.trim(String(val)),
  z.string().min(1, "Name is required"),
);

// Config schema
export const ConfigSchema = z
  .object({
    // Core fields
    copilotKitVersion: z.string().optional(),
    mode: ModeSchema,
    chatUi: ChatComponentSchema.optional(),

    // Yes/No fields
    alreadyDeployed: YesNoSchema.optional(),
    fastApiEnabled: YesNoSchema.optional(),
    // DEPRECATED: useCopilotCloud - consolidated with signupForCopilotCloud
    useCopilotCloud: YesNoSchema.optional(),

    // LangGraph specific fields
    langGraphAgent: LangGraphAgentSchema.optional(),
    langGraphPlatform: YesNoSchema.optional(),
    langGraphPlatformUrl: UrlSchema.optional(),
    langGraphRemoteEndpointURL: UrlSchema.optional(),

    // CrewAI specific fields
    crewType: CrewTypeSchema.optional(),
    crewName: NameSchema.optional(),
    crewUrl: UrlSchema.optional(),
    crewBearerToken: TokenSchema.optional(),

    // API keys and tokens
    copilotCloudPublicApiKey: z.string().optional(),
    langSmithApiKey: ApiKeySchema.optional(),
    llmToken: LLMApiKeySchema.optional(),

    // IDE Documentation setup fields
    setupIDEDocs: YesNoSchema.optional(),
    selectedIDE: z
      .union([z.enum(["cursor", "windsurf"]), z.literal("skip")])
      .optional(),

    // NEW: A/B/C test fields
    deploymentChoice: DeploymentChoiceSchema.optional(), // For branch B only (Cloud vs Self-hosted)
  })
  .refine(
    (data) => {
      // If CrewAI is selected, require crew URL and bearer token
      if (data.mode === "CrewAI") {
        return !!data.crewUrl && !!data.crewBearerToken;
      }
      return true;
    },
    {
      message: "Crew URL and bearer token are required for CrewAI",
      path: ["crewUrl", "crewBearerToken"],
    },
  )
  .refine(
    (data) => {
      // If LangGraph is selected with LangGraph Platform, require platform URL and LangSmith API key
      if (
        data.mode === "LangGraph" &&
        data.alreadyDeployed === "Yes" &&
        data.langGraphPlatform === "Yes"
      ) {
        return (
          (!!data.langGraphPlatformUrl && !!data.langSmithApiKey) ||
          isLocalhost(data.langGraphPlatformUrl || "")
        );
      }
      return true;
    },
    {
      message: "LangGraph Platform URL and LangSmith API key are required",
      path: ["langGraphPlatformUrl", "langSmithApiKey"],
    },
  );

// Export the inferred type from the schema
export type Config = z.infer<typeof ConfigSchema>;

// Question type definition with improved validation and sanitization
export type Question = {
  type: "input" | "yes/no" | "select";
  name: keyof Config;
  message: string;
  choices?:
    | readonly string[]
    | (() => Promise<{ name: string; value: string }[]>);
  default?: string;
  when?: (answers: Partial<Config>) => boolean | Promise<boolean>;
  sensitive?: boolean;
  validate?: (input: string) => true | string; // Return true if valid, error message string if invalid
  sanitize?: (input: string) => string; // Function to sanitize input before validation
};

// CLI flags definition with descriptions
export const ConfigFlags = {
  booth: Flags.boolean({
    description: "Use CopilotKit in booth mode",
    default: false,
    char: "b",
  }),
  mode: Flags.string({
    description: "How you will be interacting with AI",
    options: MODES,
    char: "m",
  }),
  "copilotkit-version": Flags.string({
    description: "CopilotKit version to use (e.g. 1.7.0)",
  }),
  "use-copilot-cloud": Flags.string({
    description: "Use Copilot Cloud for production-ready hosting",
    options: YES_NO,
  }),
  "langgraph-agent": Flags.string({
    description: "LangGraph agent template to use",
    options: LANGGRAPH_AGENTS,
  }),
  "crew-type": Flags.string({
    description: "CrewAI implementation type",
    options: CREW_TYPES,
  }),
  "crew-name": Flags.string({ description: "Name for your CrewAI agent" }),
  "crew-url": Flags.string({
    description: "URL endpoint for your CrewAI agent",
  }),
  "crew-bearer-token": Flags.string({
    description: "Bearer token for CrewAI authentication",
  }),
  "langsmith-api-key": Flags.string({
    description: "LangSmith API key for LangGraph observability",
  }),
  "llm-token": Flags.string({
    description: "API key for your preferred LLM provider",
  }),
  "setup-ide-docs": Flags.string({
    description: "Setup IDE documentation rules for AI assistance",
    options: YES_NO,
  }),
  "selected-ide": Flags.string({
    description: "IDE to configure with documentation rules",
    options: ["cursor", "windsurf", "skip"],
  }),
  // NEW: A/B/C test flags
  "deployment-choice": Flags.string({
    description: "Choose between Copilot Cloud or Self-hosted deployment",
    options: DEPLOYMENT_CHOICES,
  }),
};
