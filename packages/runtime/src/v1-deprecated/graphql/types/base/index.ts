import { Field, InputType } from "type-graphql";

@InputType()
export class BaseMessageInput {
  @Field(() => String)
  id: string;

  @Field(() => Date)
  createdAt: Date;
}
