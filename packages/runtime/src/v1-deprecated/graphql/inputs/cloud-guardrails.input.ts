import { Field, InputType } from "type-graphql";

@InputType()
export class GuardrailsRuleInput {
  @Field(() => [String], { nullable: true })
  allowList?: string[] = [];

  @Field(() => [String], { nullable: true })
  denyList?: string[] = [];
}

@InputType()
export class GuardrailsInput {
  @Field(() => GuardrailsRuleInput, { nullable: false })
  inputValidationRules: GuardrailsRuleInput;
}
