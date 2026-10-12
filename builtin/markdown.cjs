function parseMarkdown(text) {
  const lines = text.replaceAll('\r\n', '\n').split('\n'), blocks = []; let i = 0;
  const special = line => /^(#{1,6}\s|\s*```|\s*[-*+]\s|\s*\d+[.)]\s|>\s?|\s*---+\s*$)/.test(line);
  while (i < lines.length) {
    const line = lines[i]; if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) { const language = line.trim().slice(3).trim(), code = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]); if (i < lines.length) i++; blocks.push({ type: 'code', language, text: code.join('\n') }); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/); if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] }); i++; continue; }
    if (/^\s*---+\s*$/.test(line)) { blocks.push({ type: 'rule' }); i++; continue; }
    if (/^>/.test(line)) { const quoted = []; while (i < lines.length && /^>/.test(lines[i])) quoted.push(lines[i++].replace(/^>\s?/, '')); blocks.push({ type: 'quote', text: quoted.join('\n') }); continue; }
    if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) { const ordered = /^\s*\d/.test(line), items = []; while (i < lines.length && /^\s*(?:[-*+]|\d+[.)])\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')); blocks.push({ type: 'list', ordered, items }); continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) { const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()); const header = cells(line), rows = []; i += 2; while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++])); blocks.push({ type: 'table', header, rows }); continue; }
    const paragraph = [line]; i++; while (i < lines.length && lines[i].trim() && !special(lines[i])) { if (lines[i].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) break; paragraph.push(lines[i++]); } blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}
if (typeof module !== 'undefined') module.exports = { parseMarkdown };
