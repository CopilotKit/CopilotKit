import { Field, InputType } from "type-graphql";
import { ActionInput } from "./action.input";

@InputType()
export class FrontendInput {
  @Field(() => String, { nullable: true })
  toDeprecate_fullContext?: string;

  @Field(() => [ActionInput])
  actions: ActionInput[];

  @Field(() => String, { nullable: true })
  url?: string;
}
