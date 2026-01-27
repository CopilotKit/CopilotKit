export interface CopilotCloudConfig {
  guardrails: {
    input: {
      restrictToTopic: {
        enabled: boolean;
        validTopics: string[];
        invalidTopics: string[];
      };
    };
  };
}
