const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const core = require('./vscode-import.cjs');
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
function prepare(directory, plan, kinds, overwrite) {
  return ['settings', 'keys'].filter(kind => kinds.includes(kind)).map(kind => {
    const name = kind === 'keys' ? 'keybindings.json' : 'settings.json', file = path.join(directory, name), before = read(file);
    const current = core.configuration(before ?? '', kind), merged = kind === 'keys' ? core.mergeKeybindings(current, plan.keybindings, overwrite) : core.mergeSettings(current, plan.settings, overwrite);
    const count = kind === 'keys' ? merged.filter(b => !current.some(c => JSON.stringify(c) === JSON.stringify(b))).length : Object.keys(merged).filter(key => JSON.stringify(merged[key]) !== JSON.stringify(current[key])).length;
    return { name, file, before, after: JSON.stringify(merged, null, 2), count, kind, changed: JSON.stringify(current) !== JSON.stringify(merged) };
  });
}
function apply(records, backup, { rename = fs.renameSync } = {}) {
  fs.mkdirSync(backup, { recursive: true }); const committed = [], temporary = [];
  // Validate every destination before any write; backups preserve original JSONC.
  for (const record of records) if (read(record.file) !== record.before) throw new Error('设置已被其他窗口修改，请重新导入');
  for (const record of records) if (record.before !== null) fs.writeFileSync(path.join(backup, record.name), record.before, { flag: 'wx' });
  try {
    for (const record of records.filter(r => r.changed)) {
      fs.mkdirSync(path.dirname(record.file), { recursive: true });
      const temp = record.file + '.' + crypto.randomUUID() + '.tmp'; temporary.push(temp); fs.writeFileSync(temp, record.after, { flag: 'wx' });
      if (read(record.file) !== record.before) throw new Error('设置已被其他窗口修改，请重新导入');
      rename(temp, record.file); committed.push(record);
    }
  } catch (error) {
    const failed = [];
    for (const record of committed.reverse()) {
      try {
        if (read(record.file) !== record.after) throw new Error('已有新修改');
        if (record.before === null) fs.unlinkSync(record.file);
        else { const temp = record.file + '.' + crypto.randomUUID() + '.rollback.tmp'; temporary.push(temp); fs.writeFileSync(temp, record.before, { flag: 'wx' }); fs.renameSync(temp, record.file); }
      } catch { failed.push(record.name); }
    }
    throw new Error(error.message + (failed.length ? `；${failed.join('、')} 无法自动还原，原配置已备份` : '；已还原本次写入'));
  } finally { for (const file of temporary) if (fs.existsSync(file)) fs.unlinkSync(file); }
  return { settingCount: records.find(r => r.kind === 'settings')?.count || 0, keyCount: records.find(r => r.kind === 'keys')?.count || 0 };
}
function withLock(directory, cache, action) {
  fs.mkdirSync(cache, { recursive: true }); const identity = process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory);
  const lock = path.join(cache, crypto.createHash('sha256').update(identity).digest('hex') + '.lock'); let descriptor;
  try { descriptor = fs.openSync(lock, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = fs.lstatSync(lock); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('配置导入锁无效');
    const pid = Number(fs.readFileSync(lock, 'utf8')); let alive = true;
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; } }
    else if (Date.now() - stat.mtimeMs > 60000) alive = false;
    if (alive) throw new Error('另一窗口正在导入配置，请稍后重试');
    fs.unlinkSync(lock); descriptor = fs.openSync(lock, 'wx');
  }
  try { fs.writeFileSync(descriptor, String(process.pid)); return action(); }
  finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}
module.exports = { prepare, apply, withLock };
