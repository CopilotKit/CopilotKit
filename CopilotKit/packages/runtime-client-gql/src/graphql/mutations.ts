import { graphql } from "./@generated/gql";

export const createChatCompletionMutation = graphql(/** GraphQL **/ `
  mutation createChatCompletion($data: CreateChatCompletionInput!, $properties: [PropertyInput!]) {
    createChatCompletion(data: $data, properties: $properties) {
      threadId
      runId
      ... on ChatCompletion @defer {
        status {
          ... on BaseResponseStatus {
            code
          }
        }
      }
      messages @stream {
        __typename
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
