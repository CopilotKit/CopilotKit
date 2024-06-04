import { Field, InputType } from "type-graphql";
import { ActionInput } from "./action.input";

@InputType()
export class FrontendInput {
  @Field(() => String, { nullable: true })
  toDeprecate_fullContext?: string;

  @Field(() => [ActionInput], { nullable: true })
  actions?: ActionInput[];
}

