import { Field, InputType } from "type-graphql";

@InputType()
export class LoadAgentStateInput {
  @Field(() => String)
  threadId: string;

  @Field(() => String)
  agentName: string;
}
