import { graphql } from "./@generated/gql";

export const generateResponseMutation = graphql(/** GraphQL **/`
  mutation generateResponse($data: GenerateResponseInput!) {
    generateResponse(data: $data) {
      ... on GeneratedResponse @defer {
        interruption {
          interrupted
          reason
        }
      }
      messages @stream {
        role
        content @stream
        isStream
      }
    }
  }
`);
