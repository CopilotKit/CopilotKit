import { Field, InputType } from "type-graphql";

@InputType()
export class PropertyInput {
  @Field(() => String)
  key: string;

  @Field(() => String)
  value: string;
}