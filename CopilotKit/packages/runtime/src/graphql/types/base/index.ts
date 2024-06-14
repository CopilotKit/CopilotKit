import { Field } from "type-graphql";

export class BaseMessage {
  @Field(() => String)
  id: string;

  @Field(() => Date)
  createdAt: Date;
}