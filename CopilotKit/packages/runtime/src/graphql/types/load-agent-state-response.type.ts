import { Field, ObjectType } from "type-graphql";

@ObjectType()
export class LoadAgentStateResponse {
  @Field(() => String)
  threadId: string;

  @Field(() => Boolean)
  threadExists: boolean;

  @Field(() => String)
  state: string;

  @Field(() => String)
  messages: string;
}
