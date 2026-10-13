const LIMIT = 512 * 1024;
const schema = { type: 'object', properties: { replacement: { type: 'string' } }, required: ['replacement'], additionalProperties: false };
function prompt(snapshot, instruction) {
  if (Buffer.byteLength(snapshot.text) > LIMIT) throw new Error('文件超过 512 KiB，请使用聊天处理大文件。');
  return '你是代码选区编辑器。只返回 replacement 字段，内容是替换选区的原始代码，不要解释或 Markdown 围栏。不要调用工具、读取文件、运行命令或修改磁盘。选区为空时在光标处生成代码。保持周围代码风格和缩进。\n' +
    JSON.stringify({ file: snapshot.file, language: snapshot.language, instruction, before: snapshot.text.slice(Math.max(0, snapshot.start - 4000), snapshot.start), selected: snapshot.text.slice(snapshot.start, snapshot.end), after: snapshot.text.slice(snapshot.end, snapshot.end + 4000) });
}
function parse(text) {
  const value = JSON.parse(text);
  if (typeof value.replacement !== 'string' || Buffer.byteLength(value.replacement) > LIMIT) throw new Error('模型未返回有效的代码修改。');
  return value.replacement;
}
function proposal(snapshot, replacement) {
  if (snapshot.start < 0 || snapshot.end < snapshot.start || snapshot.end > snapshot.text.length) throw new Error('选区无效。');
  const eol = snapshot.eol || '\n', normalized = replacement.replace(/\r\n|\r|\n/g, eol);
  return { replacement: normalized, text: snapshot.text.slice(0, snapshot.start) + normalized + snapshot.text.slice(snapshot.end) };
}
function unchanged(snapshot, current) { return snapshot.text === current.text && snapshot.version === current.version; }
module.exports = { schema, prompt, parse, proposal, unchanged };
