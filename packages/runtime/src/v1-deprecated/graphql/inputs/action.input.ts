import { Field, InputType } from "type-graphql";
import { ActionInputAvailability } from "../types/enums";
@InputType()
export class ActionInput {
  @Field(() => String)
  name: string;

  @Field(() => String)
  description: string;

  @Field(() => String)
  jsonSchema: string;

  @Field(() => ActionInputAvailability, { nullable: true })
  available?: ActionInputAvailability;
}
