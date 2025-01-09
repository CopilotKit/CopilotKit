import { Field, InterfaceType, ObjectType } from "type-graphql";
import { MessageRole } from "./enums";
import { MessageStatusUnion } from "./message-status.type";
import { ResponseStatusUnion } from "./response-status.type";

@ObjectType()
export class Agent {
  @Field(() => String)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  description?: string;
}

@ObjectType()
export class AgentsResponse {
  @Field(() => [Agent])
  agents: Agent[];
}
