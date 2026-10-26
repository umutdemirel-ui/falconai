import type { ReactNode } from 'react';

/**
 * Küçük, bağımlılıksız Markdown oluşturucu.
 * Arayüzde yalnızca güvenli React düğümleri üretir (HTML enjeksiyonu yok).
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith('**')) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('*')) nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const m = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        nodes.push(
          <a key={key} href={m[2]} onClick={(e) => e.preventDefault()} title={m[2]}>
            {m[1]}
          </a>,
        );
      } else nodes.push(token);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function Markdown({ text }: { text: string }): ReactNode {
  if (!text) return null;
  const blocks = text.split(/```/);
  const out: ReactNode[] = [];

  blocks.forEach((block, blockIndex) => {
    if (blockIndex % 2 === 1) {
      const lines = block.replace(/^\n/, '').split('\n');
      const lang = lines[0]?.trim() ?? '';
      const code = lines.slice(lang && !/\s/.test(lang) ? 1 : 0).join('\n');
      out.push(
        <pre key={`code-${blockIndex}`}>
          {lang ? <div className="mb-1 text-[10px] uppercase tracking-widest text-white/30">{lang}</div> : null}
          <code>{code.trim()}</code>
        </pre>,
      );
      return;
    }

    const lines = block.split('\n');
    let listBuffer: { type: 'ul' | 'ol'; items: string[] } | null = null;
    let tableBuffer: string[] | null = null;

    const flushList = () => {
      if (!listBuffer) return;
      const Tag = listBuffer.type;
      out.push(
        <Tag key={`list-${out.length}`}>
          {listBuffer.items.map((item, i) => (
            <li key={i}>{renderInline(item, `li-${blockIndex}-${out.length}-${i}`)}</li>
          ))}
        </Tag>,
      );
      listBuffer = null;
    };

    const flushTable = () => {
      if (!tableBuffer) return;
      const rows = tableBuffer
        .filter((row) => !/^\|?[\s:-]+\|/.test(row))
        .map((row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      if (rows.length) {
        const [head, ...body] = rows;
        out.push(
          <table key={`table-${out.length}`}>
            <thead>
              <tr>{head.map((c, i) => <th key={i}>{renderInline(c, `th-${i}`)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>{row.map((c, ci) => <td key={ci}>{renderInline(c, `td-${ri}-${ci}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>,
        );
      }
      tableBuffer = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (/^\|.*\|$/.test(line.trim())) {
        flushList();
        tableBuffer = tableBuffer ?? [];
        tableBuffer.push(line.trim());
        continue;
      }
      flushTable();

      const ul = line.match(/^\s*[-*•]\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        const type: 'ul' | 'ol' = ul ? 'ul' : 'ol';
        if (!listBuffer || listBuffer.type !== type) {
          flushList();
          listBuffer = { type, items: [] };
        }
        listBuffer.items.push((ul?.[1] ?? ol?.[1]) as string);
        continue;
      }
      flushList();

      if (!line.trim()) {
        out.push(<div key={`sp-${out.length}`} className="h-1" />);
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const Tag = (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as 'h1' | 'h2' | 'h3';
        out.push(<Tag key={`h-${out.length}`}>{renderInline(heading[2], `h-${out.length}`)}</Tag>);
        continue;
      }
      if (/^>\s?/.test(line)) {
        out.push(<blockquote key={`q-${out.length}`}>{renderInline(line.replace(/^>\s?/, ''), `q-${out.length}`)}</blockquote>);
        continue;
      }
      if (/^---+$/.test(line.trim())) {
        out.push(<div key={`hr-${out.length}`} className="my-2 h-px bg-white/10" />);
        continue;
      }
      out.push(<p key={`p-${out.length}`}>{renderInline(line, `p-${out.length}`)}</p>);
    }
    flushList();
    flushTable();
  });

  return <div className="markdown-body">{out}</div>;
}
