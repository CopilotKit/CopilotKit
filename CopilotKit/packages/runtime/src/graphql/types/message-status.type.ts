import { Field, ObjectType, createUnionType, registerEnumType } from "type-graphql";

export enum MessageStatusCode {
  Pending = "pending",
  Success = "success",
  Failed = "failed",
}

registerEnumType(MessageStatusCode, {
  name: "MessageStatusCode",
});

@ObjectType()
class BaseMessageStatus {
  @Field(() => MessageStatusCode)
  code: MessageStatusCode;
}

@ObjectType()
export class PendingMessageStatus extends BaseMessageStatus {
  code: MessageStatusCode = MessageStatusCode.Pending;
}

@ObjectType()
export class SuccessMessageStatus extends BaseMessageStatus {
  code: MessageStatusCode = MessageStatusCode.Success;
}

@ObjectType()
export class FailedMessageStatus extends BaseMessageStatus {
  code: MessageStatusCode = MessageStatusCode.Failed;

  @Field(() => String)
  reason: string;
}

export const MessageStatusUnion = createUnionType({
  name: "MessageStatus",
  types: () => [PendingMessageStatus, SuccessMessageStatus, FailedMessageStatus] as const,
});
