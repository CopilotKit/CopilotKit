import { Field, InputType } from "type-graphql";
import { GuardrailsInput } from "./cloud-guardrails.input";

@InputType()
export class CloudInput {
  @Field(() => GuardrailsInput, { nullable: true })
  guardrails?: GuardrailsInput;
}
