import { v4 as uuidv4 } from "uuid";

export function randomId() {
  return "ck-" + uuidv4();
}
