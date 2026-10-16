const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const changes = new (require('node:events').EventEmitter)();
const writes = new Map();
const home = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
function window(value) {
  if (!value) return null;
  const used = value.usedPercent ?? value.used_percent;
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  const minutes = value.windowDurationMins ?? value.window_minutes;
  const reset = value.resetsAt ?? value.resets_at;
  return { usedPercent: Math.min(100, Math.max(0, used)), remainingPercent: Math.max(0, Math.min(100, 100 - used)), windowDurationMins: typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes : null, resetsAt: typeof reset === 'number' && Number.isFinite(reset) && reset > 0 ? reset : null };
}
function normalize(value, timestamp, source) {
  if (!value || !Number.isFinite(Date.parse(timestamp))) return null;
  const primary = window(value.primary), secondary = window(value.secondary);
  if (!primary && !secondary) return null;
  return { primary, secondary, timestamp, source, plan: typeof (value.planType ?? value.plan_type) === 'string' ? value.planType ?? value.plan_type : null };
}
async function directories(dir) {
  try { return (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => e.name).sort().reverse(); } catch { return []; }
}
async function sessionFiles(base) {
  const files = []; const sessions = path.join(base, 'sessions');
  for (const year of (await directories(sessions)).slice(0, 2)) {
    for (const month of (await directories(path.join(sessions, year))).slice(0, 2)) {
      for (const day of (await directories(path.join(sessions, year, month))).slice(0, 3)) {
        const dir = path.join(sessions, year, month, day);
        try { for (const entry of (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isFile() && e.name.endsWith('.jsonl')).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 16)) files.push(path.join(dir, entry.name)); } catch {}
        if (files.length >= 32) return files.slice(0, 32);
      }
    }
  }
  return files.slice(0, 32);
}
async function fromSession(file) {
  let handle;
  try {
    handle = await fs.open(file, 'r'); const { size } = await handle.stat(); const length = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(length); const { bytesRead } = await handle.read(buffer, 0, length, size - length);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    for (const line of lines.reverse()) {
      if (line.length > 65536 || !line.includes('token_count')) continue;
      let item; try { item = JSON.parse(line); } catch { continue; }
      if (item.type !== 'event_msg' || item.payload?.type !== 'token_count') continue;
      const result = normalize(item.payload.rate_limits, item.timestamp, '本机 Codex 记录'); if (result) return result;
    }
  } catch {} finally { await handle?.close(); }
  return null;
}
async function read(root, base = home()) {
  let cached = null;
  try { const value = JSON.parse(await fs.readFile(path.join(root, 'data', 'usage.json'), 'utf8')); cached = normalize(value, value.timestamp, 'GPTIDE 缓存'); } catch {}
  const results = await Promise.all((await sessionFiles(base)).map(fromSession));
  const latest = [...results.filter(Boolean), ...(cached ? [cached] : [])].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  return latest || null;
}
async function save(root, raw) {
  const value = raw?.rateLimitsByLimitId?.codex || raw?.rateLimits || raw;
  const result = normalize(value, new Date().toISOString(), 'GPTIDE 缓存'); if (!result) return;
  const key = path.resolve(root), task = (writes.get(key) || Promise.resolve()).catch(() => {}).then(() => writeCache(key, result));
  writes.set(key, task); task.finally(() => { if (writes.get(key) === task) writes.delete(key); }).catch(() => {}); return task;
}
async function writeCache(root, result) {
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  const target = path.join(root, 'data', 'usage.json'), temp = target + '.' + require('node:crypto').randomUUID() + '.tmp';
  try { await fs.writeFile(temp, JSON.stringify(result)); await fs.rename(temp, target); changes.emit('change', path.resolve(root)); } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
function label(w) { return w?.windowDurationMins === 10080 ? '每周' : w?.windowDurationMins === 300 ? '5 小时' : w?.windowDurationMins ? `${w.windowDurationMins} 分钟` : '用量窗口'; }
function status(record, w = record?.primary, now = Date.now(), staleMinutes = 15) {
  if (!record || !w) return 'unknown';
  if (w.resetsAt && w.resetsAt * 1000 <= now) return 'expired';
  const time = Date.parse(record.timestamp); if (!Number.isFinite(time) || time > now + 300000 || now - time > staleMinutes * 60000) return 'stale';
  return 'cached';
}
function onChange(listener) { changes.on('change', listener); return { dispose: () => changes.off('change', listener) }; }
module.exports = { read, save, normalize, label, status, onChange, sessionFiles, fromSession };
