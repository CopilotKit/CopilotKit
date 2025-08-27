import { GraphQLJSONObject } from "graphql-scalars";
import { Field, InputType } from "type-graphql";

@InputType()
export class CommitReinforcementLearningStateInput {
  @Field(() => String)
  threadId: string;

  @Field(() => String)
  agentName: string;

  @Field(() => String)
  humanEdit?: string;

  @Field(() => String)
  aiEdit?: string;

  @Field(() => GraphQLJSONObject)
  initialState: any;

  @Field(() => GraphQLJSONObject)
  state: any;
}
