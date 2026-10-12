const fs = require('node:fs');
const crypto = require('node:crypto');
function read(file) {
  const errors = [];
  for (const candidate of [file, file + '.bak']) {
    if (!fs.existsSync(candidate)) continue;
    try { const state = JSON.parse(fs.readFileSync(candidate, 'utf8')); if (!Array.isArray(state.chats)) throw new Error('Invalid chat history'); return { state, recovered: candidate !== file }; }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new Error('主历史和备份均无法读取，请保留原文件：' + errors[0].message);
  return { state: null, recovered: false };
}
function write(file, state) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(state), 'utf8');
    if (fs.existsSync(file)) {
      try { const old = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(old.chats)) fs.copyFileSync(file, file + '.bak'); }
      catch (error) { if (error instanceof SyntaxError) fs.copyFileSync(file, file + '.corrupt-' + Date.now()); else throw error; }
    }
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
module.exports = { read, write };
