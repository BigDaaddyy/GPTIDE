const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { isUtf8 } = require('node:buffer'); const review = require('./review.cjs');
const HASH = /^[a-f0-9]{64}$/, FILE_LIMIT = 512 * 1024;
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
class Checkpoints {
  constructor(directory, project, projectKey, maximumBytes = 128 * 1024 * 1024) {
    this.directory = directory; this.project = path.resolve(project); this.projectKey = projectKey; this.maximumBytes = maximumBytes;
    this.blobs = path.join(directory, 'blobs'); fs.mkdirSync(this.blobs, { recursive: true }); this.realDirectory = fs.realpathSync(directory);
    this.knownBytes = this.usage();
  }
  guard() { if (fs.realpathSync(this.directory) !== this.realDirectory || !review.within(this.directory, this.blobs)) throw new Error('检查点目录已变化'); }
  usage() { this.guard(); let size = 0; for (const name of fs.readdirSync(this.blobs)) { if (!HASH.test(name)) continue; const stat = fs.lstatSync(path.join(this.blobs, name)); if (stat.isFile() && !stat.isSymbolicLink()) size += stat.size; } return size; }
  put(text) {
    if (text === null) return null;
    if (typeof text !== 'string') throw new Error('检查点内容格式无效');
    const data = Buffer.from(text, 'utf8'); if (data.length > FILE_LIMIT) throw new Error('检查点单文件超过 512 KiB');
    this.guard(); const hash = digest(data), file = path.join(this.blobs, hash);
    if (fs.existsSync(file)) { this.get(hash); fs.utimesSync(file, new Date(), new Date()); return hash; }
    if (this.knownBytes + data.length > this.maximumBytes) throw new Error('检查点缓存达到上限，可清理缓存或增加容量');
    let descriptor;
    try { descriptor = fs.openSync(file, 'wx'); fs.writeFileSync(descriptor, data); }
    catch (error) { if (descriptor !== undefined) { fs.closeSync(descriptor); descriptor = undefined; this.guard(); fs.unlinkSync(file); } if (error.code === 'EEXIST') { this.get(hash); return hash; } throw error; }
    finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
    this.knownBytes += data.length; return hash;
  }
  get(hash) {
    if (hash === null) return null;
    if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('检查点内容引用无效');
    this.guard(); const file = path.join(this.blobs, hash); let data;
    try { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > FILE_LIMIT) throw new Error('invalid blob'); data = fs.readFileSync(file); }
    catch { throw new Error('检查点内容缺失或损坏'); }
    if (digest(data) !== hash || !isUtf8(data)) throw new Error('检查点内容缺失或损坏');
    return data.toString('utf8');
  }
  withLock(action) {
    this.guard(); const lock = path.join(this.directory, 'write.lock'); let descriptor;
    try { descriptor = fs.openSync(lock, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = fs.lstatSync(lock); if (stat.isSymbolicLink()) throw new Error('检查点锁格式无效');
      const pid = Number(fs.readFileSync(lock, 'utf8')); let alive = true;
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; } }
      else if (Date.now() - stat.mtimeMs > 60000) alive = false;
      if (alive) throw new Error('另一窗口正在保存检查点');
      this.guard(); fs.unlinkSync(lock); descriptor = fs.openSync(lock, 'wx');
    }
    try {
    fs.writeFileSync(descriptor, String(process.pid)); return action();
    } finally { fs.closeSync(descriptor); this.guard(); fs.unlinkSync(lock); }
  }
  create(changes, turn = 1, limited = false) {
    return this.withLock(() => {
    this.knownBytes = this.usage(); const result = [];
    for (const change of changes) {
      if (typeof change.path !== 'string' || !review.within(this.project, change.path) || change.before === change.after) continue;
      if (![change.before, change.after].every(v => v === null || typeof v === 'string')) continue;
      result.push({ relative: path.relative(this.project, change.path), beforeRef: this.put(change.before), afterRef: this.put(change.after), ...require('./diff-stats.cjs').stats(change.before,change.after),statsVersion:1, status: ['pending', 'accepted', 'reverted'].includes(change.status) ? change.status : 'pending' });
    }
    return { id: crypto.randomUUID(), projectKey: this.projectKey, turn, createdAt: Date.now(), limited: !!limited, changes: result };
    });
  }
  load(checkpoint) {
    if (checkpoint.projectKey !== this.projectKey || !Array.isArray(checkpoint.changes)) throw new Error('检查点不属于当前项目');
    return checkpoint.changes.map(change => {
      if (typeof change.relative !== 'string' || path.isAbsolute(change.relative)) throw new Error('检查点文件路径无效');
      const file = path.resolve(this.project, change.relative), relative = path.relative(this.project, file);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('检查点文件路径越界');
      if (![change.beforeRef, change.afterRef].every(ref => ref === null || typeof ref === 'string' && HASH.test(ref))) throw new Error('检查点内容引用无效');
      const counts=change.statsVersion===1?{}:require('./diff-stats.cjs').stats(this.get(change.beforeRef),this.get(change.afterRef));
      return { ...change,...counts,statsVersion:1, path: file, relative };
    });
  }
  materialize(change) { return 'beforeRef' in change ? { ...change, before: this.get(change.beforeRef), after: this.get(change.afterRef) } : change; }
  gc(checkpoints, now = Date.now()) {
    return this.withLock(() => {
    this.guard(); const keep = new Set();
    for (const checkpoint of checkpoints) if (checkpoint.projectKey === this.projectKey) for (const change of checkpoint.changes || []) for (const ref of [change.beforeRef, change.afterRef]) if (ref) keep.add(ref);
    let removed = 0, bytes = 0;
    for (const name of fs.readdirSync(this.blobs)) {
      if (!HASH.test(name) || keep.has(name)) continue;
      const file = path.join(this.blobs, name), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || now - stat.mtimeMs < 60000) continue;
      this.guard(); fs.unlinkSync(file); removed++; bytes += stat.size;
    }
    this.knownBytes = Math.max(0, this.knownBytes - bytes); return { removed, bytes };
    });
  }
}
module.exports = { Checkpoints };
