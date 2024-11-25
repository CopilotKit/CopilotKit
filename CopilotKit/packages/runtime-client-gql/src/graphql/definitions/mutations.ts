import { graphql } from "../@generated/gql";

export const generateCopilotResponseMutation = graphql(/** GraphQL **/ `
  mutation generateCopilotResponse($data: GenerateCopilotResponseInput!, $properties: JSONObject) {
    generateCopilotResponse(data: $data, properties: $properties) {
      threadId
      runId
      ... on CopilotResponse @defer {
        status {
          ... on BaseResponseStatus {
            code
          }
          ... on FailedResponseStatus {
            reason
            details
          }
        }
      }
      messages @stream {
        __typename
        ... on BaseMessageOutput {
          id
          createdAt
        }
        ... on BaseMessageOutput @defer {
          status {
            ... on SuccessMessageStatus {
              code
            }
            ... on FailedMessageStatus {
              code
              reason
            }
            ... on PendingMessageStatus {
              code
            }
          }
        }
        ... on TextMessageOutput {
          content @stream
          role
        }
        ... on ContentMessageOutput {
          content @stream
          role
        }
        ... on ActionExecutionMessageOutput {
          name
          scope
          arguments @stream
        }
        ... on ResultMessageOutput {
          result
          actionExecutionId
          actionName
        }
        ... on AgentStateMessageOutput {
          threadId
          state
          running
          agentName
          nodeName
          runId
          active
          role
        }
      }
    }
  }
`);
