import { IntelligenceClient } from "@copilotkit/intelligence";
import { createAgent } from "langchain";
import { createSkillRegistryMiddleware } from "../src/index.js";

const client = new IntelligenceClient({
  baseUrl: "https://api.example.com",
  accessToken: "example-token",
  projectNamespace: "example",
  cacheRoot: ".copilotkit/intelligence",
});

const skills = createSkillRegistryMiddleware({
  client,
  learningContainerId: "55555555-5555-4555-8555-555555555555",
});

const agent = createAgent({
  model: "openai:gpt-5.4-mini",
  tools: [],
  middleware: [skills],
});

void agent;
