import { Field, InputType } from "type-graphql";

@InputType()
export class BaseMessage {
  @Field(() => String)
  id: string;

  @Field(() => Date)
  createdAt: Date;
}
