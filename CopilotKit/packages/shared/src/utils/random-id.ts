export function randomId(length = 16, alphabet = "abcdefghijklmnopqrstuvwxyz0123456789") {
  const alphabetLength = alphabet.length;
  const randomArray = new Uint8Array(length);
  globalThis.crypto.getRandomValues(randomArray);

  let id = "";
  for (let i = 0; i < length; i++) {
    id += alphabet[randomArray[i] % alphabetLength];
  }
  return id;
}

export default randomId;
