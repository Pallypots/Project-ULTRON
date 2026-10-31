import { extractText, getDocumentProxy } from "unpdf";

/** PDFs are bigger than text files, but a 25 MB cap keeps indexing quick and memory bounded. */
export const PDF_LIMITS = { maxBytes: 25_000_000, maxPages: 300, timeoutMs: 20_000 };

/**
 * Text of a PDF (no OCR: scanned pages without a text layer come back empty). Fonts aren't loaded (this pdf.js build has no eval),
 * and a slow or hostile file is abandoned after a time limit.
 */
export async function pdfText(bytes: Uint8Array, maxChars: number): Promise<string | null> {
  const work = (async () => {
    const pdf = await getDocumentProxy(bytes, { disableFontFace: true, useSystemFonts: false, verbosity: 0 });
    try {
      if (pdf.numPages > PDF_LIMITS.maxPages) return null;
      const { text } = await extractText(pdf, { mergePages: true });
      const clean = String(text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      return clean ? clean.slice(0, maxChars) : null;
    } finally {
      await (pdf as unknown as { cleanup?: () => Promise<void> }).cleanup?.().catch(() => {});
    }
  })();
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), PDF_LIMITS.timeoutMs).unref?.());
  return Promise.race([work.catch(() => null), timeout]);
}
