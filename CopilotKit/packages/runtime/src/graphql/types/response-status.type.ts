import { Field, ObjectType, createUnionType, registerEnumType } from "type-graphql";

export enum ResponseStatusCode {
  Pending = "pending",
  Success = "success",
  Failed ="failed",
}

registerEnumType(ResponseStatusCode, {
  name: "ResponseStatusCode"
})

@ObjectType()
class BaseResponseStatus {
  @Field(() => ResponseStatusCode)
  code: ResponseStatusCode;
}

@ObjectType()
export class PendingResponseStatus extends BaseResponseStatus {
  code: ResponseStatusCode = ResponseStatusCode.Pending;
}

@ObjectType()
export class SuccessResponseStatus extends BaseResponseStatus {
  code: ResponseStatusCode = ResponseStatusCode.Success;
}

@ObjectType()
export class FailedResponseStatus extends BaseResponseStatus {
  code: ResponseStatusCode = ResponseStatusCode.Failed;

  @Field(() => String)
  reason: string;
}

export const ResponseStatusUnion = createUnionType({
  name: "ResponseStatus",
  types: () => [PendingResponseStatus, SuccessResponseStatus, FailedResponseStatus] as const,
});
