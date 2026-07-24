import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "@copilotkit/runtime/v2";
import { RECEIPT_MODEL } from "@/lib/models";

/**
 * POST /api/receipt
 *
 * Vision-powered receipt parser for the Personal Finance Copilot app. Accepts a
 * receipt image and returns structured fields the client can turn into a
 * proposed transaction:
 *
 *   { merchant, amount, currency, date, suggestedCategory }
 *
 * The image may be supplied two ways:
 *   1. JSON body:      { "image": "<base64 or data URL>", "mimeType"?: string }
 *   2. multipart/form: a file field named "image" (or "file" / "receipt")
 *
 * The handler is intentionally defensive: it validates input shape and size,
 * wraps the model call in try/catch, and returns 400 on bad input / 502 on a
 * model failure rather than throwing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap decoded image size to keep requests bounded (~10 MB of raw bytes).
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ReceiptSchema = z.object({
  merchant: z
    .string()
    .describe("The store / merchant / payee name printed on the receipt."),
  amount: z
    .number()
    .describe(
      "The grand total actually paid, as a number in the receipt's currency (e.g. 12.99). Use the final total including tax, not a subtotal.",
    ),
  currency: z
    .string()
    .describe(
      "ISO 4217 currency code inferred from the receipt (e.g. USD, EUR, GBP, JPY). Infer from the currency symbol/locale if no code is printed.",
    ),
  date: z
    .string()
    .describe(
      "The transaction date in ISO 8601 format (YYYY-MM-DD). If only a partial date is visible, return your best inference.",
    ),
  suggestedCategory: z
    .string()
    .describe(
      "A single concise spending category for this purchase, e.g. Groceries, Dining, Transport, Utilities, Shopping, Health, Entertainment.",
    ),
});

export type ReceiptResult = z.infer<typeof ReceiptSchema>;

type ParsedImage = { bytes: Uint8Array; mimeType: string };

/** Strip an optional `data:<mime>;base64,` prefix and decode to bytes. */
function decodeBase64Image(raw: string, fallbackMime: string): ParsedImage {
  let mimeType = fallbackMime;
  let b64 = raw.trim();

  const dataUrlMatch = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(b64);
  if (dataUrlMatch) {
    if (dataUrlMatch[1]) mimeType = dataUrlMatch[1];
    b64 = dataUrlMatch[3];
  }

  // Reject obviously non-base64 payloads early.
  if (b64.length === 0 || /[^A-Za-z0-9+/=\s]/.test(b64)) {
    throw new BadInputError("Image is not valid base64 data.");
  }

  const buffer = Buffer.from(b64, "base64");
  if (buffer.byteLength === 0) {
    throw new BadInputError("Decoded image is empty.");
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new BadInputError(
      `Image too large (${buffer.byteLength} bytes; max ${MAX_IMAGE_BYTES}).`,
    );
  }
  return { bytes: new Uint8Array(buffer), mimeType };
}

class BadInputError extends Error {}

/** Read the image out of either a JSON or multipart request. */
async function readImageFromRequest(req: Request): Promise<ParsedImage> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => {
      throw new BadInputError("Malformed multipart/form-data body.");
    });
    const file = form.get("image") ?? form.get("file") ?? form.get("receipt");
    if (!(file instanceof File)) {
      throw new BadInputError(
        'Expected a file field named "image" (or "file"/"receipt").',
      );
    }
    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      throw new BadInputError("Uploaded file is empty.");
    }
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      throw new BadInputError(
        `Image too large (${arrayBuffer.byteLength} bytes; max ${MAX_IMAGE_BYTES}).`,
      );
    }
    return {
      bytes: new Uint8Array(arrayBuffer),
      mimeType: file.type || "image/jpeg",
    };
  }

  // Default: JSON body with a base64 / data-URL string.
  const body = await req.json().catch(() => {
    throw new BadInputError(
      "Request body must be valid JSON or multipart form data.",
    );
  });
  if (!body || typeof body !== "object") {
    throw new BadInputError("Request body must be a JSON object.");
  }
  const image = (body as Record<string, unknown>).image;
  if (typeof image !== "string" || image.trim().length === 0) {
    throw new BadInputError(
      'Missing "image" field (base64 string or data URL).',
    );
  }
  const mimeType =
    typeof (body as Record<string, unknown>).mimeType === "string"
      ? ((body as Record<string, unknown>).mimeType as string)
      : "image/jpeg";
  return decodeBase64Image(image, mimeType);
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  // 1) Parse & validate the incoming image.
  let image: ParsedImage;
  try {
    image = await readImageFromRequest(req);
  } catch (err) {
    if (err instanceof BadInputError) {
      return json({ error: err.message }, 400);
    }
    return json({ error: "Could not read image from request." }, 400);
  }

  // 2) Call the vision model to extract structured receipt fields.
  try {
    const { object } = await generateObject({
      model: resolveModel(RECEIPT_MODEL),
      schema: ReceiptSchema,
      messages: [
        {
          role: "system",
          content:
            "You read photographed or scanned receipts and extract structured data. " +
            "Return the grand total actually paid (including tax). Infer the ISO 4217 " +
            "currency code from the symbol or locale if it is not printed. Normalize the " +
            "date to YYYY-MM-DD. If a field is genuinely illegible, return your best guess.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the receipt details as structured JSON.",
            },
            {
              type: "image",
              image: image.bytes,
              mediaType: image.mimeType,
            },
          ],
        },
      ],
    });

    return json(object satisfies ReceiptResult, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown model error.";
    // Surface a clean 502 for upstream/model failures (e.g. missing API key).
    return json({ error: "Failed to parse receipt.", detail: message }, 502);
  }
}
