import { Field, InputType } from "type-graphql";

@InputType()
export class ForwardedParametersInput {
  @Field(() => String, { nullable: true })
  model?: string;

  @Field(() => Number, { nullable: true })
  maxTokens?: number;

  @Field(() => [String], { nullable: true })
  stop?: string[];
}
