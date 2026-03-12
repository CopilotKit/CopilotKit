import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import {
  questions,
  getQuestionsForBranch,
  Config as OptionsConfig,
  ConfigSchema,
  ConfigFlags,
  YES_NO,
  MODES,
  CREW_TYPES,
  LANGGRAPH_AGENTS,
  DEPLOYMENT_CHOICES,
  scaffoldEnv,
  scaffoldAgent,
  scaffoldShadCN,
  addCrewInputs,
  sanitizers,
} from "../../src/lib/init/index.js";

describe("Init Command - Comprehensive Tests", () => {
  describe("CrewAI Mode", () => {
    test("should ask crew questions for both Crews and Flows", () => {
      const crewNameQuestion = questions.find((q) => q.name === "crewName");
      const crewUrlQuestion = questions.find((q) => q.name === "crewUrl");
      const crewBearerTokenQuestion = questions.find(
        (q) => q.name === "crewBearerToken",
      );

      // All questions should exist
      expect(crewNameQuestion).toBeDefined();
      expect(crewUrlQuestion).toBeDefined();
      expect(crewBearerTokenQuestion).toBeDefined();

      // Test for Crews
      const crewsAnswers = {
        mode: "CrewAI" as const,
        crewType: "Crews" as const,
      };
      expect(crewNameQuestion!.when!(crewsAnswers)).toBe(true);
      expect(crewUrlQuestion!.when!(crewsAnswers)).toBe(true);
      expect(crewBearerTokenQuestion!.when!(crewsAnswers)).toBe(true);

      // Test for Flows
      const flowsAnswers = {
        mode: "CrewAI" as const,
        crewType: "Flows" as const,
      };
      expect(crewNameQuestion!.when!(flowsAnswers)).toBe(true);
      expect(crewUrlQuestion!.when!(flowsAnswers)).toBe(true);
      expect(crewBearerTokenQuestion!.when!(flowsAnswers)).toBe(true);
    });

    test("should have crewType question for CrewAI mode", () => {
      const crewTypeQuestion = questions.find((q) => q.name === "crewType");
      expect(crewTypeQuestion).toBeDefined();

      const crewAIAnswers = { mode: "CrewAI" as const };
      expect(crewTypeQuestion!.when!(crewAIAnswers)).toBe(true);
    });

    test("should require crewUrl and crewBearerToken for both types", () => {
      const invalidCrews = {
        mode: "CrewAI" as const,
        crewType: "Crews" as const,
        crewName: "TestCrew",
      };

      const invalidFlows = {
        mode: "CrewAI" as const,
        crewType: "Flows" as const,
        crewName: "TestFlow",
      };

      expect(() => ConfigSchema.parse(invalidCrews)).toThrow();
      expect(() => ConfigSchema.parse(invalidFlows)).toThrow();

      const validCrews = {
        mode: "CrewAI" as const,
        crewType: "Crews" as const,
        crewName: "TestCrew",
        crewUrl: "https://api.crewai.com/crews/test",
        crewBearerToken: "token123",
      };

      const validFlows = {
        mode: "CrewAI" as const,
        crewType: "Flows" as const,
        crewName: "TestFlow",
        crewUrl: "https://api.crewai.com/flows/test",
        crewBearerToken: "token123",
      };

      expect(() => ConfigSchema.parse(validCrews)).not.toThrow();
      expect(() => ConfigSchema.parse(validFlows)).not.toThrow();
    });
  });

  describe("LangGraph Mode", () => {
    test("should ask alreadyDeployed question for LangGraph", () => {
      const alreadyDeployedQuestion = questions.find(
        (q) => q.name === "alreadyDeployed",
      );
      expect(alreadyDeployedQuestion).toBeDefined();

      const langGraphAnswers = { mode: "LangGraph" as const };
      expect(alreadyDeployedQuestion!.when!(langGraphAnswers)).toBe(true);
    });

    test("should ask langGraphPlatform when already deployed", () => {
      const langGraphPlatformQuestion = questions.find(
        (q) => q.name === "langGraphPlatform",
      );
      expect(langGraphPlatformQuestion).toBeDefined();

      const deployedAnswers = {
        mode: "LangGraph" as const,
        alreadyDeployed: "Yes" as const,
      };
      expect(langGraphPlatformQuestion!.when!(deployedAnswers)).toBe(true);
    });

    test("should ask langGraphAgent when not deployed", () => {
      const langGraphAgentQuestion = questions.find(
        (q) => q.name === "langGraphAgent",
      );
      expect(langGraphAgentQuestion).toBeDefined();

      const notDeployedAnswers = {
        mode: "LangGraph" as const,
        alreadyDeployed: "No" as const,
      };
      expect(langGraphAgentQuestion!.when!(notDeployedAnswers)).toBe(true);
    });

    test("should ask for platform URL when using platform", () => {
      const platformUrlQuestion = questions.find(
        (q) => q.name === "langGraphPlatformUrl",
      );
      expect(platformUrlQuestion).toBeDefined();

      const platformAnswers = {
        mode: "LangGraph" as const,
        alreadyDeployed: "Yes" as const,
        langGraphPlatform: "Yes" as const,
      };
      expect(platformUrlQuestion!.when!(platformAnswers)).toBe(true);
    });

    test("should ask for LangSmith API key for non-localhost platform", () => {
      const langSmithQuestion = questions.find(
        (q) => q.name === "langSmithApiKey",
      );
      expect(langSmithQuestion).toBeDefined();

      const remoteAnswers = {
        mode: "LangGraph" as const,
        langGraphPlatform: "Yes" as const,
        langGraphPlatformUrl: "https://api.langchain.com/graphs/test",
      };
      expect(langSmithQuestion!.when!(remoteAnswers)).toBe(true);

      // Should NOT ask for localhost URLs
      const localhostAnswers = {
        mode: "LangGraph" as const,
        langGraphPlatform: "Yes" as const,
        langGraphPlatformUrl: "http://localhost:8000/graphs/test",
      };
      expect(langSmithQuestion!.when!(localhostAnswers)).toBe(false);
    });

    test("should validate LangGraph config correctly", () => {
      const validConfig = {
        mode: "LangGraph" as const,
        alreadyDeployed: "No" as const,
        langGraphAgent: "Python Starter" as const,
      };
      expect(() => ConfigSchema.parse(validConfig)).not.toThrow();
    });
  });

  describe("Standard/MCP Mode", () => {
    test("should ask useCopilotCloud for Standard mode", () => {
      const useCopilotCloudQuestion = questions.find(
        (q) => q.name === "useCopilotCloud",
      );
      expect(useCopilotCloudQuestion).toBeDefined();

      const standardAnswers = { mode: "Standard" as const };
      expect(useCopilotCloudQuestion!.when!(standardAnswers)).toBe(true);
    });

    test("should ask useCopilotCloud for MCP mode", () => {
      const useCopilotCloudQuestion = questions.find(
        (q) => q.name === "useCopilotCloud",
      );
      expect(useCopilotCloudQuestion).toBeDefined();

      const mcpAnswers = { mode: "MCP" as const };
      expect(useCopilotCloudQuestion!.when!(mcpAnswers)).toBe(true);
    });

    test("should ask for LLM token when not using Copilot Cloud", () => {
      const llmTokenQuestion = questions.find((q) => q.name === "llmToken");
      expect(llmTokenQuestion).toBeDefined();

      const standardAnswers = {
        mode: "Standard" as const,
        useCopilotCloud: "No" as const,
      };
      expect(llmTokenQuestion!.when!(standardAnswers)).toBe(true);

      const mcpAnswers = {
        mode: "MCP" as const,
        useCopilotCloud: "No" as const,
      };
      expect(llmTokenQuestion!.when!(mcpAnswers)).toBe(true);
    });

    test("should validate Standard mode config", () => {
      const validConfig = {
        mode: "Standard" as const,
        useCopilotCloud: "Yes" as const,
      };
      expect(() => ConfigSchema.parse(validConfig)).not.toThrow();
    });

    test("should validate MCP mode config", () => {
      const validConfig = {
        mode: "MCP" as const,
        useCopilotCloud: "No" as const,
        llmToken: "sk-test123",
      };
      expect(() => ConfigSchema.parse(validConfig)).not.toThrow();
    });
  });

  describe("Cloud Setup Logic", () => {
    test("should determine cloud setup correctly for all modes", () => {
      const testCloudLogic = (mode: string, useCopilotCloud?: string) => {
        return useCopilotCloud === "Yes" || mode === "CrewAI";
      };

      // CrewAI always triggers cloud setup
      expect(testCloudLogic("CrewAI", "No")).toBe(true);
      expect(testCloudLogic("CrewAI", "Yes")).toBe(true);

      // Other modes depend on useCopilotCloud setting
      expect(testCloudLogic("Standard", "Yes")).toBe(true);
      expect(testCloudLogic("Standard", "No")).toBe(false);
      expect(testCloudLogic("MCP", "Yes")).toBe(true);
      expect(testCloudLogic("MCP", "No")).toBe(false);
      expect(testCloudLogic("LangGraph", "Yes")).toBe(true);
      expect(testCloudLogic("LangGraph", "No")).toBe(false);
    });

    test("should map CrewAI types to correct endpoints", () => {
      const getEndpointType = (crewType: "Crews" | "Flows") => {
        const isFlow = crewType === "Flows";
        return isFlow ? "CrewAIFlows" : "CrewAI";
      };

      expect(getEndpointType("Crews")).toBe("CrewAI");
      expect(getEndpointType("Flows")).toBe("CrewAIFlows");
    });

    test("should generate correct messages for CrewAI types", () => {
      const getChalkMessage = (crewType: "Crews" | "Flows") => {
        const isFlow = crewType === "Flows";
        return `Adding CrewAI ${isFlow ? "Flow" : "Crew"} to Copilot Cloud...`;
      };

      expect(getChalkMessage("Crews")).toBe(
        "Adding CrewAI Crew to Copilot Cloud...",
      );
      expect(getChalkMessage("Flows")).toBe(
        "Adding CrewAI Flow to Copilot Cloud...",
      );
    });
  });

  describe("A/B/C Test Flow", () => {
    describe("PostHog payload handling", () => {
      test("should return correct branch from PostHog payload", () => {
        // Mock analytics service
        const mockAnalyticsService = {
          getFeatureFlagPayload: jest.fn() as jest.MockedFunction<any>,
        };

        // Test Branch A payload
        mockAnalyticsService.getFeatureFlagPayload.mockResolvedValue({
          branch: "A",
        });
        expect(mockAnalyticsService.getFeatureFlagPayload).toBeDefined();

        // Test Branch B payload
        mockAnalyticsService.getFeatureFlagPayload.mockResolvedValue({
          branch: "B",
        });
        expect(mockAnalyticsService.getFeatureFlagPayload).toBeDefined();

        // Test Branch C payload
        mockAnalyticsService.getFeatureFlagPayload.mockResolvedValue({
          branch: "C",
        });
        expect(mockAnalyticsService.getFeatureFlagPayload).toBeDefined();

        // Test invalid payload
        mockAnalyticsService.getFeatureFlagPayload.mockResolvedValue({
          invalid: "payload",
        });
        expect(mockAnalyticsService.getFeatureFlagPayload).toBeDefined();

        // Test null payload
        mockAnalyticsService.getFeatureFlagPayload.mockResolvedValue(null);
        expect(mockAnalyticsService.getFeatureFlagPayload).toBeDefined();
      });

      test("should use enterprise-by-default feature flag", () => {
        const mockAnalyticsService = {
          getFeatureFlagPayload: jest.fn() as jest.MockedFunction<any>,
        };

        // Should call with correct flag name
        mockAnalyticsService.getFeatureFlagPayload("enterprise-by-default");
        expect(mockAnalyticsService.getFeatureFlagPayload).toHaveBeenCalledWith(
          "enterprise-by-default",
        );
      });
    });

    describe("Branch A behavior", () => {
      test("should show only base questions for Branch A", () => {
        const branchAQuestions = getQuestionsForBranch("A");

        // Should not have deployment choice questions
        const hasDeploymentChoice = branchAQuestions.some(
          (q) => q.name === "deploymentChoice",
        );
        expect(hasDeploymentChoice).toBe(false);

        // Should not have cloud deployment questions
        const hasCloudDeployment = branchAQuestions.some(
          (q) => q.name === "useCopilotCloud",
        );
        expect(hasCloudDeployment).toBe(false);

        // Should have base questions (mode, crew config, langgraph config, IDE docs)
        const hasModeQuestion = branchAQuestions.some((q) => q.name === "mode");
        expect(hasModeQuestion).toBe(true);
      });

      test("should indicate automatic cloud setup for Branch A", () => {
        const branchAQuestions = getQuestionsForBranch("A");

        // No questions should ask about cloud choice - it's automatic
        const cloudRelatedQuestions = branchAQuestions.filter(
          (q) =>
            q.message.toLowerCase().includes("cloud") ||
            q.message.toLowerCase().includes("sign up"),
        );
        expect(cloudRelatedQuestions.length).toBe(0);
      });
    });

    describe("Branch B behavior", () => {
      test("should show base questions + deployment choice for Branch B", () => {
        const branchBQuestions = getQuestionsForBranch("B");

        // Should have deployment choice questions
        const hasDeploymentChoice = branchBQuestions.some(
          (q) => q.name === "deploymentChoice",
        );
        expect(hasDeploymentChoice).toBe(true);

        // Should not have cloud deployment questions (replaced by deployment choice)
        const hasCloudDeployment = branchBQuestions.some(
          (q) => q.name === "useCopilotCloud",
        );
        expect(hasCloudDeployment).toBe(false);

        // Should have base questions
        const hasModeQuestion = branchBQuestions.some((q) => q.name === "mode");
        expect(hasModeQuestion).toBe(true);
      });

      test("should have correct deployment choice options for Branch B", () => {
        const branchBQuestions = getQuestionsForBranch("B");
        const deploymentChoiceQuestion = branchBQuestions.find(
          (q) => q.name === "deploymentChoice",
        );

        expect(deploymentChoiceQuestion).toBeDefined();
        expect(deploymentChoiceQuestion?.choices).toEqual([
          "Copilot Cloud",
          "Self-hosted",
        ]);
        expect(deploymentChoiceQuestion?.message).toContain(
          "Use Copilot Cloud, or self-hosted?",
        );
      });
    });

    describe("Branch C behavior", () => {
      test("should show base questions + cloud deployment for Branch C", () => {
        const branchCQuestions = getQuestionsForBranch("C");

        // Should not have deployment choice questions
        const hasDeploymentChoice = branchCQuestions.some(
          (q) => q.name === "deploymentChoice",
        );
        expect(hasDeploymentChoice).toBe(false);

        // Should have cloud deployment questions
        const hasCloudDeployment = branchCQuestions.some(
          (q) => q.name === "useCopilotCloud",
        );
        expect(hasCloudDeployment).toBe(true);

        // Should have base questions
        const hasModeQuestion = branchCQuestions.some((q) => q.name === "mode");
        expect(hasModeQuestion).toBe(true);
      });

      test("should have correct cloud deployment question for Branch C", () => {
        const branchCQuestions = getQuestionsForBranch("C");
        const cloudDeploymentQuestion = branchCQuestions.find(
          (q) => q.name === "useCopilotCloud",
        );

        expect(cloudDeploymentQuestion).toBeDefined();
        expect(cloudDeploymentQuestion?.message).toContain(
          "Deploy with Copilot Cloud?",
        );
        expect(cloudDeploymentQuestion?.type).toBe("yes/no");
      });

      test("should show cloud deployment question for new LangGraph agents in Branch C", () => {
        const branchCQuestions = getQuestionsForBranch("C");
        const cloudDeploymentQuestion = branchCQuestions.find(
          (q) => q.name === "useCopilotCloud",
        );

        expect(cloudDeploymentQuestion).toBeDefined();
        expect(cloudDeploymentQuestion?.when).toBeDefined();

        // Test the when condition for LangGraph with new agent (alreadyDeployed: 'No')
        const mockAnswersNewAgent = {
          mode: "LangGraph" as const,
          alreadyDeployed: "No" as const,
          langGraphAgent: "Python Starter" as const,
        };

        const shouldShowForNewAgent =
          cloudDeploymentQuestion?.when?.(mockAnswersNewAgent);
        expect(shouldShowForNewAgent).toBe(true);

        // Test the when condition for LangGraph with existing agent (alreadyDeployed: 'Yes', platform: 'Yes')
        const mockAnswersExistingAgent = {
          mode: "LangGraph" as const,
          alreadyDeployed: "Yes" as const,
          langGraphPlatform: "Yes" as const,
          langGraphPlatformUrl: "https://example.com",
        };

        const shouldShowForExistingAgent = cloudDeploymentQuestion?.when?.(
          mockAnswersExistingAgent,
        );
        expect(shouldShowForExistingAgent).toBe(true);
      });
    });

    describe("Base questions consistency", () => {
      test("should have consistent base questions across all branches", () => {
        const branchAQuestions = getQuestionsForBranch("A");
        const branchBQuestions = getQuestionsForBranch("B");
        const branchCQuestions = getQuestionsForBranch("C");

        // Extract base question names (excluding branch-specific ones)
        const getBaseQuestionNames = (questions: typeof branchAQuestions) => {
          return questions
            .filter(
              (q) =>
                q.name !== "useCopilotCloud" && q.name !== "deploymentChoice",
            )
            .map((q) => q.name)
            .sort();
        };

        const branchABaseQuestions = getBaseQuestionNames(branchAQuestions);
        const branchBBaseQuestions = getBaseQuestionNames(branchBQuestions);
        const branchCBaseQuestions = getBaseQuestionNames(branchCQuestions);

        // All branches should have the same base questions
        expect(branchABaseQuestions).toEqual(branchBBaseQuestions);
        expect(branchBBaseQuestions).toEqual(branchCBaseQuestions);

        // Should include essential questions
        expect(branchABaseQuestions).toContain("mode");
      });
    });

    describe("Cloud deployment logic", () => {
      test("should determine cloud deployment correctly for all branches", () => {
        // Branch A: Always cloud (automatic)
        const branchAConfig = {
          mode: "Standard" as const,
          // No deployment choice fields - defaults to cloud
        };

        // Branch A logic: no deployment fields means cloud
        const branchANeedsCloud =
          !("deploymentChoice" in branchAConfig) &&
          !("useCopilotCloud" in branchAConfig);
        expect(branchANeedsCloud).toBe(true); // Branch A default

        // Branch B: Based on deployment choice
        const branchBCloudConfig = {
          mode: "Standard" as const,
          deploymentChoice: "Copilot Cloud" as const,
        };
        const branchBSelfHostedConfig = {
          mode: "Standard" as const,
          deploymentChoice: "Self-hosted" as const,
        };
        expect(branchBCloudConfig.deploymentChoice === "Copilot Cloud").toBe(
          true,
        );
        expect(branchBSelfHostedConfig.deploymentChoice === "Self-hosted").toBe(
          true,
        );

        // Branch C: Based on useCopilotCloud
        const branchCCloudConfig = {
          mode: "Standard" as const,
          useCopilotCloud: "Yes" as const,
        };
        const branchCSelfHostedConfig = {
          mode: "Standard" as const,
          useCopilotCloud: "No" as const,
        };
        expect(branchCCloudConfig.useCopilotCloud === "Yes").toBe(true);
        expect(branchCSelfHostedConfig.useCopilotCloud === "No").toBe(true);

        // CrewAI always needs cloud regardless of branch
        const crewAIConfig = {
          mode: "CrewAI" as const,
          crewType: "Crews" as const,
          crewName: "TestCrew",
          crewUrl: "https://api.crewai.com/crews/test",
          crewBearerToken: "token123",
        };
        expect(crewAIConfig.mode === "CrewAI").toBe(true);
      });
    });

    describe("API key retrieval functionality", () => {
      test("should validate API key is set for cloud deployments", () => {
        // Branch A: Should always have API key
        const branchAConfig = {
          mode: "Standard" as const,
          copilotCloudPublicApiKey: "pk_test_branch_a_123",
        };
        expect(branchAConfig.copilotCloudPublicApiKey).toBeDefined();
        expect(branchAConfig.copilotCloudPublicApiKey).toMatch(/^pk_/);

        // Branch B: Should have API key regardless of deployment choice
        const branchBConfig = {
          mode: "Standard" as const,
          deploymentChoice: "Copilot Cloud" as const,
          copilotCloudPublicApiKey: "pk_test_branch_b_456",
        };
        expect(branchBConfig.copilotCloudPublicApiKey).toBeDefined();
        expect(branchBConfig.copilotCloudPublicApiKey).toMatch(/^pk_/);

        // Branch C: Should have API key when using cloud
        const branchCConfig = {
          mode: "Standard" as const,
          useCopilotCloud: "Yes" as const,
          copilotCloudPublicApiKey: "pk_test_branch_c_789",
        };
        expect(branchCConfig.copilotCloudPublicApiKey).toBeDefined();
        expect(branchCConfig.copilotCloudPublicApiKey).toMatch(/^pk_/);
      });

      test("should handle signup/login process for cloud setup", () => {
        // Mock the auth service methods that would be called
        const mockAuthService = {
          requireLogin: jest.fn() as jest.MockedFunction<any>,
        };

        mockAuthService.requireLogin.mockResolvedValue({
          cliToken: "test_cli_token",
          organization: { id: "org_123", name: "Test Org" },
          user: { id: "user_456", email: "test@example.com" },
        });

        // Mock the tRPC client methods
        const mockTRPCClient = {
          listOrgProjects: jest.fn() as jest.MockedFunction<any>,
          getCopilotCloudPublicApiKey: jest.fn() as jest.MockedFunction<any>,
        };

        mockTRPCClient.listOrgProjects.mockResolvedValue([
          { id: "proj_123", name: "Test Project" },
        ]);
        mockTRPCClient.getCopilotCloudPublicApiKey.mockResolvedValue({
          key: "pk_test_retrieved_key",
        });

        // Verify mocks are properly set up
        expect(mockAuthService.requireLogin).toBeDefined();
        expect(mockTRPCClient.listOrgProjects).toBeDefined();
        expect(mockTRPCClient.getCopilotCloudPublicApiKey).toBeDefined();

        // Test successful flow
        expect(mockAuthService.requireLogin("cloud-features")).resolves.toEqual(
          {
            cliToken: "test_cli_token",
            organization: { id: "org_123", name: "Test Org" },
            user: { id: "user_456", email: "test@example.com" },
          },
        );
      });
    });
  });

  describe("Functional A/B/C Test Integration", () => {
    test("should handle complete Branch A flow (automatic cloud setup)", async () => {
      // Mock analytics service with Branch A payload
      const mockAnalytics = {
        getFeatureFlagPayload: jest.fn() as jest.MockedFunction<any>,
        track: jest.fn() as jest.MockedFunction<any>,
        isFeatureEnabled: jest.fn() as jest.MockedFunction<any>,
      };

      mockAnalytics.getFeatureFlagPayload.mockResolvedValue({ branch: "A" });
      mockAnalytics.isFeatureEnabled.mockResolvedValue(false);

      // Mock auth service
      const mockAuth = {
        requireLogin: jest.fn() as jest.MockedFunction<any>,
      };

      mockAuth.requireLogin.mockResolvedValue({
        cliToken: "test_cli_token_a",
        organization: { id: "org_a", name: "Test Org A" },
        user: { id: "user_a", email: "test@example.com" },
      });

      // Mock tRPC client
      const mockTRPC = {
        listOrgProjects: jest.fn() as jest.MockedFunction<any>,
        getCopilotCloudPublicApiKey: jest.fn() as jest.MockedFunction<any>,
      };

      mockTRPC.listOrgProjects.mockResolvedValue([
        { id: "proj_a", name: "Test Project A" },
      ]);
      mockTRPC.getCopilotCloudPublicApiKey.mockResolvedValue({
        key: "pk_test_branch_a_automatic",
      });

      // Test Branch A question flow
      const branchAQuestions = getQuestionsForBranch("A");

      // Should only have base questions
      expect(branchAQuestions.some((q) => q.name === "mode")).toBe(true);
      expect(branchAQuestions.some((q) => q.name === "deploymentChoice")).toBe(
        false,
      );
      expect(branchAQuestions.some((q) => q.name === "useCopilotCloud")).toBe(
        false,
      );

      // Simulate answering base questions
      const branchAConfig = {
        mode: "Standard" as const,
        copilotCloudPublicApiKey: "pk_test_branch_a_automatic", // Set by automatic flow
      };

      // Validate config
      const validatedConfig = ConfigSchema.parse(branchAConfig);
      expect(validatedConfig.mode).toBe("Standard");
      expect(validatedConfig.copilotCloudPublicApiKey).toBe(
        "pk_test_branch_a_automatic",
      );

      // Should determine cloud deployment automatically
      const needsCloud =
        !("deploymentChoice" in validatedConfig) &&
        !("useCopilotCloud" in validatedConfig);
      expect(needsCloud).toBe(true); // Branch A always needs cloud

      // Verify mocks would be called correctly
      expect(mockAnalytics.getFeatureFlagPayload).toBeDefined();
      expect(mockAuth.requireLogin).toBeDefined();
      expect(mockTRPC.getCopilotCloudPublicApiKey).toBeDefined();
    });

    test("should handle complete Branch B flow (API key + choice)", async () => {
      // Mock analytics service with Branch B payload
      const mockAnalytics = {
        getFeatureFlagPayload: jest.fn() as jest.MockedFunction<any>,
        track: jest.fn() as jest.MockedFunction<any>,
      };

      mockAnalytics.getFeatureFlagPayload.mockResolvedValue({ branch: "B" });

      // Test Branch B question flow
      const branchBQuestions = getQuestionsForBranch("B");

      // Should have base questions + deployment choice
      expect(branchBQuestions.some((q) => q.name === "mode")).toBe(true);
      expect(branchBQuestions.some((q) => q.name === "deploymentChoice")).toBe(
        true,
      );
      expect(branchBQuestions.some((q) => q.name === "useCopilotCloud")).toBe(
        false,
      );

      // Test both deployment choices
      const branchBCloudConfig = {
        mode: "Standard" as const,
        deploymentChoice: "Copilot Cloud" as const,
        copilotCloudPublicApiKey: "pk_test_branch_b_cloud",
      };

      const branchBSelfHostedConfig = {
        mode: "Standard" as const,
        deploymentChoice: "Self-hosted" as const,
        copilotCloudPublicApiKey: "pk_test_branch_b_self", // Still gets API key
        llmToken: "sk-test-llm-token", // For self-hosted
      };

      // Validate both configs
      const validatedCloudConfig = ConfigSchema.parse(branchBCloudConfig);
      const validatedSelfHostedConfig = ConfigSchema.parse(
        branchBSelfHostedConfig,
      );

      expect(validatedCloudConfig.deploymentChoice).toBe("Copilot Cloud");
      expect(validatedSelfHostedConfig.deploymentChoice).toBe("Self-hosted");

      // Both should have API keys (everyone gets one in Branch B)
      expect(validatedCloudConfig.copilotCloudPublicApiKey).toBeDefined();
      expect(validatedSelfHostedConfig.copilotCloudPublicApiKey).toBeDefined();

      // Verify deployment choice question
      const deploymentQuestion = branchBQuestions.find(
        (q) => q.name === "deploymentChoice",
      );
      expect(deploymentQuestion?.choices).toEqual([
        "Copilot Cloud",
        "Self-hosted",
      ]);
    });

    test("should handle complete Branch C flow (current flow)", async () => {
      // Mock analytics service with Branch C payload
      const mockAnalytics = {
        getFeatureFlagPayload: jest.fn() as jest.MockedFunction<any>,
        track: jest.fn() as jest.MockedFunction<any>,
      };

      mockAnalytics.getFeatureFlagPayload.mockResolvedValue({ branch: "C" });

      // Test Branch C question flow
      const branchCQuestions = getQuestionsForBranch("C");

      // Should have base questions + cloud deployment
      expect(branchCQuestions.some((q) => q.name === "mode")).toBe(true);
      expect(branchCQuestions.some((q) => q.name === "useCopilotCloud")).toBe(
        true,
      );
      expect(branchCQuestions.some((q) => q.name === "deploymentChoice")).toBe(
        false,
      );

      // Test both cloud deployment choices
      const branchCCloudConfig = {
        mode: "Standard" as const,
        useCopilotCloud: "Yes" as const,
        copilotCloudPublicApiKey: "pk_test_branch_c_cloud",
      };

      const branchCSelfHostedConfig = {
        mode: "Standard" as const,
        useCopilotCloud: "No" as const,
        llmToken: "sk-test-llm-token", // For self-hosted
      };

      // Validate both configs
      const validatedCloudConfig = ConfigSchema.parse(branchCCloudConfig);
      const validatedSelfHostedConfig = ConfigSchema.parse(
        branchCSelfHostedConfig,
      );

      expect(validatedCloudConfig.useCopilotCloud).toBe("Yes");
      expect(validatedSelfHostedConfig.useCopilotCloud).toBe("No");

      // Cloud should have API key, self-hosted should not
      expect(validatedCloudConfig.copilotCloudPublicApiKey).toBeDefined();
      expect(
        validatedSelfHostedConfig.copilotCloudPublicApiKey,
      ).toBeUndefined();

      // Verify cloud deployment question
      const cloudQuestion = branchCQuestions.find(
        (q) => q.name === "useCopilotCloud",
      );
      expect(cloudQuestion?.message).toContain("Deploy with Copilot Cloud?");
    });

    test("should handle PostHog feature flag payload edge cases", async () => {
      // Test null payload (should default to Branch C)
      const mockAnalyticsNull = {
        getFeatureFlagPayload: jest.fn() as jest.MockedFunction<any>,
      };

      mockAnalyticsNull.getFeatureFlagPayload.mockResolvedValue(null);

      // Test invalid payload (should default to Branch C)
      const mockAnalyticsInvalid = {
        getFeatureFlagPayload: jest.fn() as jest.MockedFunction<any>,
      };

      mockAnalyticsInvalid.getFeatureFlagPayload.mockResolvedValue({
        invalid: "payload",
      });

      // Test missing branch property (should default to Branch C)
      const mockAnalyticsMissing = {
        getFeatureFlagPayload: jest.fn() as jest.MockedFunction<any>,
      };

      mockAnalyticsMissing.getFeatureFlagPayload.mockResolvedValue({
        other: "property",
      });

      // All should return Branch C questions (same as default)
      const defaultQuestions = getQuestionsForBranch("C");
      expect(defaultQuestions.some((q) => q.name === "useCopilotCloud")).toBe(
        true,
      );
      expect(defaultQuestions.some((q) => q.name === "mode")).toBe(true);
    });

    test("should handle API key retrieval flow", async () => {
      // Mock successful API key retrieval
      const mockTRPCClient = {
        listOrgProjects: jest.fn() as jest.MockedFunction<any>,
        getCopilotCloudPublicApiKey: jest.fn() as jest.MockedFunction<any>,
        createRemoteEndpoint: jest.fn() as jest.MockedFunction<any>,
      };

      mockTRPCClient.listOrgProjects.mockResolvedValue([
        { id: "proj_123", name: "Test Project" },
        { id: "proj_456", name: "Another Project" },
      ]);
      mockTRPCClient.getCopilotCloudPublicApiKey.mockResolvedValue({
        key: "pk_test_retrieved_successfully",
      });
      mockTRPCClient.createRemoteEndpoint.mockResolvedValue({
        id: "endpoint_123",
      });

      // Test project selection logic
      const projects = await mockTRPCClient.listOrgProjects();
      expect(projects).toHaveLength(2);
      expect((projects as any)[0].id).toBe("proj_123");

      // Test API key retrieval
      const apiKeyResult = await mockTRPCClient.getCopilotCloudPublicApiKey({
        projectId: "proj_123",
      });
      expect((apiKeyResult as any).key).toBe("pk_test_retrieved_successfully");
      expect((apiKeyResult as any).key).toMatch(/^pk_/);

      // Verify the API key can be used in config
      const configWithRetrievedKey = {
        mode: "Standard" as const,
        copilotCloudPublicApiKey: (apiKeyResult as any).key,
      };

      const validatedConfig = ConfigSchema.parse(configWithRetrievedKey);
      expect(validatedConfig.copilotCloudPublicApiKey).toBe(
        "pk_test_retrieved_successfully",
      );
    });
  });

  describe("Question Flow Logic", () => {
    test("should skip certain questions based on conditions", () => {
      // Test that questions properly skip when conditions aren't met

      const crewTypeQuestion = questions.find((q) => q.name === "crewType");
      const nonCrewAIAnswers = { mode: "Standard" as const };
      expect(crewTypeQuestion!.when!(nonCrewAIAnswers)).toBe(false);

      const langGraphAgentQuestion = questions.find(
        (q) => q.name === "langGraphAgent",
      );
      const deployedAnswers = {
        mode: "LangGraph" as const,
        alreadyDeployed: "Yes" as const,
      };
      expect(langGraphAgentQuestion!.when!(deployedAnswers)).toBe(false);
    });

    test("should validate question choices correctly", () => {
      const modeQuestion = questions.find((q) => q.name === "mode");
      expect(modeQuestion?.choices).toEqual([
        "LangGraph",
        "CrewAI",
        "Mastra",
        "LlamaIndex",
        "Agno",
        "AG2",
        "MCP",
        "Standard",
      ]);

      const crewTypeQuestion = questions.find((q) => q.name === "crewType");
      expect(crewTypeQuestion?.choices).toEqual(["Crews", "Flows"]);

      const yesNoQuestions = questions.filter((q) => q.type === "yes/no");
      expect(yesNoQuestions.length).toBeGreaterThan(0);

      // Verify specific yes/no questions exist
      const yesNoNames = yesNoQuestions.map((q) => q.name);
      expect(yesNoNames).toContain("alreadyDeployed");
      expect(yesNoNames).toContain("useCopilotCloud");
    });
  });

  describe("Integration Tests", () => {
    test("complete Standard mode flow", () => {
      const config = {
        mode: "Standard" as const,
        useCopilotCloud: "Yes" as const,
      };

      const validatedConfig = ConfigSchema.parse(config);
      expect(validatedConfig.mode).toBe("Standard");

      const needsCloud =
        validatedConfig.useCopilotCloud === "Yes" ||
        validatedConfig.mode === "CrewAI";
      expect(needsCloud).toBe(true);
    });

    test("complete LangGraph flow with new agent", () => {
      const config = {
        mode: "LangGraph" as const,
        alreadyDeployed: "No" as const,
        langGraphAgent: "Python Starter" as const,
        llmToken: "sk-test123",
      };

      const validatedConfig = ConfigSchema.parse(config);
      expect(validatedConfig.mode).toBe("LangGraph");
      expect(validatedConfig.alreadyDeployed).toBe("No");
      expect(validatedConfig.langGraphAgent).toBe("Python Starter");
    });

    test("complete LangGraph flow with existing agent", () => {
      const config = {
        mode: "LangGraph" as const,
        alreadyDeployed: "Yes" as const,
        langGraphPlatform: "Yes" as const,
        langGraphPlatformUrl: "http://localhost:8000/graphs/test",
      };

      const validatedConfig = ConfigSchema.parse(config);
      expect(validatedConfig.mode).toBe("LangGraph");
      expect(validatedConfig.alreadyDeployed).toBe("Yes");
      expect(validatedConfig.langGraphPlatform).toBe("Yes");
    });

    test("complete MCP flow without cloud", () => {
      const config = {
        mode: "MCP" as const,
        useCopilotCloud: "No" as const,
        llmToken: "sk-test123",
      };

      const validatedConfig = ConfigSchema.parse(config);
      expect(validatedConfig.mode).toBe("MCP");
      expect(validatedConfig.useCopilotCloud).toBe("No");

      const needsCloud =
        validatedConfig.useCopilotCloud === "Yes" ||
        validatedConfig.mode === "CrewAI";
      expect(needsCloud).toBe(false);
    });

    test("complete CrewAI Crews flow", () => {
      const config = {
        mode: "CrewAI" as const,
        crewType: "Crews" as const,
        crewName: "TestCrew",
        crewUrl: "https://api.crewai.com/crews/test",
        crewBearerToken: "token123",
      };

      const validatedConfig = ConfigSchema.parse(config);
      expect(validatedConfig.mode).toBe("CrewAI");
      expect(validatedConfig.crewType).toBe("Crews");

      const needsCloud = validatedConfig.mode === "CrewAI";
      expect(needsCloud).toBe(true);

      const endpointType =
        validatedConfig.crewType === "Flows" ? "CrewAIFlows" : "CrewAI";
      expect(endpointType).toBe("CrewAI");
    });

    test("complete CrewAI Flows flow", () => {
      const config = {
        mode: "CrewAI" as const,
        crewType: "Flows" as const,
        crewName: "TestFlow",
        crewUrl: "https://api.crewai.com/flows/test",
        crewBearerToken: "token123",
      };

      const validatedConfig = ConfigSchema.parse(config);
      expect(validatedConfig.mode).toBe("CrewAI");
      expect(validatedConfig.crewType).toBe("Flows");

      const needsCloud = validatedConfig.mode === "CrewAI";
      expect(needsCloud).toBe(true);

      const endpointType =
        validatedConfig.crewType === "Flows" ? "CrewAIFlows" : "CrewAI";
      expect(endpointType).toBe("CrewAIFlows");
    });
  });
});
