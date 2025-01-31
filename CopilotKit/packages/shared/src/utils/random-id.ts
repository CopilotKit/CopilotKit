import { v4 as uuidv4, validate, v5 as uuidv5 } from "uuid";

export function randomId() {
  return "ck-" + uuidv4();
}

export function randomUUID() {
  return uuidv4();
}

export function dataToUUID(input: string, namespace?: string): string {
  const BASE_NAMESPACE = "e4b01160-ff74-4c6e-9b27-d53cd930fe8e";
  // Since namespace needs to be a uuid, we are creating a uuid for it.
  const boundNamespace = namespace ? uuidv5(namespace, BASE_NAMESPACE) : BASE_NAMESPACE;
  return uuidv5(input, boundNamespace);
}

export function isValidUUID(uuid: string) {
  return validate(uuid);
}
