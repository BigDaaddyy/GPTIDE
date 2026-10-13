const fs = require('node:fs');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function revision(file) { return fs.existsSync(file) ? digest(fs.readFileSync(file)) : null; }
function read(file) {
  const errors = [];
  for (const candidate of [file, file + '.bak']) {
    if (!fs.existsSync(candidate)) continue;
    try { const state = JSON.parse(fs.readFileSync(candidate, 'utf8')); if (!Array.isArray(state.chats)) throw new Error('Invalid chat history'); return { state, recovered: candidate !== file, revision: revision(file) }; }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new Error('主历史和备份均无法读取，请保留原文件：' + errors[0].message);
  return { state: null, recovered: false, revision: null };
}
function write(file, state, expected) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  const lock = file + '.lock'; let descriptor;
  try {
    try { descriptor = fs.openSync(lock, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let alive = true;
      try { const pid = Number(fs.readFileSync(lock, 'utf8')); if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; } } } catch {}
      if (alive) { const busy = new Error('另一窗口正在保存历史，请稍后重试。'); busy.code = 'GPTIDE_BUSY'; throw busy; }
      fs.unlinkSync(lock); descriptor = fs.openSync(lock, 'wx');
    }
    fs.writeFileSync(descriptor, String(process.pid));
    const text = JSON.stringify(state), current = revision(file);
    if (expected !== undefined && current !== expected) {
      // Exact same bytes are harmless; otherwise retain this window's work.
      if (current === digest(text)) return current;
      const conflictFile = file + '.conflict-' + crypto.randomUUID() + '.json';
      fs.writeFileSync(conflictFile, text, { encoding: 'utf8', flag: 'wx' });
      const error = new Error('另一窗口已更新历史。本窗口记录已保留为冲突副本；点击刷新重新加载。');
      error.code = 'GPTIDE_CONFLICT'; error.conflictFile = conflictFile; throw error;
    }
    fs.writeFileSync(temp, text, 'utf8');
    if (fs.existsSync(file)) {
      try { const old = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(old.chats)) fs.copyFileSync(file, file + '.bak'); }
      catch (error) { if (error instanceof SyntaxError) fs.copyFileSync(file, file + '.corrupt-' + Date.now()); else throw error; }
    }
    fs.renameSync(temp, file);
    return digest(text);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); if (descriptor !== undefined) { fs.closeSync(descriptor); fs.unlinkSync(lock); } }
}
module.exports = { read, write };
