import {
  OpenGenerativeUIMiddleware,
  transformRecordedEvents,
} from "@copilotkit/shared/event-transforms";

export const middleware = new OpenGenerativeUIMiddleware();
export { transformRecordedEvents };
