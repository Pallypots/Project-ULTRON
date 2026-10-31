import { Fragment, memo } from "react";
import { type Block, type Inline, parseMarkdown } from "./markdown.ts";

function Inlines({ c }: { c: Inline[] }) {
  return (
    <>
      {c.map((x, k) =>
        x.t === "text" ? <Fragment key={k}>{x.v}</Fragment>
        : x.t === "b" ? <strong key={k}><Inlines c={x.c} /></strong>
        : x.t === "i" ? <em key={k}><Inlines c={x.c} /></em>
        : x.t === "code" ? <code key={k}>{x.v}</code>
        : <a key={k} href={x.href} target="_blank" rel="noopener noreferrer nofollow"><Inlines c={x.c} /></a>,
      )}
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "p": return <p><Inlines c={b.c} /></p>;
    case "h": { const H = (`h${b.level + 2}`) as "h3" | "h4" | "h5"; return <H><Inlines c={b.c} /></H>; }
    case "ul": return <ul>{b.items.map((it, k) => <li key={k}><Inlines c={it} /></li>)}</ul>;
    case "ol": return <ol start={b.start}>{b.items.map((it, k) => <li key={k}><Inlines c={it} /></li>)}</ol>;
    case "pre": return <pre><code>{b.v}</code></pre>;
    case "hr": return <hr />;
  }
}

/** Renders a reply's Markdown as React elements (never as HTML). */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <div className="md">{parseMarkdown(text).map((b, k) => <BlockView key={k} b={b} />)}</div>;
});
