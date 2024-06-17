import { graphql } from "./@generated/gql";

export const createChatCompletionMutation = graphql(/** GraphQL **/ `
  mutation createChatCompletion($data: CreateChatCompletionInput!) {
    createChatCompletion(data: $data) {
      threadId
      runId
      status {
        ... on PendingResponseStatus {
         	code 
        }
        ... on SuccessResponseStatus {
         	code 
        }
        ... on FailedResponseStatus {
         	code
          reason
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
