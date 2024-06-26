import { Field, InputType } from "type-graphql";

@InputType()
export class ContextPropertyInput {
  @Field(() => String)
  value: string;

  @Field(() => String)
  description: string;
}
