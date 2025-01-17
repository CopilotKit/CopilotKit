import { v4 as uuidv4, validate } from "uuid";

export function randomId() {
  return "ck-" + uuidv4();
}

export function randomUUID() {
  return uuidv4();
}

export function isValidUUID(uuid: string) {
  return validate(uuid);
}
