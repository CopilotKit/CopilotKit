import { Field, InputType } from "type-graphql";

@InputType()
export class AgentSessionInput {
  @Field(() => String)
  agentName: string;

  @Field(() => String, { nullable: true })
  threadId?: string;

  @Field(() => String, { nullable: true })
  nodeName?: string;
}
