const path = require('node:path'), crypto = require('node:crypto');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
const review = require('./review.cjs'), exec = promisify(execFile);
function diagnostics(project, entries) {
  const lines = [], severity = ['错误', '警告', '信息', '提示'];
  for (const [uri, list] of entries) {
    if (uri.scheme !== 'file' || !review.within(project, uri.fsPath)) continue;
    for (const item of list) {
      if (item.severity > 1) continue;
      const code = typeof item.code === 'object' ? item.code?.value : item.code;
      lines.push(`${path.relative(project, uri.fsPath)}:${item.range.start.line + 1}:${item.range.start.character + 1} [${severity[item.severity] || '诊断'}] ${String(item.message).slice(0, 1000)}${code === undefined ? '' : ` (${String(code).slice(0, 80)})`}`);
      if (lines.length >= 50) return lines.join('\n') + '\n[仅引用前 50 项]';
    }
  }
  return lines.join('\n');
}
async function gitDiff(project, staged = false) {
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', ...(staged ? ['--cached'] : []), '--', '.'];
  const { stdout } = await exec('git', args, { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  return stdout.length > 100000 ? stdout.slice(0, 100000) + '\n[差异超过 10 万字符，已截断]' : stdout;
}
function folderText(project, folder, files, budget = 100000) {
  if (!review.within(project, folder)) throw new Error('文件夹不属于当前项目');
  let text = '', count = 0;
  for (const file of [...files].sort()) {
    if (count >= 20 || budget <= 0) break;
    if (!review.within(folder, file) || !review.within(project, file)) continue;
    let value; try { value = review.readText(file); } catch { continue; }
    if (typeof value !== 'string') continue;
    const heading = `\n--- ${path.relative(project, file)} ---\n`;
    if (budget <= heading.length) break;
    const snippet = value.slice(0, Math.min(50000, budget - heading.length)); text += heading + snippet; budget -= heading.length + snippet.length; count++;
  }
  return { text, count, limited: count < files.length };
}
function attachment(kind, label, text, project) { return { id: crypto.randomUUID(), kind, path: project, label, text }; }
module.exports = { diagnostics, gitDiff, folderText, attachment };
