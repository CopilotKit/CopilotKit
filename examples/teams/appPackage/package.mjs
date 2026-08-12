#!/usr/bin/env node
/**
 * Build a sideload-ready Teams app package (`appPackage.zip`).
 *
 * Validates everything Teams needs, then zips `manifest.json` + icons:
 *   • Microsoft App (bot) id. Read from env (MICROSOFT_APP_ID / CLIENT_ID /
 *     clientId) or `.env`, and injected into the manifest's `bots[0].botId`, so
 *     the committed manifest stays a placeholder and nobody hardcodes their id.
 *   • Icons: `color.png` (192×192) and `outline.png` (32×32). Auto-generated as
 *     CopilotKit-purple placeholders if missing, so `pnpm package` always works.
 *   • Manifest: valid JSON with the required bot fields.
 *
 * Dependency-free (Node ≥ 18): pure-JS PNG writer + ZIP builder, no devDeps.
 *
 *   pnpm package          # -> examples/teams/appPackage/appPackage.zip
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const p = (name) => join(here, name);

const PURPLE = [91, 95, 199, 255]; // #5B5FC7

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (msg, hint) => {
  console.error(`\n❌ ${msg}`);
  if (hint) console.error(`   ${hint}`);
  process.exit(1);
};

// ---------------------------------------------------------------- CRC-32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------ PNG writer
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
/** Write an 8-bit RGBA PNG. `pixel(x,y) -> [r,g,b,a]`. */
function writePng(path, w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}
/** Read a PNG's pixel dimensions from its IHDR (no decode). */
function pngDimensions(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || !sig.every((b, i) => buf[i] === b)) return undefined;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// -------------------------------------------------------------- ZIP (stored)
function zip(entries) {
  // Fixed 1980-01-01 timestamp (deterministic output).
  const dosTime = 0;
  const dosDate = 0x21;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ----------------------------------------------------------- env resolution
function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trimStart().startsWith("#")) out[m[1]] = m[2].trim();
  }
  return out;
}

function main() {
  const env = { ...parseEnv(p("../.env")), ...process.env };
  const manifestPath = p("manifest.json");

  if (!existsSync(manifestPath))
    fail("manifest.json not found next to this script.");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return fail(`manifest.json is not valid JSON: ${e.message}`);
  }
  if (!manifest.bots?.[0]) {
    fail(
      "manifest.json has no bots[0] entry.",
      "A Teams bot manifest needs a `bots` array.",
    );
  }

  // Resolve the Microsoft App (bot) id: env wins; else a real id already in the
  // manifest; else fail with guidance.
  const placeholder = "REPLACE_WITH_MICROSOFT_APP_ID";
  const fromEnv = env.MICROSOFT_APP_ID || env.CLIENT_ID || env.clientId || "";
  const fromManifest =
    manifest.bots[0].botId !== placeholder ? manifest.bots[0].botId : "";
  const botId = (fromEnv || fromManifest).trim();

  if (!botId) {
    fail(
      "No Microsoft App id found.",
      "Set MICROSOFT_APP_ID (or clientId) in examples/teams/.env. It's the\n" +
        "   Application (client) ID of the Entra app bound to your Azure Bot.",
    );
  }
  if (!GUID_RE.test(botId)) {
    fail(
      `Microsoft App id "${botId}" is not a GUID.`,
      "Use the Application (client) ID (a GUID), not the secret or its id.",
    );
  }
  manifest.bots[0].botId = botId;
  // RSC: webApplicationInfo.id must be the same Entra app (client) id so Teams
  // can grant the resource-specific ChannelMessage.Read.Group permission to it.
  if (manifest.webApplicationInfo) manifest.webApplicationInfo.id = botId;

  // Icons: validate, auto-generating CopilotKit-purple placeholders if missing.
  const requireIcon = (name, size, make) => {
    const path = p(name);
    if (!existsSync(path)) {
      make(path);
      console.log(`• generated placeholder ${name} (${size}×${size})`);
      return;
    }
    const dims = pngDimensions(readFileSync(path));
    if (!dims) fail(`${name} is not a valid PNG.`);
    if (dims.w !== size || dims.h !== size) {
      fail(
        `${name} must be ${size}×${size}, found ${dims.w}×${dims.h}.`,
        "Replace it with a correctly-sized PNG, or delete it to auto-generate one.",
      );
    }
  };
  requireIcon("color.png", 192, (path) =>
    writePng(path, 192, 192, () => PURPLE),
  );
  requireIcon("outline.png", 32, (path) => {
    const cx = 15.5;
    const cy = 15.5;
    const r = 14;
    writePng(path, 32, 32, (x, y) =>
      (x - cx) ** 2 + (y - cy) ** 2 <= r * r
        ? [255, 255, 255, 255]
        : [0, 0, 0, 0],
    );
  });

  // Build the zip with the resolved manifest (manifest.json at the root).
  const entries = [
    {
      name: "manifest.json",
      data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"),
    },
    { name: "color.png", data: readFileSync(p("color.png")) },
    { name: "outline.png", data: readFileSync(p("outline.png")) },
  ];
  const outPath = p("appPackage.zip");
  writeFileSync(outPath, zip(entries));

  console.log(`\n✅ Built appPackage.zip  (botId ${botId})`);
  console.log(
    "   Upload in Teams → Apps → Manage your apps → Upload a custom app.",
  );
  console.log(`   ${outPath}\n`);
}

main();
