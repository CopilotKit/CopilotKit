import { Field, InputType } from "type-graphql";

@InputType()
export class ActionInput {
  @Field(() => String)
  name: string;

  @Field(() => String)
  description: string;

  @Field(() => String)
  jsonSchema: string;
}
