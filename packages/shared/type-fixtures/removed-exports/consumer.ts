/** 1.x code that uses exports that CopilotKit 2.0 removed from @copilotkit/shared. */
import { dataToUUID } from "@copilotkit/shared";
import type { ImageData } from "@copilotkit/shared";

// @ts-expect-error Use v5 and validate from the uuid package
export const id = dataToUUID("order-42");

// @ts-expect-error Put an ImageInputPart from @copilotkit/shared in the content
export const image: ImageData = { format: "png", bytes: "aGVsbG8=" };
