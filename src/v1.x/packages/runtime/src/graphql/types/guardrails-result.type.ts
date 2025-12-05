import { Field, ObjectType, registerEnumType } from "type-graphql";

export enum GuardrailsResultStatus {
  ALLOWED = "allowed",
  DENIED = "denied",
}

registerEnumType(GuardrailsResultStatus, {
  name: "GuardrailsResultStatus",
  description: "The status of the guardrails check",
});

@ObjectType()
export class GuardrailsResult {
  @Field(() => GuardrailsResultStatus)
  status: GuardrailsResultStatus;

  @Field(() => String, { nullable: true })
  reason?: string;
}
