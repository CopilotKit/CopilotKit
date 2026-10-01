import { z } from "zod";

export interface TrajectoryConnectionGrant {
  joinToken: string;
  realtime: { clientUrl: string; topic: string };
}

const trajectoryIdSchema = z.string().uuid();

export function isValidTrajectoryId(value: unknown): value is string {
  return trajectoryIdSchema.safeParse(value).success;
}

const joinResponseSchema = z.object({
  joinToken: z.string().refine((value) => value.trim().length > 0),
  trajectoryId: trajectoryIdSchema,
});

const grantSchema = z.object({
  joinToken: z.string().refine((value) => value.trim().length > 0),
  realtime: z.object({
    clientUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          (url.protocol === "wss:" || url.protocol === "ws:") &&
          !url.username &&
          !url.password
        );
      }),
    topic: z
      .string()
      .refine((value) => value.trim().length > 0 && !/\p{Cc}/u.test(value)),
  }),
});

const contractErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "AUTH_UNAUTHENTICATED",
      "VALIDATION_ERROR",
      "TRAJECTORY_APP_USER_CONFLICT",
      "LEARNING_CONTAINER_NOT_FOUND",
      "API_KEY_NOT_FOUND",
      "ORG_NOT_FOUND",
      "PROJECT_NOT_FOUND",
      "RATE_LIMIT_EXCEEDED",
      "INTERNAL_SERVER_ERROR",
      "MARKETPLACE_LICENSE_REQUIRED",
    ]),
    message: z.string().trim().min(1).max(512),
  }),
});

export class TrajectoryConnectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TrajectoryConnectionError";
  }
}

export function parseTrajectoryConnectionGrant(
  value: unknown,
  trajectoryId: string,
  clientUrl: string,
): TrajectoryConnectionGrant {
  const join = joinResponseSchema.safeParse(value);
  const result = grantSchema.safeParse(
    join.success && join.data.trajectoryId === trajectoryId
      ? {
          joinToken: join.data.joinToken,
          realtime: { clientUrl, topic: `trajectory:${trajectoryId}` },
        }
      : undefined,
  );
  if (!result.success) {
    throw new TrajectoryConnectionError(
      "CONNECTION_FAILED",
      "Intelligence returned an invalid trajectory connection grant",
      502,
    );
  }
  return {
    joinToken: result.data.joinToken,
    realtime: {
      clientUrl: result.data.realtime.clientUrl,
      topic: result.data.realtime.topic,
    },
  };
}

/** Forward only the public contract, never raw platform errors or credentials. */
export function trajectoryResponseError(
  value: unknown,
  status: number,
  apiKey: string,
): TrajectoryConnectionError {
  const result = contractErrorSchema.safeParse(value);
  if (result.success && !result.data.error.message.includes(apiKey)) {
    return new TrajectoryConnectionError(
      result.data.error.code,
      result.data.error.message,
      status,
    );
  }
  return new TrajectoryConnectionError(
    "CONNECTION_FAILED",
    "Intelligence rejected the trajectory connection request",
    status,
  );
}
