import { Fragment, type ReactNode } from 'react';

/**
 * Small, safe formatter for page text written by school staff. Never injects HTML.
 *   # Heading, ## Subheading, ### Small heading
 *   - item / * item / 1. item   (lists)
 *   **bold**, *italic*, [link text](https://... or /page)
 *   blank line = new paragraph
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(((?:https?:\/\/|\/(?![\/\\]))[^\s)]*)\)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${key}b${i}`}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={`${key}i${i}`}>{m[2]}</em>);
    else out.push(<a key={`${key}a${i}`} href={m[4]} {...(m[4].startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="font-semibold text-brand underline underline-offset-2">{m[3]}</a>);
    last = re.lastIndex; i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className = '' }: { text?: string | null; className?: string }) {
  if (!text) return null;
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [], list: { ordered: boolean; items: string[] } | null = null;
  const flush = (k: number) => {
    if (para.length) { blocks.push(<p key={`p${k}`}>{para.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, `p${k}-${j}`)}</Fragment>)}</p>); para = []; }
    if (list) { const L = list.ordered ? 'ol' : 'ul'; blocks.push(<L key={`l${k}`} className={list.ordered ? 'list-decimal pl-6' : 'list-disc pl-6'}>{list.items.map((it, j) => <li key={j}>{inline(it, `l${k}-${j}`)}</li>)}</L>); list = null; }
  };
  lines.forEach((raw, k) => {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) return flush(k);
    if (h) { flush(k); const level = h[1].length; const cls = level === 1 ? 'text-2xl font-bold' : level === 2 ? 'text-xl font-semibold' : 'text-lg font-semibold';
      const Tag = (`h${level + 1}`) as 'h2' | 'h3' | 'h4'; blocks.push(<Tag key={`h${k}`} className={`${cls} mt-2 text-ink`}>{inline(h[2], `h${k}`)}</Tag>); return; }
    if (ul || ol) { if (para.length) flush(k); const ordered = !!ol; if (list && list.ordered !== ordered) flush(k); list ??= { ordered, items: [] }; list.items.push((ul ?? ol)![1]); return; }
    if (list) flush(k);
    para.push(line);
  });
  flush(lines.length);
  return <div className={`space-y-4 text-[17px] leading-relaxed text-ink/90 ${className}`}>{blocks}</div>;
}
