import { Field, InputType } from "type-graphql";
import { ActionInput } from "./action.input";

@InputType()
export class FrontendInput {
  @Field(() => String)
  toDeprecate_fullContext: string;

  @Field(() => [ActionInput])
  actions: ActionInput[];
}

