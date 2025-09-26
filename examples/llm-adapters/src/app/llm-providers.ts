export const providers = [
  { id: "openai", value: "OpenAI", label: "OpenAI", enabled: true },
  { id: "anthropic", value: "Anthropic", label: "Anthropic", enabled: true },
  {
    id: "googlegenerativeai",
    value: "GoogleGenerativeAI",
    label: "Google Generative AI",
    enabled: true,
  },
  { id: "groq", value: "Groq", label: "Groq", enabled: true },
  { id: "azure", value: "Azure", label: "Azure OpenAI", enabled: true },
  { id: "bedrock", value: "Bedrock", label: "Amazon Bedrock", enabled: true },
];

export const providerKeys = [
  {
    id: "openai",
    label: "OpenAI",
    enabled: true,
    publicApiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    enabled: true,
    publicApiKey: process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY,
  },
  {
    id: "googlegenerativeai",
    label: "Google Generative AI",
    enabled: true,
    publicApiKey: process.env.NEXT_PUBLIC_GOOGLEGENERATIVEAI_API_KEY,
  },
  {
    id: "groq",
    label: "Groq",
    enabled: true,
    publicApiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    enabled: true,
    publicApiKey: process.env.NEXT_PUBLIC_AZURE_API_KEY,
  },
  {
    id: "bedrock",
    label: "Amazon Bedrock",
    enabled: true,
    publicApiKey: process.env.NEXT_PUBLIC_BEDROCK_API_KEY,
  },
];
  