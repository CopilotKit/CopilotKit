import { GraphQLJSONObject } from "graphql-scalars";
import { Field, ObjectType } from "type-graphql";

@ObjectType()
export class ReinforcementLearningStateResponse {
  @Field(() => String)
  threadId: string;

  @Field(() => String)
  agentName: string;

  @Field(() => GraphQLJSONObject)
  state: string;
}
