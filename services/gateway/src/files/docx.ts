import { inflateRawSync } from "node:zlib";

const MAX_XML_BYTES = 5_000_000;

/** Extracts plain text from a .docx (a zip containing word/document.xml) with no dependencies. Never inflates more than 5 MB (zip-bomb safe). */
export function docxText(buf: Buffer): string | null {
  // Find the end-of-central-directory record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === "word/document.xml") {
      if (rawSize > MAX_XML_BYTES || localOffset + 30 > buf.length) return null;
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      if (start + compSize > buf.length) return null;
      const data = buf.subarray(start, start + compSize);
      let xml: string;
      try {
        // maxOutputLength stops a lying size field from inflating gigabytes into memory.
        xml = (method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES }) : data.subarray(0, MAX_XML_BYTES)).toString("utf8");
      } catch {
        return null;
      }
      return xml
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}
