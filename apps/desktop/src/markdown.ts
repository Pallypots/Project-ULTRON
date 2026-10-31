/**
 * A deliberately small Markdown reader for ULTRON's replies: headings, bullet and numbered lists, bold, italics,
 * inline code, code blocks and links. It produces plain data that React renders as elements, so nothing a model (or a
 * web page it read) writes can ever become raw HTML. Only http(s) links become clickable.
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "a"; href: string; c: Inline[] };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "pre"; v: string }
  | { t: "hr" };

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^`([^`\n]+)`/.exec(rest))) {
      flush();
      out.push({ t: "code", v: m[1]! });
    } else if ((m = /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest)) || (m = /^__(?=\S)([\s\S]*?\S)__(?!\w)/.exec(rest))) {
      flush();
      out.push({ t: "b", c: parseInline(m[1]!) });
    } else if ((m = /^\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/.exec(rest)) || ((!i || /[\s(]/.test(src[i - 1]!)) && (m = /^_(?=\S)([^_\n]*?\S)_(?!\w)/.exec(rest)))) {
      flush();
      out.push({ t: "i", c: parseInline(m[1]!) });
    } else if ((m = /^\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/.exec(rest)) && SAFE_URL.test(m[2]!)) {
      flush();
      out.push({ t: "a", href: m[2]!, c: parseInline(m[1]!) });
    } else if ((!i || /[\s(]/.test(src[i - 1]!)) && (m = /^https?:\/\/[^\s<>"')\]]+/i.exec(rest))) {
      flush();
      const url = m[0].replace(/[.,;:!?]+$/, "");
      out.push({ t: "a", href: url, c: [{ t: "text", v: url }] });
      i += url.length;
      continue;
    } else {
      text += src[i];
      i++;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!;
    let m: RegExpExecArray | null;
    if (/^\s*```/.test(line)) {
      endPara();
      const body: string[] = [];
      while (++n < lines.length && !/^\s*```/.test(lines[n]!)) body.push(lines[n]!);
      blocks.push({ t: "pre", v: body.join("\n") });
    } else if ((m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line))) {
      endPara();
      blocks.push({ t: "h", level: Math.min(3, m[1]!.length) as 1 | 2 | 3, c: parseInline(m[2]!) });
    } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      endPara();
      blocks.push({ t: "hr" });
    } else if (/^\s*[-*•+]\s+\S/.test(line)) {
      endPara();
      const items: Inline[][] = [];
      for (; n < lines.length && (m = /^\s*[-*•+]\s+(.*)$/.exec(lines[n]!)); n++) items.push(parseInline(m[1]!));
      n--;
      blocks.push({ t: "ul", items });
    } else if ((m = /^\s*(\d{1,3})[.)]\s+\S/.exec(line))) {
      endPara();
      const start = Number(m[1]);
      const items: Inline[][] = [];
      for (; n < lines.length && (m = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(lines[n]!)); n++) items.push(parseInline(m[1]!));
      n--;
      blocks.push({ t: "ol", start, items });
    } else if (!line.trim()) {
      endPara();
    } else {
      para.push(line);
    }
  }
  endPara();
  return blocks;
}
