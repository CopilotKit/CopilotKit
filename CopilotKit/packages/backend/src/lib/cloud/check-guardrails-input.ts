import { COPILOT_CLOUD_PUBLIC_API_KEY_HEADER, Message } from "@copilotkit/shared";
import { COPILOT_CLOUD_API_URL } from "@copilotkit/shared";

export interface CloudCheckGuardrailsInputParams {
  messages: Message[];
  guardrails?: {
    restrictToTopic?: {
      enabled: boolean;
      validTopics: string[];
      invalidTopics: string[];
    };
  };
}

const COPILOT_CLOUD_GUARDRAILS_INPUT_URL = `${COPILOT_CLOUD_API_URL}/copilotkit/guardrails/input`;

function convertToInputParams(forwardedProps: any, cloud: any): CloudCheckGuardrailsInputParams {
  let guardrails = undefined;
  if (cloud.restrictToTopic) {
    const restrictToTopic = {
      enabled: cloud.restrictToTopic.enabled === undefined ? true : cloud.restrictToTopic.enabled,
      validTopics: cloud.restrictToTopic.validTopics || [],
      invalidTopics: cloud.restrictToTopic.invalidTopics || [],
    };
    guardrails = { restrictToTopic };
  }
  return {
    messages: forwardedProps.messages || [],
    ...(guardrails ? { guardrails } : {}),
  };
}

export async function cloudCheckGuardrailsInput(
  forwardedProps: any,
  cloud: any,
  publicApiKey: string,
): Promise<string> {
  // add guardrails to the cloud props
  const guardrailsProps = convertToInputParams(forwardedProps, cloud);
  if (!guardrailsProps.guardrails) {
    return "allowed";
  }

  const response = await fetch(COPILOT_CLOUD_GUARDRAILS_INPUT_URL, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: publicApiKey,
    },
    body: JSON.stringify({ ...guardrailsProps }),
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const json = await response.json();
      if (json.message) {
        message = json.message;
      }
    } catch (error) {}
    throw new Error("Failed to check input guardrails: " + message);
  }
  const json = await response.json();
  return json.status;
}
