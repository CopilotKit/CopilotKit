import { defineRailway, github, project, service } from "railway/iac";

const repository = "CopilotKit/CopilotKit";
const demoRoot = "examples/showcases/generative-ui-playground";

export default defineRailway((ctx) => {
  const a2aAgent = service("a2a-agent", {
    source: github(repository, {
      branch: "main",
      rootDirectory: `${demoRoot}/a2a-agent`,
    }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    deploy: {
      healthcheckPath: "/.well-known/agent.json",
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
    env: {
      OPENAI_API_KEY: ctx.shared.OPENAI_API_KEY,
      A2A_BASE_URL: "http://${{RAILWAY_PRIVATE_DOMAIN}}:${{PORT}}",
    },
  });

  const mcpServer = service("mcp-server", {
    source: github(repository, {
      branch: "main",
      rootDirectory: `${demoRoot}/mcp-server`,
    }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    deploy: {
      healthcheckPath: "/health",
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
  });

  const frontend = service("frontend", {
    source: github(repository, { branch: "main" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: `${demoRoot}/Dockerfile`,
    },
    deploy: {
      healthcheckPath: "/",
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
    env: {
      OPENAI_API_KEY: ctx.shared.OPENAI_API_KEY,
      MCP_SERVER_URL:
        "http://${{mcp-server.RAILWAY_PRIVATE_DOMAIN}}:${{mcp-server.PORT}}/mcp",
      A2A_AGENT_URL:
        "http://${{a2a-agent.RAILWAY_PRIVATE_DOMAIN}}:${{a2a-agent.PORT}}",
    },
  });

  return project("ui-protocols-demo", {
    resources: [frontend, a2aAgent, mcpServer],
  });
});
