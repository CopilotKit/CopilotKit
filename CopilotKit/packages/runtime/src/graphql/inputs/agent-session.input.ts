import { Field, InputType } from "type-graphql";

@InputType()
export class AgentSessionInput {
  @Field(() => String)
  threadId: string;

  @Field(() => String)
  agentName: string;

  @Field(() => String)
  nodeName: string;
}
