import { Field, ObjectType } from "type-graphql";

@ObjectType()
export class Agent {
  @Field(() => String)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  description?: string;

  @Field(() => Boolean)
  isAGUI?: boolean;
}

@ObjectType()
export class AgentsResponse {
  @Field(() => [Agent])
  agents: Agent[];
}
