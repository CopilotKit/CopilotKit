import { Field, InputType } from "type-graphql";

@InputType()
export class ForwardedParametersInput {
  @Field(() => String, { nullable: true })
  model?: string;

  @Field(() => Number, { nullable: true })
  maxTokens?: number;

  @Field(() => [String], { nullable: true })
  stop?: string[];

  @Field(() => String, { nullable: true })
  toolChoice?: String;

  @Field(() => String, { nullable: true })
  toolChoiceFunctionName?: string;

  @Field(() => Number, { nullable: true })
  temperature?: number;
}
