import { graphql } from "./@generated/gql";

export const runCopilotChatMutation = graphql(/** GraphQL **/ `
  mutation runCopilotChat($data: RunCopilotChatInput!, $properties: JSONObject) {
    runCopilotChat(data: $data, properties: $properties) {
      threadId
      runId
      ... on CopilotChatResponse @defer {
        status {
          ... on BaseResponseStatus {
            code
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
      }
    }
  }
`);
