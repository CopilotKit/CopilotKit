/** Client-side PDF → text extraction. Loaded lazily so the page bundle
 *  stays small.  Used inside CopilotChat's `attachments.onUpload`. */
export async function extractPdfText(file: File): Promise<{
  text: string;
  pages: number;
}> {
  const buf = await file.arrayBuffer();
  // @ts-expect-error pdfjs ships its own types via a custom export
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const chunks: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    chunks.push(
      content.items
        .map((it: { str?: string }) => it.str ?? "")
        .filter(Boolean)
        .join(" "),
    );
  }
  return { text: chunks.join("\n"), pages: doc.numPages };
}
