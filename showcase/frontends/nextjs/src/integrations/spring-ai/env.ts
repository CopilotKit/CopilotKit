// The spring-ai agent server (Spring Boot). One process on port 8000 serves
// every demo's agent.
import type { IntegrationEnv } from "@/lib/agents";

export default {
  AGENT_URL_SPRING_AI: { port: 8000 },
} satisfies IntegrationEnv;
