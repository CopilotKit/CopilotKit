import { Field, InputType } from "type-graphql";

@InputType()
export class CopilotContextInput {
  @Field(() => String)
  description: string;

  @Field(() => String)
  value: string;
}
