export function randomId() {
  return "ck-" + globalThis.crypto.randomUUID();
}
