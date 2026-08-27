type RealmElementConstructorName = "HTMLSelectElement" | "HTMLTextAreaElement";

function isOwnerRealmElement(
  target: EventTarget | null,
  constructorName: RealmElementConstructorName,
): boolean {
  if (target === null) return false;
  const ownerDocument = Reflect.get(target, "ownerDocument");
  if (typeof ownerDocument !== "object" || ownerDocument === null) return false;
  const ownerWindow = Reflect.get(ownerDocument, "defaultView");
  if (typeof ownerWindow !== "object" || ownerWindow === null) return false;
  const ElementConstructor = Reflect.get(ownerWindow, constructorName);
  return (
    typeof ElementConstructor === "function" &&
    target instanceof ElementConstructor
  );
}

export function isPlaygroundTextAreaElement(
  target: EventTarget | null,
): target is HTMLTextAreaElement {
  return isOwnerRealmElement(target, "HTMLTextAreaElement");
}

export function isPlaygroundSelectElement(
  target: EventTarget | null,
): target is HTMLSelectElement {
  return isOwnerRealmElement(target, "HTMLSelectElement");
}
