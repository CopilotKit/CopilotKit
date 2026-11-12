import {
  OpenGenerativeUIMiddleware,
  transformRecordedEvents,
} from "@copilotkit/runtime";

export const middleware = new OpenGenerativeUIMiddleware();
export { transformRecordedEvents };
