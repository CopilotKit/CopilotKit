let IDX = 256;
const HEX: string[] = [];
let BUFFER: number[] | undefined;

while (IDX--) {
  HEX[IDX] = (IDX + 256).toString(16).substring(1);
}

export function randomUUID(): string {
  let i = 0;
  let num: number;
  let out = "";

  if (!BUFFER || IDX + 16 > 256) {
    BUFFER = new Array<number>(256);
    i = 256;
    while (i--) {
      BUFFER[i] = (256 * Math.random()) | 0;
    }
    i = 0;
    IDX = 0;
  }

  for (; i < 16; i++) {
    num = BUFFER[IDX + i] as number;
    if (i === 6) out += HEX[(num & 15) | 64];
    else if (i === 8) out += HEX[(num & 63) | 128];
    else out += HEX[num];

    if (i & 1 && i > 1 && i < 11) out += "-";
  }

  IDX++;
  return out;
}
