// Strings that name Object.prototype members are not import paths.
import { constructor as ctor, toString } from "@copilotkit/react-core";
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype", "toString"]);
vi.mock("constructor", () => ({}));
export const keys = [ctor, toString, FORBIDDEN, "hasOwnProperty", "valueOf"];
