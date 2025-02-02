import { Field, ObjectType } from "type-graphql";
import { BaseMessageOutput } from "./copilot-response.type";

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
